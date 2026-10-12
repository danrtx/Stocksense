"""HU-19, HU-21 y HU-22: corre el modelo para todos los productos y guarda una versión.

Cada ejecución:
1. Toma las series semanales listas (`forecast_series.status = 'READY'`).
2. Elige por producto la mejor técnica (ver `models.py`) y guarda su pronóstico de 12
   semanas con rango, el error en las últimas semanas (prueba hacia atrás) y si le ganó
   al promedio móvil (T-19.3, T-21.1, T-21.2).
3. Compara contra el modelo vigente **en las mismas semanas**: vuelve a correr la
   configuración vigente (técnica + parámetros por producto) con los datos nuevos. Si el
   modelo nuevo es peor, se conserva el vigente y se anota el motivo (T-22.2).
"""

from __future__ import annotations

import json
import logging
import time
import traceback
from collections import Counter, defaultdict
from datetime import date, timedelta

import numpy as np
import psycopg
from psycopg.rows import dict_row

from .config import Settings
from .models import METHOD_LABELS, evaluate_config, fit_series

log = logging.getLogger("stocksense.forecast")

FORECAST_LOCK = 4_221_019
HORIZON = 12
# Cuánto peor (en puntos de WAPE) se tolera antes de rechazar el modelo nuevo.
REJECT_TOLERANCE = 0.005
# Se guarda el detalle (pronósticos y modelos por producto) de las últimas versiones.
KEEP_DETAIL_RUNS = 8
KEEP_RUNS = 60
TOP_SELLERS = 20


class ForecastBusy(Exception):
    """Ya hay un pronóstico en curso."""


class ForecastFailed(Exception):
    """El pronóstico falló; el motivo quedó registrado en `forecast_runs`."""


def pct(value: float | None) -> str:
    """0.1234 → '12,3 %' (formato de Colombia)."""
    return "sin dato" if value is None else f"{value * 100:.1f} %".replace(".", ",")


def _ratio(numerator: float, denominator: float) -> float | None:
    return None if denominator <= 0 else numerator / denominator


def run_forecast(
    settings: Settings,
    trigger: str = "MANUAL",
    requested_by: str | None = None,
    job_id: str | None = None,
) -> dict:
    """Calcula y guarda una versión del pronóstico. Devuelve el resumen de la ejecución."""
    with psycopg.connect(settings.database_url, row_factory=dict_row, autocommit=True) as conn:
        if not conn.execute("SELECT pg_try_advisory_lock(%s) AS ok", (FORECAST_LOCK,)).fetchone()["ok"]:
            raise ForecastBusy("Ya hay un pronóstico en curso. Espera a que termine.")
        try:
            run = conn.execute(
                """INSERT INTO forecast_runs (trigger, status, requested_by, job_id, horizon_weeks)
                   VALUES (%s, 'RUNNING', %s, %s, %s) RETURNING id, version""",
                (trigger, requested_by, job_id, HORIZON),
            ).fetchone()
            started = time.monotonic()
            try:
                summary = _forecast(conn, run["id"], run["version"])
            except Exception as error:  # noqa: BLE001 - se registra cualquier fallo
                log.error("El pronóstico v%s falló: %s", run["version"], error)
                conn.execute(
                    """UPDATE forecast_runs SET status = 'FAILED', finished_at = now(), duration_ms = %s, error = %s
                        WHERE id = %s""",
                    (int((time.monotonic() - started) * 1000), f"{error}\n{traceback.format_exc(limit=3)}"[:4000], run["id"]),
                )
                raise ForecastFailed(str(error)) from error
            elapsed = int((time.monotonic() - started) * 1000)
            conn.execute("UPDATE forecast_runs SET duration_ms = %s WHERE id = %s", (elapsed, run["id"]))
            _cleanup(conn)
            log.info("Pronóstico v%s: %s", run["version"], summary)
            return {"runId": str(run["id"]), "version": run["version"], **summary}
        finally:
            conn.execute("SELECT pg_advisory_unlock(%s)", (FORECAST_LOCK,))


