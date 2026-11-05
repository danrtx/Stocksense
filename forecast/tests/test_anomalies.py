"""HU-26 · T-26.1: detección de anomalías.

Las pruebas puras corren siempre; la de punta a punta necesita TEST_DATABASE_URL.
«Listo cuando: detecta los 5 casos sembrados en los datos de prueba.»
"""

import os
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import numpy as np
import psycopg
import pytest
from psycopg.rows import dict_row

from app.anomalies import detect, effective_sd
from app.config import load_settings
from app.pipeline import run_pipeline
from app.series import last_complete_week

DB = os.getenv("TEST_DATABASE_URL")
needs_db = pytest.mark.skipif(DB is None, reason="requiere TEST_DATABASE_URL")
BOGOTA = ZoneInfo("America/Bogota")


def steady(n: int = 30, level: float = 20, seed: int = 1) -> np.ndarray:
    return np.random.default_rng(seed).poisson(level, n).astype(float)


def test_venta_muy_alta_en_la_ultima_semana_es_anomalia():
    y = steady()
    y[-1] = 95
    flags = detect(y)
    assert [(f.kind, f.index) for f in flags] == [("SALES_SPIKE", len(y) - 1)]
    assert flags[0].z > 3 and flags[0].upper < 95


def test_caida_fuerte_de_ventas_es_anomalia_solo_si_el_limite_inferior_es_positivo():
    y = steady(level=60)
    y[-2] = 5
    assert [f.kind for f in detect(y)] == ["SALES_DROP"]
    # Con poco volumen, una semana en cero no dice nada: el límite inferior ya es cero.
    small = steady(level=3)
    small[-1] = 0
    assert detect(small) == []


def test_una_unidad_de_mas_en_un_producto_quieto_no_dispara_alarma():
    y = np.array([0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 2], dtype=float)
    assert detect(y) == []
    mean, sd = effective_sd(np.zeros(10))
    assert mean == 0 and sd == 1  # piso de 1 unidad


def test_merma_grande_sobre_una_historia_sin_mermas():
    s = np.zeros(20)
    s[-1] = 12
    flags = detect(s, kinds=("SHRINK", None))
    assert [f.kind for f in flags] == ["SHRINK"] and flags[0].expected == 0


def test_series_normales_casi_nunca_dan_falsas_alarmas():
    alarms = sum(len(detect(steady(seed=i, level=15))) for i in range(300))
    assert alarms / (300 * 4) < 0.02  # menos del 2 % de las semanas revisadas


def test_solo_se_revisan_las_ultimas_semanas_y_se_necesita_historia():
    y = steady()
    y[5] = 200  # semana vieja: no se revisa
    assert detect(y) == []
    assert detect(np.array([5.0, 6, 200])) == []  # menos de 8 semanas de historia


# --------------------------------------------------------------------------- de punta a punta

CASES = {
    # sku: (tipo esperado, descripción)
    "PROMO": ("SALES_SPIKE", "ventas 4 veces lo normal la última semana"),
    "DIGITO": ("SALES_SPIKE", "un día con 30 veces lo normal (error de digitación)"),
    "CAIDA": ("SALES_DROP", "ventas que se desploman"),
    "REBOTE": ("SALES_SPIKE", "rebote después de dos semanas sin stock"),
    "MERMA": ("SHRINK", "salida grande por producto vencido"),
}


