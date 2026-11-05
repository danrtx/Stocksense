from datetime import date

import pandas as pd

from app.series import INSUFFICIENT, READY, build_weekly_series, data_end_week, last_complete_week, week_start

TODAY = date(2026, 10, 7)  # miércoles; última semana completa: lunes 28-sep


def daily(rows):
    return pd.DataFrame(rows, columns=["product_id", "sold_on", "quantity"])


def test_semanas_empiezan_el_lunes_y_solo_cuentan_las_completas():
    assert week_start(date(2026, 10, 4)) == date(2026, 9, 28)
    assert last_complete_week(TODAY) == date(2026, 9, 28)


def test_suma_por_semana_y_rellena_huecos_con_cero():
    data = daily(
        [
            ("a", date(2026, 9, 7), 2),  # semana del 7-sep
            ("a", date(2026, 9, 9), 3),  # misma semana
            ("a", date(2026, 9, 28), 1),  # última semana completa
            ("a", date(2026, 10, 6), 50),  # semana en curso: se ignora
        ]
    )
    weekly, series = build_weekly_series(data, ["a"], TODAY, min_weeks=3)
    assert weekly["week_start"].tolist() == [
        date(2026, 9, 7),
        date(2026, 9, 14),
        date(2026, 9, 21),
        date(2026, 9, 28),
    ]
    assert weekly["quantity"].tolist() == [5.0, 0.0, 0.0, 1.0]
    row = series.iloc[0]
    assert row.weeks_of_history == 4
    assert row.total_quantity == 6.0
    assert row.status == READY


def test_menos_de_12_semanas_es_datos_insuficientes():
    data = daily([("a", date(2026, 8, 31), 1), ("b", date(2026, 6, 1), 1)])
    _, series = build_weekly_series(data, ["a", "b"], TODAY)
    status = dict(zip(series["product_id"], series["status"], strict=True))
    weeks = dict(zip(series["product_id"], series["weeks_of_history"], strict=True))
    assert weeks == {"a": 5, "b": 18}
    assert status == {"a": INSUFFICIENT, "b": READY}


def test_productos_sin_ventas_quedan_marcados_y_sin_filas():
    weekly, series = build_weekly_series(daily([]), ["x"], TODAY)
    assert weekly.empty
    assert series.iloc[0].status == INSUFFICIENT
    assert series.iloc[0].weeks_of_history == 0


def test_venta_solo_en_la_semana_actual_no_cuenta_aun():
    weekly, series = build_weekly_series(daily([("a", date(2026, 10, 5), 4)]), ["a"], TODAY)
    assert weekly.empty
    assert series.iloc[0].weeks_of_history == 0


def test_si_no_hay_ventas_cargadas_los_datos_terminan_en_la_ultima_semana_con_ventas():
    # Hoy es miércoles 7-oct; la última semana completa es la del 28-sep.
    assert data_end_week(date(2026, 10, 3), TODAY) == date(2026, 9, 28)  # hay ventas el sábado 3-oct: normal
    assert data_end_week(date(2026, 9, 19), TODAY) == date(2026, 9, 14)  # última venta un sábado: esa semana cuenta
    assert data_end_week(date(2026, 9, 16), TODAY) == date(2026, 9, 7)  # se cortó un miércoles: semana incompleta
    assert data_end_week(None, TODAY) == date(2026, 9, 28)


def test_las_semanas_sin_ventas_cargadas_no_se_rellenan_con_cero():
    data = daily([("a", date(2026, 9, 1), 2), ("a", date(2026, 9, 12), 3)])
    weekly, series = build_weekly_series(data, ["a"], TODAY, end_week=data_end_week(date(2026, 9, 12), TODAY))
    assert list(weekly["week_start"]) == [date(2026, 8, 31), date(2026, 9, 7)]
    assert series.iloc[0]["last_week"] == date(2026, 9, 7)
