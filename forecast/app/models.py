"""T-19.2: técnicas de pronóstico semanal y su evaluación (HU-19 y HU-21).

Todo es numpy puro y sin base de datos, para poder probarlo con series pequeñas.

Idea general, por producto:
1. Cada técnica se corre una sola vez sobre toda la serie. En cada semana t (el "origen")
   queda el pronóstico de las semanas t+1 … t+H usando solo lo vendido hasta t.
   Así cualquier evaluación hacia atrás es honesta: nunca mira el futuro.
2. Las combinaciones de parámetros se calculan a la vez (vectorizado), por eso 1.000
   productos tardan segundos.
3. Se elige la técnica y sus parámetros con la ventana de **validación** y se informa el
   error en la ventana de **prueba** (las últimas 13 semanas), que no participó en la elección.
4. El rango probable (80 %) sale de los errores reales de la propia serie a 1, 2, 3 y 4
   semanas, y crece con la raíz del horizonte después de la cuarta semana.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

# Cuántas semanas hacia adelante se evalúan (lo que importa para decidir una compra).
EVAL_HORIZONS = 4
# Horizonte máximo que se guarda (la pantalla deja ver 4, 8 o 12).
MAX_HORIZON = 12
# Cuantil normal para un rango del 80 %.
Z80 = 1.2816
# Un modelo más complejo tiene que ganarle al más simple por al menos este margen relativo.
SIMPLER_MARGIN = 0.01

BASELINE = "MOVING_AVERAGE"

METHOD_LABELS = {
    "MOVING_AVERAGE": "Promedio móvil de 4 semanas",
    "SES": "Suavizado exponencial simple",
    "HOLT_DAMPED": "Suavizado exponencial con tendencia amortiguada",
    "CROSTON_SBA": "Croston (demanda intermitente)",
    "COMBO": "Combinación (promedio de las tres técnicas)",
}
# Orden de simplicidad: un modelo más complejo solo gana si mejora al más simple.
METHOD_ORDER = ["MOVING_AVERAGE", "SES", "CROSTON_SBA", "HOLT_DAMPED", "COMBO"]
# La combinación promedia el mejor de cada una de estas técnicas (suele ser más estable).
COMBO_PARTS = ("MOVING_AVERAGE", "SES", "HOLT_DAMPED")

SES_ALPHAS = np.round(np.linspace(0.05, 0.95, 19), 2)
HOLT_GRID = [(a, b, phi) for a in (0.1, 0.2, 0.3, 0.5, 0.7) for b in (0.02, 0.05, 0.1, 0.2) for phi in (0.8, 0.9, 0.95, 0.98)]
CROSTON_ALPHAS = np.array([0.05, 0.1, 0.2, 0.3])


def _init_level(y: np.ndarray) -> float:
    return float(np.mean(y[: min(4, len(y))]))


def moving_average_paths(y: np.ndarray, horizon: int, window: int = 4) -> tuple[np.ndarray, list[dict]]:
    """Promedio de las últimas `window` semanas, igual para todo el horizonte."""
    csum = np.concatenate([[0.0], np.cumsum(y)])
    idx = np.arange(len(y))
    start = np.maximum(0, idx - window + 1)
    level = (csum[idx + 1] - csum[start]) / (idx + 1 - start)
    paths = np.repeat(level[None, :, None], horizon, axis=2)
    return paths, [{"window": window}]


def ses_paths(y: np.ndarray, horizon: int, alphas: np.ndarray = SES_ALPHAS) -> tuple[np.ndarray, list[dict]]:
    """Suavizado exponencial simple: nivel_t = α·y_t + (1-α)·nivel_{t-1}."""
    n = len(y)
    level = np.full(len(alphas), _init_level(y))
    levels = np.empty((len(alphas), n))
    for t in range(n):
        level = alphas * y[t] + (1 - alphas) * level
        levels[:, t] = level
    paths = np.repeat(levels[:, :, None], horizon, axis=2)
    return paths, [{"alpha": float(a)} for a in alphas]


def holt_damped_paths(y: np.ndarray, horizon: int, grid=HOLT_GRID) -> tuple[np.ndarray, list[dict]]:
    """Holt con tendencia amortiguada (Gardner): la tendencia se apaga con el horizonte."""
    n = len(y)
    a = np.array([g[0] for g in grid])
    b = np.array([g[1] for g in grid])
    phi = np.array([g[2] for g in grid])
    level = np.full(len(grid), _init_level(y))
    trend = np.full(len(grid), (float(np.mean(y[4:8])) - float(np.mean(y[:4]))) / 4 if n >= 8 else 0.0)
    levels = np.empty((len(grid), n))
    trends = np.empty((len(grid), n))
    for t in range(n):
        previous = level
        level = a * y[t] + (1 - a) * (level + phi * trend)
        trend = b * (level - previous) + (1 - b) * phi * trend
        levels[:, t] = level
        trends[:, t] = trend
    # Suma de φ + φ² + … + φ^h para cada horizonte h.
    damp = np.cumsum(phi[:, None] ** np.arange(1, horizon + 1)[None, :], axis=1)
    paths = levels[:, :, None] + trends[:, :, None] * damp[:, None, :]
    return np.maximum(paths, 0.0), [{"alpha": g[0], "beta": g[1], "phi": g[2]} for g in grid]


def croston_sba_paths(y: np.ndarray, horizon: int, alphas: np.ndarray = CROSTON_ALPHAS) -> tuple[np.ndarray, list[dict]]:
    """Croston con la corrección de Syntetos-Boylan: para productos que se venden pocas semanas."""
    n = len(y)
    nonzero = np.flatnonzero(y > 0)
    if len(nonzero) == 0:
        return np.zeros((len(alphas), n, horizon)), [{"alpha": float(a)} for a in alphas]
    size = np.full(len(alphas), float(y[nonzero[0]]))
    interval = np.full(len(alphas), float(np.mean(np.diff(nonzero))) if len(nonzero) > 1 else float(nonzero[0] + 1))
    since = 0
    rates = np.empty((len(alphas), n))
    for t in range(n):
        since += 1
        if y[t] > 0:
            size = alphas * y[t] + (1 - alphas) * size
            interval = alphas * since + (1 - alphas) * interval
            since = 0
        rates[:, t] = (1 - alphas / 2) * size / interval
    # Antes de la primera venta no hay información: pronóstico 0.
    rates[:, : nonzero[0]] = 0.0
    paths = np.repeat(rates[:, :, None], horizon, axis=2)
    return paths, [{"alpha": float(a)} for a in alphas]


PATHS = {
    "MOVING_AVERAGE": moving_average_paths,
    "SES": ses_paths,
    "HOLT_DAMPED": holt_damped_paths,
    "CROSTON_SBA": croston_sba_paths,
}


def is_intermittent(y: np.ndarray) -> bool:
    return len(y) > 0 and float(np.mean(y == 0)) >= 0.3


def windows(n: int) -> tuple[int, int]:
    """Tamaño de la ventana de prueba y dónde empieza la validación.

    Con 39 semanas o más la prueba son las últimas 13 (3 meses, T-21.2). Con menos,
    un tercio de la serie (mínimo 4 semanas). La validación usa todas las semanas
    anteriores a la prueba después de un arranque corto: elegir con más semanas evita
    quedarse con la técnica que tuvo suerte en un trimestre.
    """
    test = 13 if n >= 39 else max(4, n // 3)
    return test, min(n - 2 * test, max(4, n // 6))


def errors(paths: np.ndarray, y: np.ndarray, start: int, end: int, horizons: int = EVAL_HORIZONS) -> dict[str, np.ndarray]:
    """Errores de los pronósticos hechos 1…`horizons` semanas antes de cada semana en [start, end).

    Devuelve, por combinación de parámetros: suma de errores absolutos, suma de errores con
    signo y suma de lo vendido de verdad (cada semana cuenta una vez por horizonte).
    """
    absolute = np.zeros(paths.shape[0])
    signed = np.zeros(paths.shape[0])
    actual = 0.0
    for h in range(1, horizons + 1):
        targets = np.arange(max(start, h), end)
        origins = targets - h
        valid = origins >= 0
        targets, origins = targets[valid], origins[valid]
        if len(targets) == 0:
            continue
        predicted = paths[:, origins, h - 1]
        diff = predicted - y[targets][None, :]
        absolute += np.abs(diff).sum(axis=1)
        signed += diff.sum(axis=1)
        actual += float(y[targets].sum())
    return {"abs": absolute, "signed": signed, "actual": np.array(actual)}


def wape(abs_error: float, actual: float) -> float | None:
    """Error porcentual absoluto ponderado: Σ|pronóstico − real| / Σ real."""
    return None if actual <= 0 else abs_error / actual


@dataclass
class Fit:
    method: str
    params: dict
    weeks: int
    test_weeks: int
    validation_wape: float | None
    test_wape: float | None
    test_bias: float | None
    test_actual: float
    test_abs_error: float
    baseline_wape: float | None
    baseline_abs_error: float
    beats_baseline: bool | None
    residual_sd: float
    forecast: list[tuple[float, float, float]] = field(default_factory=list)  # (yhat, lo, hi) por semana


def candidate_paths(y: np.ndarray, horizon: int = MAX_HORIZON):
    """Todas las técnicas que aplican a la serie, con sus combinaciones de parámetros."""
    methods = ["MOVING_AVERAGE", "SES", "HOLT_DAMPED"]
    if is_intermittent(y):
        methods.append("CROSTON_SBA")
    for method in methods:
        paths, params = PATHS[method](y, horizon)
        yield method, paths, params


def evaluate_config(y: np.ndarray, method: str, params: dict) -> tuple[float, float, float]:
    """Error en la ventana de prueba de una configuración ya elegida (para comparar versiones).

    Devuelve (error absoluto, error con signo, vendido real).
    """
    n = len(y)
    test, _ = windows(n)
    paths = _paths_for(y, method, params, EVAL_HORIZONS)
    e = errors(paths, y, n - test, n)
    return float(e["abs"][0]), float(e["signed"][0]), float(e["actual"])


def _paths_for(y: np.ndarray, method: str, params: dict, horizon: int) -> np.ndarray:
    if method == "COMBO":
        parts = [_paths_for(y, m, p, horizon) for m, p in params["components"].items()]
        return np.mean(parts, axis=0)
    if method == "MOVING_AVERAGE":
        return moving_average_paths(y, horizon, int(params.get("window", 4)))[0]
    if method == "SES":
        return ses_paths(y, horizon, np.array([params["alpha"]]))[0]
    if method == "HOLT_DAMPED":
        return holt_damped_paths(y, horizon, [(params["alpha"], params["beta"], params["phi"])])[0]
    if method == "CROSTON_SBA":
        return croston_sba_paths(y, horizon, np.array([params["alpha"]]))[0]
    raise ValueError(f"Técnica desconocida: {method}")


def fit_series(y: np.ndarray, horizon: int = MAX_HORIZON) -> Fit:
    """Elige la mejor técnica para una serie semanal y devuelve su pronóstico con rango."""
    y = np.asarray(y, dtype=float)
    n = len(y)
    test, val_start = windows(n)
    test_start = n - test

    # Mejor combinación de parámetros de cada técnica en la ventana de validación.
    best: dict[str, tuple[float, np.ndarray, dict]] = {}
    val_actual = 0.0
    for method, paths, params in candidate_paths(y, max(horizon, EVAL_HORIZONS)):
        val = errors(paths, y, val_start, test_start)
        val_actual = float(val["actual"])
        i = int(np.argmin(val["abs"]))
        best[method] = (float(val["abs"][i]), paths[i : i + 1], params[i])
    combo = np.mean([best[m][1] for m in COMBO_PARTS], axis=0)
    best["COMBO"] = (
        float(errors(combo, y, val_start, test_start)["abs"][0]),
        combo,
        {"components": {m: best[m][2] for m in COMBO_PARTS}},
    )

    # Se recorre de lo más simple a lo más complejo: cada paso tiene que mejorar al elegido.
    method = BASELINE
    for candidate in METHOD_ORDER[1:]:
        if candidate in best and best[candidate][0] < best[method][0] * (1 - SIMPLER_MARGIN):
            method = candidate
    val_score, chosen, chosen_params = best[method]
    baseline = best[BASELINE]

    test_e = errors(chosen, y, test_start, n)
    base_e = errors(baseline[1], y, test_start, n)
    test_actual = float(test_e["actual"])
    test_abs = float(test_e["abs"][0])
    base_abs = float(base_e["abs"][0])
    test_wape = wape(test_abs, test_actual)
    base_wape = wape(base_abs, test_actual)

    # Rango probable: dispersión real de los errores a 1…4 semanas en validación + prueba.
    sds = []
    for h in range(1, EVAL_HORIZONS + 1):
        targets = np.arange(max(val_start, h), n)
        residuals = y[targets] - chosen[0, targets - h, h - 1]
        sds.append(float(np.sqrt(np.mean(residuals**2))) if len(residuals) else 0.0)
    sds = np.maximum.accumulate(np.array(sds))
    final = chosen[0, n - 1, :]
    forecast = []
    for h in range(1, horizon + 1):
        sd = sds[h - 1] if h <= EVAL_HORIZONS else sds[-1] * np.sqrt(h / EVAL_HORIZONS)
        yhat = max(0.0, float(final[h - 1]))
        lo = max(0.0, yhat - Z80 * sd)
        hi = yhat + Z80 * sd
        forecast.append((round(yhat, 3), round(float(min(lo, yhat)), 3), round(float(max(hi, yhat)), 3)))

    return Fit(
        method=method,
        params=chosen_params,
        weeks=n,
        test_weeks=test,
        validation_wape=wape(val_score, val_actual),
        test_wape=test_wape,
        test_bias=None if test_actual <= 0 else float(test_e["signed"][0]) / test_actual,
        test_actual=test_actual,
        test_abs_error=test_abs,
        baseline_wape=base_wape,
        baseline_abs_error=base_abs,
        beats_baseline=None if test_wape is None else test_abs <= base_abs,
        residual_sd=float(sds[0]),
        forecast=forecast,
    )
