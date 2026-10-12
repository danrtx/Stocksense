"""HU-19, HU-22 y HU-33 contra la base de pruebas (TEST_DATABASE_URL, ya migrada por el backend).

Sin esa variable solo corren las pruebas puras del horario.
"""

import json
import os
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import numpy as np
import psycopg
import pytest
from psycopg.rows import dict_row

from app import forecasting, jobs
from app.config import load_settings
from app.jobs import enqueue, process_next, retrain_slot

DB = os.getenv("TEST_DATABASE_URL")
BOGOTA = ZoneInfo("America/Bogota")
needs_db = pytest.mark.skipif(DB is None, reason="requiere TEST_DATABASE_URL")


def test_turno_semanal_de_reentrenamiento():
    config = {"enabled": True, "weekday": 3, "time": "04:30"}  # miércoles 04:30
    tuesday = datetime(2026, 10, 13, 23, 0, tzinfo=BOGOTA)
    wednesday = datetime(2026, 10, 14, 4, 31, tzinfo=BOGOTA)
    assert retrain_slot(config, tuesday) is None
    assert retrain_slot(config, wednesday) == datetime(2026, 10, 14, 4, 30, tzinfo=BOGOTA)
    assert retrain_slot({**config, "enabled": False}, wednesday) is None


@pytest.fixture
def settings(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", DB or "")
    monkeypatch.setenv("JOB_RETRY_DELAY_SECONDS", "0")
    return load_settings()


def seed(conn, weeks: int = 40):
    conn.execute("TRUNCATE products, categories, sales_imports, pipeline_runs, ml_jobs, forecast_runs RESTART IDENTITY CASCADE")
    conn.execute("DELETE FROM assistant_models")
    cat = conn.execute("INSERT INTO categories (name) VALUES ('Pruebas') RETURNING id").fetchone()["id"]
    wh = conn.execute(
        """INSERT INTO warehouses (code, name) VALUES ('PY', 'Python')
           ON CONFLICT (code) DO UPDATE SET name = 'Python' RETURNING id"""
    ).fetchone()["id"]
    rng = np.random.default_rng(4)
    today = date.today()
    for sku in ("SUBE", "PLANO", "NUEVO"):
        pid = conn.execute(
            "INSERT INTO products (sku, name, category_id, unit, cost) VALUES (%s, %s, %s, 'UND', 1) RETURNING id",
            (sku, sku, cat),
        ).fetchone()["id"]
        span = 5 if sku == "NUEVO" else weeks
        for w in range(1, span + 1):
            qty = 10 + (span - w) * 0.5 if sku == "SUBE" else 8
            qty = max(1, round(qty + rng.normal(0, 1)))
            conn.execute(
                "INSERT INTO sales (product_id, warehouse_id, sold_on, quantity, source) VALUES (%s, %s, %s, %s, 'IMPORT')",
                (pid, wh, today - timedelta(weeks=w), qty),
            )


@needs_db
def test_reentrenamiento_por_la_cola_guarda_version_pronostico_y_precision(settings):
    with psycopg.connect(DB, autocommit=True, row_factory=dict_row) as conn:
        seed(conn)
        assert enqueue(conn, "FORECAST_RETRAIN", "MANUAL", "lina@x.co") is not None
    assert process_next(settings) is True
    assert process_next(settings) is False  # la cola quedó vacía

    with psycopg.connect(DB, row_factory=dict_row) as conn:
        job = conn.execute("SELECT * FROM ml_jobs").fetchone()
        assert job["status"] == "SUCCESS", job["error"]
        run = conn.execute("SELECT * FROM forecast_runs").fetchone()
        assert run["version"] == 1 and run["is_active"] and run["decision"] == "ACCEPTED"
        assert run["products_forecast"] == 2 and run["products_insufficient"] == 1
        assert run["overall_wape"] is not None and run["baseline_wape"] is not None
        rows = conn.execute(
            """SELECT p.sku, count(*) AS weeks, bool_and(f.lo <= f.yhat AND f.yhat <= f.hi) AS ok
                 FROM forecasts f JOIN products p ON p.id = f.product_id GROUP BY p.sku ORDER BY p.sku"""
        ).fetchall()
        assert [(r["sku"], r["weeks"], r["ok"]) for r in rows] == [("PLANO", 12, True), ("SUBE", 12, True)]
        model = conn.execute(
            "SELECT m.* FROM forecast_product_models m JOIN products p ON p.id = m.product_id WHERE p.sku = 'SUBE'"
        ).fetchone()
        assert model["method"] and model["baseline_wape"] is not None and model["beats_baseline"] is not None


@needs_db
def test_si_el_modelo_nuevo_es_peor_se_conserva_el_vigente(settings, monkeypatch):
    with psycopg.connect(DB, autocommit=True, row_factory=dict_row) as conn:
        seed(conn)
    jobs.run_pipeline(settings, "MANUAL")
    first = forecasting.run_forecast(settings)
    assert first["decision"] == "ACCEPTED"

    original = forecasting.fit_series

    def worse(y, horizon):
        fit = original(y, horizon)
        fit.test_abs_error *= 3  # el candidato se equivoca el triple en las mismas semanas
        return fit

    monkeypatch.setattr(forecasting, "fit_series", worse)
    second = forecasting.run_forecast(settings)
    assert second["decision"] == "REJECTED"
    assert "Se conserva el vigente" in second["reason"]
    with psycopg.connect(DB, row_factory=dict_row) as conn:
        active = conn.execute("SELECT version FROM forecast_runs WHERE is_active").fetchone()
        assert active["version"] == first["version"]


@needs_db
def test_una_falla_se_reintenta_y_luego_avisa(settings, monkeypatch):
    sent = []
    monkeypatch.setattr(jobs, "run_pipeline", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("disco lleno")))
    monkeypatch.setattr(jobs, "send_failure_alert", lambda s, conn, job, error: sent.append((job["kind"], error)) or True)
    with psycopg.connect(DB, autocommit=True, row_factory=dict_row) as conn:
        conn.execute("TRUNCATE ml_jobs CASCADE")
        enqueue(conn, "FORECAST_RETRAIN", "SCHEDULED", None, "retrain:prueba")
        assert enqueue(conn, "FORECAST_RETRAIN", "SCHEDULED", None, "retrain:prueba") is None  # mismo turno, una vez

    assert process_next(settings)  # intento 1: vuelve a la cola
    with psycopg.connect(DB, row_factory=dict_row) as conn:
        assert conn.execute("SELECT status, attempts FROM ml_jobs").fetchone() == {"status": "QUEUED", "attempts": 1}
    assert sent == []
    assert process_next(settings)  # intento 2: falla definitiva
    with psycopg.connect(DB, row_factory=dict_row) as conn:
        job = conn.execute("SELECT status, error, alert_sent_at FROM ml_jobs").fetchone()
    assert job["status"] == "FAILED" and "disco lleno" in job["error"] and job["alert_sent_at"] is not None
    assert sent == [("FORECAST_RETRAIN", "disco lleno")]


