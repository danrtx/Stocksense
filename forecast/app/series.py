"""T-18.2: agregación semanal de ventas y relleno de huecos.

Funciones puras (sin base de datos) para poder probarlas con datos pequeños.

Reglas:
- La semana empieza el lunes.
- Solo se usan semanas completas: la semana en curso se ignora porque está a medias.
- Cada producto tiene una fila por semana desde su primera venta hasta la última semana
  completa; las semanas sin ventas valen 0.
- Un producto con menos de `min_weeks` semanas de historia (o sin ventas) queda como
  "INSUFFICIENT_DATA" y no recibe pronóstico estadístico.
"""

from __future__ import annotations

from datetime import date, timedelta

import pandas as pd

READY = "READY"
INSUFFICIENT = "INSUFFICIENT_DATA"


def week_start(day: date) -> date:
    """Lunes de la semana de `day`."""
    return day - timedelta(days=day.weekday())


def last_complete_week(today: date) -> date:
    """Lunes de la última semana que ya terminó."""
    return week_start(today) - timedelta(days=7)


def build_weekly_series(
    daily: pd.DataFrame,
    product_ids: list[str],
    today: date,
    min_weeks: int = 12,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Convierte ventas diarias en series semanales sin huecos.

    `daily` tiene columnas product_id, sold_on (date) y quantity.
    Devuelve (weekly, series):
      weekly: product_id, week_start, quantity
      series: product_id, first_week, last_week, weeks_of_history, total_quantity, status
    """
    last_week = last_complete_week(today)
    cutoff = last_week + timedelta(days=6)

    weekly_frames: list[pd.DataFrame] = []
    summary: list[dict] = []

    if daily.empty:
        grouped: dict[str, pd.Series] = {}
    else:
        data = daily.copy()
        data["sold_on"] = pd.to_datetime(data["sold_on"])
        data = data[data["sold_on"] <= pd.Timestamp(cutoff)]
        data["week_start"] = data["sold_on"] - pd.to_timedelta(data["sold_on"].dt.weekday, unit="D")
        sums = data.groupby(["product_id", "week_start"])["quantity"].sum()
        grouped = {pid: s.droplevel(0) for pid, s in sums.groupby(level=0)}

    for pid in product_ids:
        sales = grouped.get(pid)
        if sales is None or sales.empty:
            summary.append(
                {
                    "product_id": pid,
                    "first_week": None,
                    "last_week": None,
                    "weeks_of_history": 0,
                    "total_quantity": 0.0,
                    "status": INSUFFICIENT,
                }
            )
            continue
        first = sales.index.min()
        weeks = pd.date_range(first, pd.Timestamp(last_week), freq="W-MON")
        filled = sales.reindex(weeks, fill_value=0.0).astype(float)
        frame = pd.DataFrame({"product_id": pid, "week_start": filled.index.date, "quantity": filled.to_numpy()})
        weekly_frames.append(frame)
        summary.append(
            {
                "product_id": pid,
                "first_week": first.date(),
                "last_week": last_week,
                "weeks_of_history": len(weeks),
                "total_quantity": float(filled.sum()),
                "status": READY if len(weeks) >= min_weeks else INSUFFICIENT,
            }
        )

    weekly = (
        pd.concat(weekly_frames, ignore_index=True)
        if weekly_frames
        else pd.DataFrame({"product_id": [], "week_start": [], "quantity": []})
    )
    return weekly, pd.DataFrame(summary)