def _load_series(conn: psycopg.Connection) -> tuple[dict[str, np.ndarray], date | None]:
    rows = conn.execute(
        """SELECT ws.product_id::text AS product_id, ws.week_start, ws.quantity::float AS quantity
             FROM weekly_sales ws
             JOIN forecast_series fs ON fs.product_id = ws.product_id AND fs.status = 'READY'
             JOIN products p ON p.id = ws.product_id AND p.is_active
            ORDER BY ws.product_id, ws.week_start"""
    ).fetchall()
    grouped: dict[str, list[float]] = defaultdict(list)
    last_week: date | None = None
    for r in rows:
        grouped[r["product_id"]].append(r["quantity"])
        if last_week is None or r["week_start"] > last_week:
            last_week = r["week_start"]
    return {pid: np.array(values) for pid, values in grouped.items()}, last_week


def _forecast(conn: psycopg.Connection, run_id, version: int) -> dict:
    series, last_week = _load_series(conn)
    total_products = conn.execute("SELECT count(*)::int AS n FROM products WHERE is_active").fetchone()["n"]

    previous = conn.execute("SELECT id, version FROM forecast_runs WHERE is_active").fetchone()
    previous_config: dict[str, tuple[str, dict]] = {}
    if previous:
        for r in conn.execute(
            "SELECT product_id::text AS product_id, method, params FROM forecast_product_models WHERE run_id = %s",
            (previous["id"],),
        ):
            previous_config[r["product_id"]] = (r["method"], r["params"])

    models_rows = []
    forecast_rows = []
    methods: Counter[str] = Counter()
    beats = 0
    totals = {"abs": 0.0, "signed": 0.0, "actual": 0.0, "baseline": 0.0}
    common = {"new": 0.0, "old": 0.0, "actual": 0.0, "products": 0}
    volumes: list[tuple[float, float, float]] = []  # (volumen 52 semanas, error, vendido)
    test_weeks = None

    for pid, y in series.items():
        fit = fit_series(y, HORIZON)
        test_weeks = max(test_weeks or 0, fit.test_weeks)
        methods[fit.method] += 1
        beats += 1 if fit.beats_baseline else 0
        volume = float(y[-52:].sum())
        totals["abs"] += fit.test_abs_error
        totals["actual"] += fit.test_actual
        totals["baseline"] += fit.baseline_abs_error
        totals["signed"] += (fit.test_bias or 0.0) * fit.test_actual
        volumes.append((volume, fit.test_abs_error, fit.test_actual))

        if pid in previous_config:
            method, params = previous_config[pid]
            try:
                old_abs, _, old_actual = evaluate_config(y, method, params)
                common["new"] += fit.test_abs_error
                common["old"] += old_abs
                common["actual"] += old_actual
                common["products"] += 1
            except (KeyError, ValueError):
                pass  # configuración vieja incompatible: no entra en la comparación

        models_rows.append(
            (
                run_id,
                pid,
                fit.method,
                json.dumps(fit.params),
                fit.weeks,
                fit.validation_wape,
                fit.test_wape,
                fit.test_bias,
                fit.test_actual,
                fit.test_abs_error,
                fit.baseline_wape,
                fit.beats_baseline,
                fit.residual_sd,
                volume,
            )
        )
        for step, (yhat, lo, hi) in enumerate(fit.forecast, start=1):
            forecast_rows.append((run_id, pid, last_week + timedelta(weeks=step), step, yhat, lo, hi))

    overall = _ratio(totals["abs"], totals["actual"])
    bias = _ratio(totals["signed"], totals["actual"])
    baseline = _ratio(totals["baseline"], totals["actual"])
    top = sorted(volumes, key=lambda v: v[0], reverse=True)[:TOP_SELLERS]
    top20 = _ratio(sum(v[1] for v in top), sum(v[2] for v in top))

    decision, reason, previous_wape = _decide(previous, common, test_weeks)
    if not series:
        decision = "REJECTED"
        reason = "No hay productos con 12 semanas o más de historia. Carga ventas y ejecuta el flujo de datos."

    with conn.transaction():
        with conn.cursor().copy(
            """COPY forecast_product_models (run_id, product_id, method, params, weeks_of_history, validation_wape,
                   test_wape, test_bias, test_actual, test_abs_error, baseline_wape, beats_baseline, residual_sd,
                   volume_52w) FROM STDIN"""
        ) as copy:
            for row in models_rows:
                copy.write_row(row)
        with conn.cursor().copy("COPY forecasts (run_id, product_id, week_start, step, yhat, lo, hi) FROM STDIN") as copy:
            for row in forecast_rows:
                copy.write_row(row)
        if decision == "ACCEPTED":
            conn.execute("UPDATE forecast_runs SET is_active = false WHERE is_active")
        conn.execute(
            """UPDATE forecast_runs
                  SET status = 'SUCCESS', finished_at = now(), decision = %s, reason = %s, is_active = %s,
                      data_last_week = %s, test_weeks = %s, products_total = %s, products_forecast = %s,
                      products_insufficient = %s, overall_wape = %s, overall_bias = %s, baseline_wape = %s,
                      top20_wape = %s, previous_wape = %s, methods = %s
                WHERE id = %s""",
            (
                decision,
                reason,
                decision == "ACCEPTED",
                last_week,
                test_weeks,
                total_products,
                len(series),
                total_products - len(series),
                overall,
                bias,
                baseline,
                top20,
                previous_wape,
                json.dumps({"counts": dict(methods), "beatsBaseline": beats, "labels": METHOD_LABELS}),
                run_id,
            ),
        )

    return {
        "status": "SUCCESS",
        "decision": decision,
        "reason": reason,
        "productsForecast": len(series),
        "overallWape": overall,
        "baselineWape": baseline,
        "top20Wape": top20,
    }