@needs_db
def test_entrenar_el_asistente_por_la_cola(settings):
    from tests.test_assistant import KB, articles_from_repo

    if not KB.exists():
        pytest.skip("sin fichas")
    with psycopg.connect(DB, autocommit=True, row_factory=dict_row) as conn:
        conn.execute("TRUNCATE ml_jobs CASCADE")
        conn.execute("DELETE FROM assistant_models")
        conn.execute("DELETE FROM assistant_articles")
        for a in articles_from_repo():
            conn.execute(
                """INSERT INTO assistant_articles (id, title, summary, section, steps, examples, keywords)
                   VALUES (%s, %s, %s, 'x', '[]', %s, %s)""",
                (a["id"], a["title"], a["summary"], json.dumps(a["examples"]), a["keywords"]),
            )
        jobs.ensure_assistant_model(conn)
        jobs.ensure_assistant_model(conn)  # no se duplica
        assert conn.execute("SELECT count(*) AS n FROM ml_jobs").fetchone()["n"] == 1
    assert process_next(settings)
    with psycopg.connect(DB, row_factory=dict_row) as conn:
        model = conn.execute("SELECT * FROM assistant_models").fetchone()
        assert model["status"] == "READY" and model["is_active"]
        assert float(model["accuracy"]) >= 0.85
        assert model["articles_hash"]
        jobs.ensure_assistant_model(conn)  # mismas fichas: nada que hacer

    from fastapi.testclient import TestClient

    from app.main import app

    os.environ["FORECAST_TOKEN"] = "secreto"
    token = {"X-Internal-Token": "secreto"}
    with TestClient(app) as client:
        r = client.post("/assistant/predict", json={"text": "¿cómo registro una salida?"}, headers=token)
        assert r.status_code == 200
        assert r.json()["articleId"] == "registrar-salida" and r.json()["version"] == model["version"]
        r = client.post("/assistant/similar", json={"text": "proveedores", "k": 2}, headers=token)
        assert len(r.json()["items"]) == 2
