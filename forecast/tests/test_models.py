"""Pruebas de las técnicas de pronóstico (HU-19 y HU-21) sin base de datos."""

import time

import numpy as np
import pytest

from app.models import (
    BASELINE,
    errors,
    evaluate_config,
    fit_series,
    holt_damped_paths,
    moving_average_paths,
    ses_paths,
    wape,
    windows,
)


def test_promedio_movil_usa_las_ultimas_4_semanas():
    y = np.array([1.0, 2, 3, 4, 5, 6])
    paths, _ = moving_average_paths(y, 3)
    assert paths[0, 5].tolist() == [4.5, 4.5, 4.5]  # (3+4+5+6)/4
    assert paths[0, 0, 0] == 1.0  # al inicio, lo que haya


def test_suavizado_de_una_serie_constante_pronostica_la_constante():
    y = np.full(20, 7.0)
    paths, params = ses_paths(y, 4)
    assert np.allclose(paths, 7.0)
    assert len(params) == paths.shape[0]


def test_holt_sigue_una_tendencia_y_nunca_pronostica_negativo():
    y = np.arange(1, 41, dtype=float)
    paths, _ = holt_damped_paths(y, 4)
    assert paths[:, -1, 0].max() > 38  # sigue subiendo
    falling = np.maximum(40 - 3 * np.arange(20, dtype=float), 0)
    assert holt_damped_paths(falling, 12)[0].min() >= 0


def test_la_evaluacion_nunca_mira_el_futuro():
    """El pronóstico hecho en la semana t no puede cambiar si cambian las semanas siguientes."""
    rng = np.random.default_rng(3)
    y = rng.normal(20, 4, 60).clip(0)
    changed = y.copy()
    changed[40:] += 100
    for builder in (moving_average_paths, ses_paths, holt_damped_paths):
        a = builder(y, 4)[0]
        b = builder(changed, 4)[0]
        assert np.allclose(a[:, :40], b[:, :40])


def test_wape_y_ventanas():
    assert wape(5, 50) == 0.1
    assert wape(5, 0) is None
    assert windows(78) == (13, 13)  # prueba = últimas 13 semanas (T-21.2)
    assert windows(12) == (4, 4)


def test_errores_cuentan_cada_horizonte():
    y = np.array([10.0] * 10)
    paths = np.full((1, 10, 4), 12.0)
    e = errors(paths, y, 6, 10)
    assert e["abs"][0] == pytest.approx(2 * 16)  # 4 semanas x 4 horizontes
    assert e["signed"][0] == pytest.approx(2 * 16)


def test_fit_series_entrega_pronostico_con_rango_y_compara_con_la_linea_base():
    rng = np.random.default_rng(1)
    t = np.arange(78)
    y = np.maximum(0, 20 + 0.3 * t + rng.normal(0, 3, 78))
    fit = fit_series(y, 12)
    assert len(fit.forecast) == 12
    for yhat, lo, hi in fit.forecast:
        assert 0 <= lo <= yhat <= hi
    widths = [hi - lo for _, lo, hi in fit.forecast]
    assert widths[-1] >= widths[0]  # el rango crece con el horizonte
    assert fit.test_weeks == 13
    assert fit.baseline_wape is not None and fit.test_wape is not None
    assert fit.beats_baseline == (fit.test_abs_error <= fit.baseline_abs_error)
    # Con tendencia clara, el modelo elegido no es el promedio móvil.
    assert fit.method != BASELINE


def test_serie_intermitente_y_serie_sin_ventas_en_la_prueba():
    y = np.array([0, 0, 3, 0, 0, 0, 2, 0, 0, 4, 0, 0, 0, 1, 0, 0] * 2, dtype=float)
    fit = fit_series(y)
    assert all(lo >= 0 for _, lo, _ in fit.forecast)
    quiet = np.concatenate([np.full(20, 5.0), np.zeros(10)])
    fit = fit_series(quiet)
    assert fit.test_wape is None and fit.beats_baseline is None  # sin ventas no hay WAPE


def test_evaluar_una_configuracion_guardada_da_el_mismo_error():
    rng = np.random.default_rng(5)
    y = rng.normal(30, 5, 60).clip(0)
    fit = fit_series(y)
    absolute, _signed, actual = evaluate_config(y, fit.method, fit.params)
    assert absolute == pytest.approx(fit.test_abs_error)
    assert actual == pytest.approx(fit.test_actual)


def test_mil_productos_en_mucho_menos_de_10_minutos():
    """Criterio 3 de HU-19: 1.000 productos con 2 años de historia."""
    rng = np.random.default_rng(0)
    started = time.perf_counter()
    for _ in range(1000):
        fit_series(rng.normal(15, 4, 104).clip(0))
    assert time.perf_counter() - started < 120
