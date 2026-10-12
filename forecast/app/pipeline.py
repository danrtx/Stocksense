"""Flujo de preparación de datos (HU-18): lee ventas, arma series semanales y las guarda.

Cada ejecución queda registrada en `pipeline_runs`, exitosa o fallida (T-18.3), y se
conservan las últimas `keep_runs`.
"""

from __future__ import annotations

import logging
import traceback
from datetime import datetime

import pandas as pd
import psycopg
from psycopg.rows import dict_row

from .config import Settings
from .series import READY, build_weekly_series

log = logging.getLogger("stocksense.forecast")

# Número fijo para el candado de PostgreSQL que evita dos ejecuciones a la vez.
PIPELINE_LOCK = 4_221_018


class PipelineBusy(Exception):
    """Ya hay una ejecución en curso."""


def _camel(run: dict) -> dict:
    return {
        "id": str(run["id"]),
        "trigger": run["trigger"],
        "status": run["status"],
        "startedAt": run["started_at"].isoformat() if run["started_at"] else None,
        "finishedAt": run["finished_at"].isoformat() if run["finished_at"] else None,
        "productsTotal": run["products_total"],
        "productsReady": run["products_ready"],
        "productsInsufficient": run["products_insufficient"],
        "weeksWritten": run["weeks_written"],
        "error": run["error"],
        "requestedBy": run["requested_by"],
    }


def list_runs(settings: Settings, limit: int = 30) -> list[dict]:
    with psycopg.connect(settings.database_url, row_factory=dict_row) as conn:
        rows = conn.execute("SELECT * FROM pipeline_runs ORDER BY started_at DESC LIMIT %s", (limit,)).fetchall()
    return [_camel(r) for r in rows]


def run_pipeline(settings: Settings, trigger: str, requested_by: str | None = None) -> dict:
    """Ejecuta el flujo completo y devuelve el registro de la ejecución."""
    with psycopg.connect(settings.database_url, row_factory=dict_row, autocommit=True) as conn:
        locked = conn.execute("SELECT pg_try_advisory_lock(%s) AS ok", (PIPELINE_LOCK,)).fetchone()["ok"]
        if not locked:
            raise PipelineBusy("Ya hay una ejecución del flujo de datos en curso. Espera a que termine.")
        try:
            run_id = conn.execute(
                "INSERT INTO pipeline_runs (trigger, status, requested_by) VALUES (%s, 'RUNNING', %s) RETURNING id",
                (trigger, requested_by),
            ).fetchone()["id"]
            try:
                stats = _prepare(conn, settings)
                conn.execute(
                    """UPDATE pipeline_runs
                          SET status = 'SUCCESS', finished_at = now(), products_total = %s,
                              products_ready = %s, products_insufficient = %s, weeks_written = %s
                        WHERE id = %s""",
                    (stats["total"], stats["ready"], stats["insufficient"], stats["weeks"], run_id),
                )
                log.info("Flujo de datos OK: %s", stats)
            except Exception as error:  # noqa: BLE001 - se registra cualquier fallo
                log.error("Flujo de datos falló: %s", error)
                conn.execute(
                    "UPDATE pipeline_runs SET status = 'FAILED', finished_at = now(), error = %s WHERE id = %s",
                    (f"{error}\n{traceback.format_exc(limit=3)}"[:4000], run_id),
                )
            conn.execute(
                """DELETE FROM pipeline_runs WHERE id NOT IN (
                     SELECT id FROM pipeline_runs ORDER BY started_at DESC LIMIT %s)""",
                (settings.keep_runs,),
            )
            run = conn.execute("SELECT * FROM pipeline_runs WHERE id = %s", (run_id,)).fetchone()
            return _camel(run)
        finally:
            conn.execute("SELECT pg_advisory_unlock(%s)", (PIPELINE_LOCK,))


def _prepare(conn: psycopg.Connection, settings: Settings) -> dict:
    today = datetime.now(settings.timezone).date()
    products = [r["id"] for r in conn.execute("SELECT id::text AS id FROM products WHERE is_active")]
    rows = conn.execute(
        """SELECT product_id::text AS product_id, sold_on, sum(quantity)::float AS quantity
             FROM sales GROUP BY product_id, sold_on"""
    ).fetchall()
    daily = pd.DataFrame(rows, columns=["product_id", "sold_on", "quantity"])
    weekly, series = build_weekly_series(daily, products, today, settings.min_weeks)

    with conn.transaction():
        conn.execute("DELETE FROM weekly_sales")
        conn.execute("DELETE FROM forecast_series")
        with conn.cursor().copy("COPY weekly_sales (product_id, week_start, quantity) FROM STDIN") as copy:
            for record in weekly.itertuples(index=False):
                copy.write_row((record.product_id, record.week_start, record.quantity))
        with conn.cursor().copy(
            """COPY forecast_series (product_id, first_week, last_week, weeks_of_history,
                                     total_quantity, status) FROM STDIN"""
        ) as copy:
            for s in series.itertuples(index=False):
                copy.write_row((s.product_id, s.first_week, s.last_week, s.weeks_of_history, s.total_quantity, s.status))

    ready = int((series["status"] == READY).sum()) if not series.empty else 0
    return {
        "total": len(products),
        "ready": ready,
        "insufficient": len(products) - ready,
        "weeks": len(weekly),
    }
