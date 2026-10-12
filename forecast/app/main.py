"""API del servicio de pronóstico y del modelo del asistente.

- GET  /health              → estado del servicio y de la base de datos.
- POST /runs                → prepara los datos ahora (HU-18; lo llama la API de StockSense).
- GET  /runs                → últimas ejecuciones del flujo de datos.
- POST /assistant/predict   → función más probable y su confianza (HU-33).
- POST /assistant/similar   → fichas más parecidas a una pregunta (T-35.1).

El reentrenamiento del pronóstico y del asistente no tiene endpoint: la API encola trabajos
en `ml_jobs` y este servicio los toma (ver jobs.py).
"""

from __future__ import annotations

import asyncio
import logging
import time
from contextlib import asynccontextmanager, suppress
from typing import Annotated

import psycopg
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from .assistant import RUNTIME
from .config import Settings, load_settings
from .jobs import worker_loop
from .pipeline import PipelineBusy, list_runs, run_pipeline
from .scheduler import run_daily

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def get_settings() -> Settings:
    return load_settings()


SettingsDep = Annotated[Settings, Depends(get_settings)]


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = load_settings()
    tasks = [asyncio.create_task(run_daily(settings)), asyncio.create_task(worker_loop(settings))]
    yield
    for task in tasks:
        task.cancel()
    for task in tasks:
        with suppress(asyncio.CancelledError):
            await task


app = FastAPI(title="StockSense · Servicio de pronóstico", version="0.2.0", lifespan=lifespan)


def require_token(
    settings: SettingsDep,
    x_internal_token: Annotated[str | None, Header()] = None,
) -> None:
    if settings.token and x_internal_token != settings.token:
        raise HTTPException(status_code=401, detail="Token interno inválido.")


class RunRequest(BaseModel):
    trigger: str = "MANUAL"
    requestedBy: str | None = None


@app.get("/health")
def health(settings: SettingsDep) -> dict:
    try:
        with psycopg.connect(settings.database_url, connect_timeout=3) as conn:
            conn.execute("SELECT 1")
    except Exception as error:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"Sin conexión a la base de datos: {error}") from error
    return {"status": "ok", "service": "forecast", "database": "ok"}


@app.post("/runs", dependencies=[Depends(require_token)])
async def create_run(body: RunRequest, settings: SettingsDep) -> dict:
    trigger = body.trigger if body.trigger in {"MANUAL", "SCHEDULED"} else "MANUAL"
    try:
        return await run_in_threadpool(run_pipeline, settings, trigger, body.requestedBy)
    except PipelineBusy as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@app.get("/runs", dependencies=[Depends(require_token)])
def get_runs(settings: SettingsDep) -> list[dict]:
    return list_runs(settings)


class PredictRequest(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    previous: list[str] = Field(default_factory=list, max_length=10)


class SimilarRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    k: int = Field(default=4, ge=1, le=10)


def _model(settings: Settings):
    model, version = RUNTIME.get(settings)
    if model is None:
        raise HTTPException(status_code=503, detail="El modelo del asistente aún no está entrenado.")
    return model, version


@app.post("/assistant/predict", dependencies=[Depends(require_token)])
def assistant_predict(body: PredictRequest, settings: SettingsDep) -> dict:
    model, version = _model(settings)
    started = time.perf_counter()
    result = model.predict(body.text, body.previous)
    return {**result, "version": version, "latencyMs": round((time.perf_counter() - started) * 1000, 2)}


@app.post("/assistant/similar", dependencies=[Depends(require_token)])
def assistant_similar(body: SimilarRequest, settings: SettingsDep) -> dict:
    model, version = _model(settings)
    return {"version": version, "items": model.similar(body.text, body.k)}
