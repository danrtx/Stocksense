"""T-19.1: compara técnicas de pronóstico con las ventas guardadas en la base de datos.

Uso (desde forecast/, con el flujo de datos ya ejecutado):

    pip install -r requirements-research.txt
    python -m research.compare_models                 # usa DATABASE_URL
    python -m research.compare_models --sin-prophet   # más rápido

Para cada producto con 12 semanas o más se toman las últimas 13 semanas como prueba
(o un tercio de la serie si es corta). Desde cada semana de la prueba se pronostican las
siguientes 1 a 4 semanas usando solo los datos anteriores, igual que en producción.
Prophet se vuelve a ajustar en cada semana de origen, así la comparación es justa.

Métricas: WAPE = Σ|pronóstico − real| / Σ real (menor es mejor) y sesgo = Σ(pronóstico − real) / Σ real.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import time
from collections import defaultdict
from datetime import date, timedelta

import numpy as np
import psycopg

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.models import (  # noqa: E402
    EVAL_HORIZONS,
    METHOD_LABELS,
    Z80,
    errors,
    fit_series,
    holt_damped_paths,
    moving_average_paths,
    ses_paths,
    windows,
)


def pct(value: float, signed: bool = False) -> str:
    text = f"{value * 100:+.1f}" if signed else f"{value * 100:.1f}"
    return text.replace(".", ",") + " %"


def load(url: str) -> dict[str, tuple[str, date, np.ndarray]]:
    rows = (
        psycopg.connect(url)
        .execute(
            """SELECT p.sku, ws.week_start, ws.quantity::float
             FROM weekly_sales ws
             JOIN forecast_series fs ON fs.product_id = ws.product_id AND fs.status = 'READY'
             JOIN products p ON p.id = ws.product_id
            ORDER BY p.sku, ws.week_start"""
        )
        .fetchall()
    )
    grouped: dict[str, list] = defaultdict(list)
    for sku, week, quantity in rows:
        grouped[sku].append((week, quantity))
    return {sku: (sku, values[0][0], np.array([q for _, q in values])) for sku, values in grouped.items()}


def best_on_validation(y: np.ndarray, paths: np.ndarray) -> np.ndarray:
    n = len(y)
    test, val_start = windows(n)
    e = errors(paths, y, val_start, n - test)
    i = int(np.argmin(e["abs"]))
    return paths[i : i + 1]


def prophet_errors(y: np.ndarray, first_week: date) -> tuple[float, float, float]:
    import pandas as pd
    from prophet import Prophet

    n = len(y)
    test, _ = windows(n)
    weeks = [first_week + timedelta(weeks=i) for i in range(n)]
    absolute = signed = actual = 0.0
    for origin in range(n - test - 1, n - 1):
        frame = pd.DataFrame({"ds": pd.to_datetime(weeks[: origin + 1]), "y": y[: origin + 1]})
        model = Prophet(
            yearly_seasonality=origin + 1 >= 52,
            weekly_seasonality=False,
            daily_seasonality=False,
            interval_width=0.8,
        )
        model.fit(frame)
        future = pd.DataFrame({"ds": pd.to_datetime([weeks[origin] + timedelta(weeks=h) for h in range(1, EVAL_HORIZONS + 1)])})
        predicted = np.maximum(model.predict(future)["yhat"].to_numpy(), 0)
        for h in range(1, EVAL_HORIZONS + 1):
            target = origin + h
            if n - test <= target < n:
                absolute += abs(predicted[h - 1] - y[target])
                signed += predicted[h - 1] - y[target]
                actual += y[target]
    return absolute, signed, actual


def coverage(y: np.ndarray) -> tuple[int, int]:
    """Cuántas veces la venta real de la semana siguiente cayó dentro del rango del 80 %
    calculado solo con datos anteriores (prueba del intervalo)."""
    n = len(y)
    test, _ = windows(n)
    inside = total = 0
    for origin in range(n - test, n):
        history = y[:origin]
        if len(history) < 12:
            continue
        lo, hi = fit_series(history, 1).forecast[0][1:]
        inside += lo <= y[origin] <= hi
        total += 1
    return inside, total


def main() -> None:
    for name in ("cmdstanpy", "prophet"):
        logging.getLogger(name).setLevel(logging.ERROR)
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--sin-prophet", action="store_true", help="omite Prophet")
    parser.add_argument("--salida", default=os.path.join(os.path.dirname(__file__), "resultados.md"))
    args = parser.parse_args()

    url = os.getenv("DATABASE_URL")
    if not url:
        sys.exit("Define DATABASE_URL.")
    series = load(url)
    if not series:
        sys.exit("No hay series listas. Ejecuta primero el flujo de datos (Pronóstico › Datos › Ejecutar ahora).")

    totals: dict[str, list[float]] = defaultdict(lambda: [0.0, 0.0, 0.0])
    seconds: dict[str, float] = defaultdict(float)
    winners: dict[str, int] = defaultdict(int)
    inside = checked = 0

    for _sku, first_week, y in series.values():
        n = len(y)
        test, _ = windows(n)
        candidates = {
            "Promedio móvil 4 semanas (línea base)": lambda y=y: moving_average_paths(y, EVAL_HORIZONS)[0],
            "Suavizado exponencial simple": lambda y=y: best_on_validation(y, ses_paths(y, EVAL_HORIZONS)[0]),
            "Holt con tendencia amortiguada": lambda y=y: best_on_validation(y, holt_damped_paths(y, EVAL_HORIZONS)[0]),
        }
        for label, build in candidates.items():
            started = time.perf_counter()
            e = errors(build(), y, n - test, n)
            seconds[label] += time.perf_counter() - started
            totals[label][0] += float(e["abs"][0])
            totals[label][1] += float(e["signed"][0])
            totals[label][2] += float(e["actual"])

        started = time.perf_counter()
        fit = fit_series(y)
        seconds["StockSense (elige por producto)"] += time.perf_counter() - started
        winners[fit.method] += 1
        t = totals["StockSense (elige por producto)"]
        t[0] += fit.test_abs_error
        t[1] += (fit.test_bias or 0) * fit.test_actual
        t[2] += fit.test_actual
        a, b = coverage(y)
        inside += a
        checked += b

        if not args.sin_prophet:
            started = time.perf_counter()
            a, s, act = prophet_errors(y, first_week)
            seconds["Prophet"] += time.perf_counter() - started
            totals["Prophet"][0] += a
            totals["Prophet"][1] += s
            totals["Prophet"][2] += act

    lines = [
        "# Comparación de técnicas de pronóstico (T-19.1)",
        "",
        f"Fecha: {date.today():%Y-%m-%d} · Productos: {len(series)} · Prueba: últimas 13 semanas, pronóstico a 1 a 4 semanas.",
        "",
        "| Técnica | WAPE | Sesgo | Segundos |",
        "| --- | --- | --- | --- |",
    ]
    for label, (absolute, signed, actual) in sorted(totals.items(), key=lambda kv: kv[1][0] / max(kv[1][2], 1e-9)):
        row = f"| {label} | {pct(absolute / actual)} | {pct(signed / actual, True)} | {seconds[label]:.1f} |"
        lines.append(row.replace(".", ","))
    lines += [
        "",
        "Técnica elegida por producto en StockSense: "
        + ", ".join(f"{METHOD_LABELS[m]} {c}" for m, c in sorted(winners.items(), key=lambda kv: -kv[1])),
        "",
        f"Rango del 80 % (z = {Z80}): la venta real de la semana siguiente cayó dentro en {inside} de {checked} semanas "
        f"({pct(inside / max(checked, 1))}).",
    ]
    report = "\n".join(lines) + "\n"
    print(report)
    with open(args.salida, "w", encoding="utf-8") as handle:
        handle.write(report)
    print(f"Guardado en {args.salida}")


if __name__ == "__main__":
    main()
