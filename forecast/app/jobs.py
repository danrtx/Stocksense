"""T-22.1: cola de trabajos de aprendizaje automático.

La API (o el horario semanal) inserta filas en `ml_jobs`; este servicio las toma una por
una con `FOR UPDATE SKIP LOCKED`, así varias copias del servicio nunca toman el mismo
trabajo. Si un trabajo falla se reintenta después de `JOB_RETRY_DELAY_SECONDS`; si vuelve a
fallar queda FAILED y se avisa por correo al equipo técnico (T-22.3).

Trabajos:
- FORECAST_RETRAIN: prepara los datos (HU-18) y recalcula el pronóstico (HU-19), comparando
  el modelo nuevo contra el vigente (HU-22).
- ASSISTANT_TRAIN: entrena el modelo propio del asistente (HU-33).
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import datetime, timedelta

import psycopg
from psycopg.rows import dict_row

from .assistant import articles_hash, train_assistant
from .config import Settings
from .forecasting import run_forecast
from .notify import send_failure_alert
from .pipeline import run_pipeline

log = logging.getLogger("stocksense.jobs")

SCHEDULE_EVERY_SECONDS = 60
DEFAULT_RETRAIN = {"enabled": True, "weekday": 1, "time": "03:00"}


def enqueue(conn: psycopg.Connection, kind: str, trigger: str, requested_by: str | None = None, slot: str | None = None):
    """Encola un trabajo. Con `slot`, el mismo turno nunca se encola dos veces."""
    row = conn.execute(
        """INSERT INTO ml_jobs (kind, trigger, requested_by, slot) VALUES (%s, %s, %s, %s)
           ON CONFLICT (kind, slot) WHERE slot IS NOT NULL DO NOTHING RETURNING id""",
        (kind, trigger, requested_by, slot),
    ).fetchone()
    return None if row is None else (row["id"] if isinstance(row, dict) else row[0])


def claim(conn: psycopg.Connection) -> dict | None:
    return conn.execute(
        """UPDATE ml_jobs SET status = 'RUNNING', started_at = now(), attempts = attempts + 1, error = NULL
            WHERE id = (SELECT id FROM ml_jobs WHERE status = 'QUEUED' AND run_after <= now()
                         ORDER BY run_after, queued_at FOR UPDATE SKIP LOCKED LIMIT 1)
        RETURNING *"""
    ).fetchone()


def execute(settings: Settings, job: dict) -> dict:
    if job["kind"] == "FORECAST_RETRAIN":
        pipeline = run_pipeline(settings, "SCHEDULED" if job["trigger"] == "SCHEDULED" else "MANUAL", job["requested_by"])
        if pipeline["status"] != "SUCCESS":
            raise RuntimeError(f"La preparación de datos falló: {(pipeline.get('error') or '').splitlines()[0]}")
        forecast = run_forecast(settings, job["trigger"], job["requested_by"], str(job["id"]))
        return {"pipelineRunId": pipeline["id"], **forecast}
    if job["kind"] == "ASSISTANT_TRAIN":
        return train_assistant(settings, job["trigger"], str(job["id"]))
    raise ValueError(f"Tipo de trabajo desconocido: {job['kind']}")


def process_next(settings: Settings) -> bool:
    """Toma y ejecuta un trabajo. Devuelve False si la cola estaba vacía."""
    with psycopg.connect(settings.database_url, row_factory=dict_row, autocommit=True) as conn:
        job = claim(conn)
        if job is None:
            return False
        log.info("Trabajo %s (%s), intento %s.", job["id"], job["kind"], job["attempts"])
        started = time.monotonic()
        try:
            result = execute(settings, job)
        except Exception as error:  # noqa: BLE001 - toda falla se registra y se avisa
            fail(settings, conn, job, str(error) or error.__class__.__name__)
            return True
        conn.execute(
            "UPDATE ml_jobs SET status = 'SUCCESS', finished_at = now(), result = %s WHERE id = %s",
            (json.dumps({**result, "durationMs": int((time.monotonic() - started) * 1000)}, default=str), job["id"]),
        )
        return True


def fail(settings: Settings, conn: psycopg.Connection, job: dict, error: str) -> None:
    if job["attempts"] < job["max_attempts"]:
        log.warning("Trabajo %s falló (%s); se reintenta en %s s.", job["id"], error, settings.retry_delay_seconds)
        conn.execute(
            """UPDATE ml_jobs SET status = 'QUEUED', error = %s, run_after = now() + make_interval(secs => %s)
                WHERE id = %s""",
            (error[:4000], settings.retry_delay_seconds, job["id"]),
        )
        return
    log.error("Trabajo %s falló definitivamente: %s", job["id"], error)
    conn.execute("UPDATE ml_jobs SET status = 'FAILED', finished_at = now(), error = %s WHERE id = %s", (error[:4000], job["id"]))
    if send_failure_alert(settings, conn, job, error):
        conn.execute("UPDATE ml_jobs SET alert_sent_at = now() WHERE id = %s", (job["id"],))


def retrain_slot(config: dict, now: datetime) -> datetime | None:
    """Turno de reentrenamiento de esta semana si ya llegó su hora (weekday: 1 = lunes … 7 = domingo)."""
    if not config.get("enabled"):
        return None
    hour, minute = (int(p) for p in str(config.get("time", "03:00")).split(":"))
    weekday = int(config.get("weekday", 1))
    monday = (now - timedelta(days=now.weekday())).replace(hour=hour, minute=minute, second=0, microsecond=0)
    slot = monday + timedelta(days=weekday - 1)
    return slot if now >= slot else None


def get_setting(conn: psycopg.Connection, key: str, default):
    row = conn.execute("SELECT value FROM app_settings WHERE key = %s", (key,)).fetchone()
    return default if row is None else row["value"]


def schedule(settings: Settings, now: datetime | None = None) -> None:
    """Encola lo que toca: el reentrenamiento semanal y, si cambiaron las fichas, el asistente."""
    now = now or datetime.now(settings.timezone)
    with psycopg.connect(settings.database_url, row_factory=dict_row, autocommit=True) as conn:
        config = {**DEFAULT_RETRAIN, **(get_setting(conn, "forecast.retrain", DEFAULT_RETRAIN) or {})}
        slot = retrain_slot(config, now)
        if slot is not None and enqueue(conn, "FORECAST_RETRAIN", "SCHEDULED", None, f"retrain:{slot:%Y-%m-%dT%H:%M}"):
            log.info("Reentrenamiento programado encolado (%s).", f"{slot:%Y-%m-%d %H:%M}")
        ensure_assistant_model(conn)


def ensure_assistant_model(conn: psycopg.Connection) -> None:
    """Si no hay modelo del asistente o las fichas cambiaron, encola un entrenamiento (una vez por cambio)."""
    digest, count = articles_hash(conn)
    if count == 0:
        return
    active = conn.execute("SELECT articles_hash FROM assistant_models WHERE is_active").fetchone()
    if active and active["articles_hash"] == digest:
        return
    if enqueue(conn, "ASSISTANT_TRAIN", "AUTO", None, f"assistant:{digest}"):
        log.info("Las fichas cambiaron: se encoló el entrenamiento del asistente.")


def recover_stale(settings: Settings) -> None:
    """Trabajos que quedaron RUNNING porque el servicio se apagó a la mitad."""
    with psycopg.connect(settings.database_url, row_factory=dict_row, autocommit=True) as conn:
        for job in conn.execute(
            """SELECT * FROM ml_jobs WHERE status = 'RUNNING' AND started_at < now() - make_interval(mins => %s)""",
            (settings.stale_job_minutes,),
        ).fetchall():
            fail(settings, conn, job, "El trabajo se interrumpió (el servicio se reinició mientras corría).")


async def worker_loop(settings: Settings) -> None:
    if not settings.worker_enabled or not settings.database_url:
        log.info("Cola de trabajos desactivada.")
        return
    last_schedule = 0.0
    try:
        await asyncio.to_thread(recover_stale, settings)
    except Exception as error:  # noqa: BLE001
        log.error("No se pudieron revisar los trabajos interrumpidos: %s", error)
    while True:
        try:
            if time.monotonic() - last_schedule >= SCHEDULE_EVERY_SECONDS:
                await asyncio.to_thread(schedule, settings)
                last_schedule = time.monotonic()
            while await asyncio.to_thread(process_next, settings):
                pass
        except Exception as error:  # noqa: BLE001 - el ciclo nunca debe morir
            log.error("Error en la cola de trabajos: %s", error)
        await asyncio.sleep(settings.job_poll_seconds)
