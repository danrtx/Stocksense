"""Pruebas de la API. Las de base de datos usan TEST_DATABASE_URL (la base de pruebas
del backend, ya migrada); sin esa variable se omiten."""

import os
from datetime import date, timedelta

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.main import app

DB = os.getenv("TEST_DATABASE_URL")


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("FORECAST_TOKEN", "secreto")
    monkeypatch.setenv("DATABASE_URL", DB or "postgresql://nadie@127.0.0.1:1/nada")
    with TestClient(app) as c:
        yield c


def test_sin_token_correcto_responde_401(client):
    assert client.post("/runs", json={}).status_code == 401
    assert client.post("/runs", json={}, headers={"X-Internal-Token": "otro"}).status_code == 401


@pytest.mark.skipif(DB is not None, reason="solo aplica sin base de datos")
def test_health_avisa_si_no_hay_base(client):
    response = client.get("/health")
    assert response.status_code == 503
    assert "base de datos" in response.json()["detail"]


@pytest.mark.skipif(DB is None, reason="requiere TEST_DATABASE_URL")
def test_flujo_completo_contra_la_base(client):
    with psycopg.connect(DB, autocommit=True) as conn:
        conn.execute("""TRUNCATE products, categories, sales_imports, pipeline_runs RESTART IDENTITY CASCADE""")
        cat = conn.execute("INSERT INTO categories (name) VALUES ('Pruebas') RETURNING id").fetchone()[0]
        wh = conn.execute(
            """INSERT INTO warehouses (code, name) VALUES ('PY', 'Python')
               ON CONFLICT (code) DO UPDATE SET name = 'Python' RETURNING id"""
        ).fetchone()[0]
        ids = [
            conn.execute(
                "INSERT INTO products (sku, name, category_id, unit, cost) VALUES (%s, %s, %s, 'UND', 1) RETURNING id",
                (sku, sku, cat),
            ).fetchone()[0]
            for sku in ("LARGO", "CORTO", "NADA")
        ]
        today = date.today()
        for weeks_ago in range(2, 30, 2):  # una venta cada dos semanas durante ~7 meses
            conn.execute(
                "INSERT INTO sales (product_id, warehouse_id, sold_on, quantity, source) VALUES (%s, %s, %s, 3, 'IMPORT')",
                (ids[0], wh, today - timedelta(weeks=weeks_ago)),
            )
        conn.execute(
            "INSERT INTO sales (product_id, warehouse_id, sold_on, quantity, source) VALUES (%s, %s, %s, 1, 'IMPORT')",
            (ids[1], wh, today - timedelta(weeks=3)),
        )

    assert client.get("/health").json() == {"status": "ok", "service": "forecast", "database": "ok"}
    run = client.post(
        "/runs", json={"trigger": "MANUAL", "requestedBy": "lina@x.co"}, headers={"X-Internal-Token": "secreto"}
    ).json()
    assert run["status"] == "SUCCESS", run
    assert run["productsTotal"] == 3
    assert run["productsReady"] == 1
    assert run["productsInsufficient"] == 2

    with psycopg.connect(DB) as conn:
        statuses = dict(
            conn.execute("SELECT p.sku, fs.status FROM forecast_series fs JOIN products p ON p.id = fs.product_id").fetchall()
        )
        assert statuses == {"LARGO": "READY", "CORTO": "INSUFFICIENT_DATA", "NADA": "INSUFFICIENT_DATA"}
        zeros = conn.execute(
            "SELECT count(*) FROM weekly_sales w JOIN products p ON p.id = w.product_id WHERE p.sku = 'LARGO' AND quantity = 0"
        ).fetchone()[0]
        assert zeros > 0  # las semanas sin ventas existen y valen 0

    runs = client.get("/runs", headers={"X-Internal-Token": "secreto"}).json()
    assert runs[0]["requestedBy"] == "lina@x.co"


@pytest.mark.skipif(DB is None, reason="requiere TEST_DATABASE_URL")
def test_una_falla_queda_registrada(client, monkeypatch):
    import app.pipeline as pipeline

    def boom(*_args, **_kwargs):
        raise RuntimeError("columna inesperada")

    monkeypatch.setattr(pipeline, "_prepare", boom)
    run = client.post("/runs", json={}, headers={"X-Internal-Token": "secreto"}).json()
    assert run["status"] == "FAILED"
    assert "columna inesperada" in run["error"]