def _decide(previous, common: dict, test_weeks: int | None) -> tuple[str, str, float | None]:
    if not previous:
        return "ACCEPTED", "Primera versión del modelo.", None
    if common["actual"] <= 0:
        return "ACCEPTED", f"No hay ventas en común con la versión v{previous['version']} para comparar; se usa la nueva.", None
    new = common["new"] / common["actual"]
    old = common["old"] / common["actual"]
    detail = (
        f"en las mismas {test_weeks} semanas y {common['products']} productos: "
        f"error (WAPE) {pct(new)} del nuevo contra {pct(old)} de la versión vigente v{previous['version']}"
    )
    if new > old + REJECT_TOLERANCE:
        return "REJECTED", f"El modelo nuevo es peor {detail}. Se conserva el vigente.", old
    return "ACCEPTED", f"El modelo nuevo es igual o mejor {detail}.", old


def _cleanup(conn: psycopg.Connection) -> None:
    """Conserva el detalle de las últimas versiones y de la activa; el resumen de las últimas 60."""
    keep = """SELECT id FROM forecast_runs ORDER BY started_at DESC LIMIT %s"""
    conn.execute(
        f"""DELETE FROM forecasts WHERE run_id IN (
              SELECT id FROM forecast_runs WHERE NOT is_active AND id NOT IN ({keep}))""",
        (KEEP_DETAIL_RUNS,),
    )
    conn.execute(
        f"""DELETE FROM forecast_product_models WHERE run_id IN (
              SELECT id FROM forecast_runs WHERE NOT is_active AND id NOT IN ({keep}))""",
        (KEEP_DETAIL_RUNS,),
    )
    conn.execute(f"DELETE FROM forecast_runs WHERE NOT is_active AND id NOT IN ({keep})", (KEEP_RUNS,))
