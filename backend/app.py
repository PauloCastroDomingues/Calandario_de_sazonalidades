from __future__ import annotations

import asyncio
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .config import settings
from .refresh import RefreshService
from .storage import build_event_store


class ManualEventPayload(BaseModel):
    data_inicio: str
    data_fim: str | None = None
    titulo: str
    tipo: str = "Campanha"
    categoria: str | None = None
    produto_relacionado: str | None = None
    campanha_relacionada: str | None = None
    prioridade: str = "Média"
    responsavel: str | None = None
    observacao: str | None = None
    status: str = "Ativo"


event_store = build_event_store(settings)
refresh_service = RefreshService(settings, event_store)

app = FastAPI(
    title="Calendário Comercial Reise API",
    version="0.4.5",
    description="Backend central para calendário, eventos manuais e cache de dados comerciais.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://calendario-reise.vercel.app",
        "http://localhost:5500",
        "http://127.0.0.1:5500",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "http://localhost:8001",
        "http://127.0.0.1:8001",
    ],
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

app.mount("/src", StaticFiles(directory=settings.project_root / "src"), name="src")
app.mount("/data", StaticFiles(directory=settings.project_root / "data"), name="data")


@app.on_event("startup")
async def startup() -> None:
    await refresh_service.refresh(reason="startup")
    if settings.enable_refresh_loop:
        app.state.refresh_task = asyncio.create_task(refresh_service.refresh_loop())


@app.on_event("shutdown")
async def shutdown() -> None:
    refresh_service.stop()
    task = getattr(app.state, "refresh_task", None)
    if task:
        task.cancel()


@app.get("/", include_in_schema=False)
async def root() -> FileResponse:
    return FileResponse(settings.project_root / "dashboard.html")


@app.get("/dashboard.html", include_in_schema=False)
async def dashboard() -> FileResponse:
    return FileResponse(settings.project_root / "dashboard.html")


@app.get("/api/status")
async def api_status() -> dict[str, Any]:
    return await refresh_service.get_status()


@app.get("/api/calendar-data")
async def api_calendar_data() -> dict[str, Any]:
    return await refresh_service.get_calendar_data()


@app.get("/api/analytics")
async def api_analytics() -> dict[str, Any]:
    payload = await refresh_service.get_calendar_data()
    return payload.get("analytics") or {}


@app.post("/api/refresh")
async def api_refresh() -> dict[str, Any]:
    return await refresh_service.refresh(reason="manual")


@app.get("/api/events")
async def api_events() -> list[dict[str, Any]]:
    return event_store.list_events(include_deleted=False)


@app.post("/api/events")
async def api_create_event(payload: ManualEventPayload, request: Request) -> dict[str, Any]:
    ensure_event_mutations_enabled()
    event = event_store.create_event(payload_to_dict(payload), resolve_user(request, payload.responsavel))
    await refresh_service.refresh(reason="event_created")
    return event


@app.put("/api/events/{event_id}")
async def api_update_event(event_id: str, payload: ManualEventPayload, request: Request) -> dict[str, Any]:
    ensure_event_mutations_enabled()
    event = event_store.update_event(event_id, payload_to_dict(payload), resolve_user(request, payload.responsavel))
    if not event:
        raise HTTPException(status_code=404, detail="Evento manual não encontrado.")
    await refresh_service.refresh(reason="event_updated")
    return event


@app.delete("/api/events/{event_id}")
async def api_delete_event(event_id: str, request: Request) -> dict[str, Any]:
    ensure_event_mutations_enabled()
    event = event_store.delete_event(event_id, resolve_user(request, None))
    if not event:
        raise HTTPException(status_code=404, detail="Evento manual não encontrado.")
    await refresh_service.refresh(reason="event_deleted")
    return event


def resolve_user(request: Request, fallback: str | None) -> str:
    return (
        request.headers.get("x-user-email")
        or request.headers.get("x-user")
        or fallback
        or "dashboard-local"
    )


def payload_to_dict(payload: ManualEventPayload) -> dict[str, Any]:
    if hasattr(payload, "model_dump"):
        return payload.model_dump()
    return payload.dict()


def ensure_event_mutations_enabled() -> None:
    if not settings.event_mutations_enabled:
        raise HTTPException(
            status_code=501,
            detail="Escrita de eventos manuais desativada neste deploy sem storage persistente.",
        )
