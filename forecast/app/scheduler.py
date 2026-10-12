"""Ejecución programada diaria del flujo de datos (criterio 3 de HU-18)."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, time, timedelta

from .config import Settings
from .pipeline import PipelineBusy, run_pipeline

log = logging.getLogger("stocksense.forecast")


def seconds_until(daily_at: str, now: datetime) -> float:
    """Segundos hasta la próxima hora HH:MM en la zona horaria de `now`."""
    hour, minute = (int(part) for part in daily_at.split(":"))
    target = datetime.combine(now.date(), time(hour, minute), tzinfo=now.tzinfo)
    if target <= now:
        target += timedelta(days=1)
    return (target - now).total_seconds()


async def run_daily(settings: Settings) -> None:
    if not settings.daily_at:
        log.info("Ejecución programada desactivada (PIPELINE_DAILY_AT vacío).")
        return
    while True:
        wait = seconds_until(settings.daily_at, datetime.now(settings.timezone))
        log.info("Próxima ejecución programada en %.0f minutos.", wait / 60)
        await asyncio.sleep(wait)
        try:
            await asyncio.to_thread(run_pipeline, settings, "SCHEDULED", None)
        except PipelineBusy:
            log.warning("Se omitió la ejecución programada: ya había una en curso.")
        except Exception as error:  # noqa: BLE001 - el ciclo nunca debe morir
            log.error("La ejecución programada no pudo iniciar: %s", error)