def seed_cases(conn) -> date:
    conn.execute("TRUNCATE products, categories, sales_imports, pipeline_runs, ml_jobs, forecast_runs RESTART IDENTITY CASCADE")
    cat = conn.execute("INSERT INTO categories (name) VALUES ('Pruebas') RETURNING id").fetchone()["id"]
    wh = conn.execute(
        """INSERT INTO warehouses (code, name) VALUES ('PY', 'Python')
           ON CONFLICT (code) DO UPDATE SET name = 'Python' RETURNING id"""
    ).fetchone()["id"]
    last = last_complete_week(datetime.now(BOGOTA).date())
    rng = np.random.default_rng(9)

    def product(sku: str):
        return conn.execute(
            "INSERT INTO products (sku, name, category_id, unit, cost) VALUES (%s, %s, %s, 'UND', 1) RETURNING id",
            (sku, f"Producto {sku}", cat),
        ).fetchone()["id"]

    def sale(pid, day: date, qty: float):
        conn.execute(
            "INSERT INTO sales (product_id, warehouse_id, sold_on, quantity, source) VALUES (%s, %s, %s, %s, 'IMPORT')",
            (pid, wh, day, qty),
        )

    for sku in [*CASES, "NORMAL1", "NORMAL2", "NORMAL3"]:
        pid = product(sku)
        level = 60 if sku == "CAIDA" else 25
        for w in range(30, -1, -1):
            week = last - timedelta(weeks=w)
            qty = float(rng.poisson(level))
            if sku == "PROMO" and w == 0:
                qty = level * 4
            if sku == "CAIDA" and w == 0:
                qty = 4
            if sku == "REBOTE" and w in (1, 2):
                qty = 0
            if sku == "REBOTE" and w == 0:
                qty = level * 2.6
            if qty > 0:
                sale(pid, week + timedelta(days=5), qty)  # las ventas de la semana, el sábado
        if sku == "DIGITO":
            sale(pid, last + timedelta(days=2), level * 30)
        if sku == "MERMA":
            conn.execute(
                """INSERT INTO stock_movements (product_id, warehouse_id, type, quantity, balance_after, reason, created_at)
                   VALUES (%s, %s, 'OUT', -15, 0, 'Producto vencido', %s)""",
                (pid, wh, datetime.combine(last + timedelta(days=3), time(10), BOGOTA)),
            )
    return last


@pytest.fixture
def settings(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", DB or "")
    return load_settings()


@needs_db
def test_detecta_los_5_casos_sembrados_y_respeta_lo_ignorado(settings):
    with psycopg.connect(DB, autocommit=True, row_factory=dict_row) as conn:
        last = seed_cases(conn)
    run = run_pipeline(settings, "MANUAL")
    assert run["status"] == "SUCCESS"

    with psycopg.connect(DB, autocommit=True, row_factory=dict_row) as conn:
        found = conn.execute(
            """SELECT p.sku, a.kind, a.week_start, a.status FROM anomalies a JOIN products p ON p.id = a.product_id
                ORDER BY p.sku"""
        ).fetchall()
        expected = {(sku, kind) for sku, (kind, _) in CASES.items()}
        # El quiebre de stock antes del rebote también se detecta: dos semanas en cero.
        expected.add(("REBOTE", "SALES_DROP"))
        assert {(r["sku"], r["kind"]) for r in found} == expected
        assert all(r["week_start"] == last for r in found if r["kind"] != "SALES_DROP" or r["sku"] == "CAIDA")
        drops = sorted(r["week_start"] for r in found if r["sku"] == "REBOTE" and r["kind"] == "SALES_DROP")
        assert drops == [last - timedelta(weeks=2), last - timedelta(weeks=1)]

        # «Ignorar» una anomalía: no vuelve a aparecer como abierta ni se duplica.
        conn.execute(
            """UPDATE anomalies SET status = 'IGNORED', status_at = now()
                WHERE product_id = (SELECT id FROM products WHERE sku = 'PROMO')"""
        )
    run_pipeline(settings, "MANUAL")
    with psycopg.connect(DB, row_factory=dict_row) as conn:
        rows = conn.execute(
            "SELECT p.sku, a.status FROM anomalies a JOIN products p ON p.id = a.product_id ORDER BY p.sku"
        ).fetchall()
        assert len(rows) == 7
        assert [r["status"] for r in rows if r["sku"] == "PROMO"] == ["IGNORED"]
        assert sum(r["status"] == "OPEN" for r in rows) == 6
