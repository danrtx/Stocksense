"""Configuración leída de variables de entorno. Ningún secreto vive en el código."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from zoneinfo import ZoneInfo

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


@dataclass(frozen=True)
class Settings:
    database_url: str
    token: str
    timezone: ZoneInfo
    daily_at: str | None
    min_weeks: int
    keep_runs: int
    # Cola de trabajos (HU-22)
    worker_enabled: bool = True
    job_poll_seconds: float = 5.0
    retry_delay_seconds: int = 300
    stale_job_minutes: int = 120
    # Avisos por correo (T-22.3)
    smtp_host: str = ""
    smtp_port: int = 1025
    smtp_user: str = ""
    smtp_pass: str = ""
    mail_from: str = "StockSense <no-reply@stocksense.local>"
    tech_alert_emails: list[str] = field(default_factory=list)
    frontend_url: str = "http://localhost:8080"
    # Asistente (HU-33)
    assistant_test_set: Path = DATA_DIR / "assistant_test.json"


def load_settings() -> Settings:
    daily_at = os.getenv("PIPELINE_DAILY_AT", "02:00").strip()
    return Settings(
        database_url=os.getenv("DATABASE_URL", ""),
        token=os.getenv("FORECAST_TOKEN", ""),
        timezone=ZoneInfo(os.getenv("PIPELINE_TIMEZONE", "America/Bogota")),
        # Vacío desactiva la ejecución programada (útil en pruebas).
        daily_at=daily_at or None,
        min_weeks=int(os.getenv("MIN_WEEKS_FOR_FORECAST", "12")),
        keep_runs=int(os.getenv("PIPELINE_KEEP_RUNS", "30")),
        worker_enabled=os.getenv("JOB_WORKER", "on").strip().lower() not in {"off", "0", "false", "no"},
        job_poll_seconds=float(os.getenv("JOB_POLL_SECONDS", "5")),
        retry_delay_seconds=int(os.getenv("JOB_RETRY_DELAY_SECONDS", "300")),
        stale_job_minutes=int(os.getenv("JOB_STALE_MINUTES", "120")),
        smtp_host=os.getenv("SMTP_HOST", "").strip(),
        smtp_port=int(os.getenv("SMTP_PORT", "1025")),
        smtp_user=os.getenv("SMTP_USER", ""),
        smtp_pass=os.getenv("SMTP_PASS", ""),
        mail_from=os.getenv("MAIL_FROM", "StockSense <no-reply@stocksense.local>"),
        tech_alert_emails=[e.strip() for e in os.getenv("TECH_ALERT_EMAILS", "").split(",") if e.strip()],
        frontend_url=os.getenv("FRONTEND_URL", "http://localhost:8080").rstrip("/"),
    )
