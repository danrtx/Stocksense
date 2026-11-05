"""HU-26 · T-26.1: detección estadística de anomalías.

Se revisan las últimas `RECENT_WEEKS` semanas de cada producto contra su propia historia:

- **Ventas altas** (`SALES_SPIKE`): la semana supera el promedio de las `BASELINE_WEEKS`
  semanas anteriores en más de `Z` desviaciones estándar.
- **Ventas bajas** (`SALES_DROP`): la semana queda por debajo del promedio en más de `Z`
  desviaciones (solo si ese límite inferior es mayor que cero, si no cualquier semana floja
  sería anomalía).
- **Mermas** (`SHRINK`): salidas por producto dañado, vencido, robado o perdido y ajustes
  negativos de conteo, con la misma regla sobre su propia historia.

La desviación estándar nunca se toma menor que la raíz del promedio (variación natural de
conteos, tipo Poisson) ni que 1 unidad: así un producto que vende siempre lo mismo no
dispara una alarma por una unidad de más.

El estado que le da la persona (explicada o ignorada) se respeta: volver a detectar la
misma semana no la reabre. Las abiertas que dejan de cumplir la regla (por ejemplo, porque
se corrigió un error de digitación) se borran.
"""

from __future__ import annotations

import json
import logging
import math
from dataclasses import dataclass
from datetime import date, timedelta

import numpy as np
import psycopg

log = logging.getLogger("forecast.anomalies")

RECENT_WEEKS = 4
BASELINE_WEEKS = 26
MIN_BASELINE = 8
Z = 3.0

SHRINK_REASON = r"(dañ|dan[oa]|merma|venc|rob|hurt|p[ée]rdid|rot[oa]|quebr|averi)"


@dataclass
class Flag:
    index: int
    kind: str
    observed: float
    expected: float
    sd: float
    lower: float
    upper: float
    z: float


def effective_sd(values: np.ndarray) -> tuple[float, float]:
    """Promedio y desviación estándar con piso (raíz del promedio y 1 unidad)."""
    mean = float(np.mean(values))
    sd = float(np.std(values, ddof=1)) if len(values) > 1 else 0.0
    return mean, max(sd, math.sqrt(max(mean, 0.0)), 1.0)


def detect(
    y: np.ndarray,
    kinds: tuple[str, str | None] = ("SALES_SPIKE", "SALES_DROP"),
    recent: int = RECENT_WEEKS,
    baseline: int = BASELINE_WEEKS,
    min_baseline: int = MIN_BASELINE,
    z: float = Z,
) -> list[Flag]:
    """Semanas raras entre las últimas `recent` de una serie semanal (función pura)."""
    y = np.asarray(y, dtype=float)
    flags: list[Flag] = []
    high, low = kinds
    for t in range(max(min_baseline, len(y) - recent), len(y)):
        history = y[max(0, t - baseline) : t]
        if len(history) < min_baseline:
            continue
        mean, sd = effective_sd(history)
        upper, lower = mean + z * sd, mean - z * sd
        x = float(y[t])
        score = (x - mean) / sd
        if x > upper:
            flags.append(Flag(t, high, x, mean, sd, max(0.0, lower), upper, score))
        elif low and lower > 0 and x < lower:
            flags.append(Flag(t, low, x, mean, sd, lower, upper, score))
    return flags


def scan(conn: psycopg.Connection) -> dict:
    """Revisa todos los productos con historia y guarda las anomalías nuevas."""
    rows = conn.execute(
        """SELECT ws.product_id::text AS product_id, ws.week_start, ws.quantity::float AS quantity
             FROM weekly_sales ws JOIN products p ON p.id = ws.product_id
            WHERE p.is_active
            ORDER BY ws.product_id, ws.week_start"""
    ).fetchall()
    series: dict[str, tuple[list[date], list[float]]] = {}
    for r in rows:
        weeks, values = series.setdefault(r["product_id"], ([], []))
        weeks.append(r["week_start"])
        values.append(r["quantity"])
    if not series:
        return {"products": 0, "found": 0, "new": 0, "removed": 0}

    last_week = max(w[-1] for w, _ in series.values())
    first_scanned = last_week - timedelta(weeks=RECENT_WEEKS - 1)

    shrink_rows = conn.execute(
        """SELECT m.product_id::text AS product_id,
                  date_trunc('week', (m.created_at AT TIME ZONE 'America/Bogota'))::date AS week_start,
                  sum(-m.quantity)::float AS quantity
             FROM stock_movements m
            WHERE m.quantity < 0
              AND ((m.type = 'OUT' AND m.reason ~* %s) OR m.type = 'ADJUSTMENT')
            GROUP BY 1, 2""",
        (SHRINK_REASON,),
    ).fetchall()
    shrink: dict[str, dict[date, float]] = {}
    for r in shrink_rows:
        shrink.setdefault(r["product_id"], {})[r["week_start"]] = r["quantity"]

    found: list[tuple] = []
    for pid, (weeks, values) in series.items():
        y = np.array(values)
        for f in detect(y):
            found.append(_row(pid, f, weeks[f.index], y))
        if pid in shrink:
            s = np.array([shrink[pid].get(w, 0.0) for w in weeks])
            for f in detect(s, kinds=("SHRINK", None)):
                if f.observed >= 2:  # una sola unidad dañada no es noticia
                    found.append(_row(pid, f, weeks[f.index], s))

    with conn.transaction():
        new = 0
        keys = []
        for row in found:
            keys.append((row[0], row[1], row[2]))
            inserted = conn.execute(
                """INSERT INTO anomalies (product_id, kind, week_start, observed, expected, sd, lower_bound, upper_bound,
                                          z_score, history)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (product_id, kind, week_start) DO UPDATE
                      SET observed = EXCLUDED.observed, expected = EXCLUDED.expected, sd = EXCLUDED.sd,
                          lower_bound = EXCLUDED.lower_bound, upper_bound = EXCLUDED.upper_bound,
                          z_score = EXCLUDED.z_score, history = EXCLUDED.history, detected_at = now(),
                          explanation = CASE WHEN anomalies.observed = EXCLUDED.observed THEN anomalies.explanation END
                   RETURNING (xmax = 0) AS inserted""",
                row,
            ).fetchone()["inserted"]
            new += 1 if inserted else 0
        # Las abiertas de la ventana revisada que ya no cumplen la regla se quitan.
        removed = conn.execute(
            """DELETE FROM anomalies a
                WHERE a.status = 'OPEN' AND a.week_start >= %s
                  AND NOT EXISTS (SELECT 1 FROM unnest(%s::uuid[], %s::text[], %s::date[]) AS k(p, kind, w)
                                   WHERE k.p = a.product_id AND k.kind = a.kind AND k.w = a.week_start)""",
            (
                first_scanned,
                [k[0] for k in keys],
                [k[1] for k in keys],
                [k[2] for k in keys],
            ),
        ).rowcount
    log.info("Anomalías: %s encontradas, %s nuevas, %s ya no aplican", len(found), new, removed)
    return {"products": len(series), "found": len(found), "new": new, "removed": removed}


def _row(pid: str, f: Flag, week: date, y: np.ndarray) -> tuple:
    history = [round(float(v), 3) for v in y[max(0, f.index - 15) : f.index + 1]]
    return (
        pid,
        f.kind,
        week,
        round(f.observed, 3),
        round(f.expected, 3),
        round(f.sd, 3),
        round(f.lower, 3),
        round(f.upper, 3),
        round(f.z, 2),
        json.dumps(history),
    )
