from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
from typing import Any

from .analytics import build_analytics
from .config import Settings
from .storage import LocalManualEventStore


DATA_FILES = {
    "calendario": "calendario_br.json",
    "kpis": "kpis_dia.json",
    "funil": "funil_dia.json",
    "produtos": "produtos_dia.json",
    "campanhas": "campanhas_dia.json",
    "utms": "utms_dia.json",
    "estoque": "estoque.json",
    "metas": "metas_comerciais.json",
    "manifest": "manifest.json",
}


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


class RefreshService:
    def __init__(self, settings: Settings, event_store: LocalManualEventStore):
        self.settings = settings
        self.event_store = event_store
        self.cache: dict[str, Any] = {}
        self.updated_at: str | None = None
        self.next_update_at: str | None = None
        self.is_refreshing = False
        self.last_error: str | None = None
        self.source_status: dict[str, Any] = {}
        self._lock = asyncio.Lock()
        self._stop = asyncio.Event()

    async def get_calendar_data(self) -> dict[str, Any]:
        if not self.cache:
            await self.refresh(reason="initial_load")
        return {**self.cache, "atualizado_em": self.updated_at}

    async def get_status(self) -> dict[str, Any]:
        return {
            "updated_at": self.updated_at,
            "next_update_at": self.next_update_at,
            "is_refreshing": self.is_refreshing,
            "source_status": self.source_status,
        }

    async def refresh(self, reason: str = "manual") -> dict[str, Any]:
        if self._lock.locked():
            return {
                "success": False,
                "is_refreshing": True,
                "message": "Atualização já está em andamento.",
            }

        async with self._lock:
            self.is_refreshing = True
            try:
                payload, source_status = self._load_sources()
                self.cache = payload
                self.updated_at = iso_now()
                self.next_update_at = self._next_update_iso()
                self.last_error = None
                self.source_status = {
                    **source_status,
                    "reason": reason,
                    "bigquery": self._bigquery_status(),
                    "events_storage": self.settings.events_storage,
                    "event_mutations_enabled": self.settings.event_mutations_enabled,
                    "refresh_loop_enabled": self.settings.enable_refresh_loop,
                }
                consolidated_status = self._write_consolidated(payload)
                self.source_status["consolidado"] = consolidated_status
                return {
                    "success": True,
                    "updated_at": self.updated_at,
                    "next_update_at": self.next_update_at,
                    "source_status": self.source_status,
                }
            except Exception as error:  # noqa: BLE001 - erro precisa voltar para o status da API
                self.last_error = str(error)
                self.source_status = {
                    **self.source_status,
                    "error": self.last_error,
                }
                return {
                    "success": False,
                    "is_refreshing": False,
                    "message": self.last_error,
                }
            finally:
                self.is_refreshing = False

    def apply_event_change(self, event: dict[str, Any], reason: str = "event_changed") -> None:
        if not self.cache:
            return

        event_id = str(event.get("event_id") or event.get("id") or "")
        if not event_id:
            return

        current_events = [
            item
            for item in self.cache.get("eventos_manuais", [])
            if str(item.get("event_id") or item.get("id") or "") != event_id
        ]

        if self._is_active_event(event):
            current_events.append(event)

        current_events = sorted(current_events, key=lambda item: str(item.get("data_inicio") or item.get("data") or ""))
        self.cache["eventos_manuais"] = current_events
        self.cache["analytics"] = build_analytics(self.cache)
        self.cache["atualizado_em"] = iso_now()
        self.updated_at = self.cache["atualizado_em"]
        self.next_update_at = self._next_update_iso()
        self.last_error = None
        self.source_status = {
            **self.source_status,
            "eventos_manuais": f"{len(current_events)} ativo(s)",
            "analytics": "ok",
            "reason": reason,
            "events_storage": self.settings.events_storage,
            "event_mutations_enabled": self.settings.event_mutations_enabled,
            "refresh_loop_enabled": self.settings.enable_refresh_loop,
            "consolidado": "cache em memoria atualizado por evento manual",
        }

    async def refresh_loop(self) -> None:
        while not self._stop.is_set():
            await asyncio.sleep(max(60, self.settings.refresh_interval_minutes * 60))
            if self._stop.is_set():
                break
            await self.refresh(reason="scheduled")

    def stop(self) -> None:
        self._stop.set()

    def _load_sources(self) -> tuple[dict[str, Any], dict[str, Any]]:
        payload: dict[str, Any] = {}
        source_status: dict[str, Any] = {"files": {}}

        for key, filename in DATA_FILES.items():
            file_path = self.settings.data_dir / filename
            payload[key] = self._read_json(file_path)
            source_status["files"][filename] = "ok" if file_path.exists() else "missing"

        payload["eventos_manuais"] = self.event_store.list_events(include_deleted=False)
        payload["atualizado_em"] = iso_now()
        payload["analytics"] = build_analytics(payload)
        source_status["eventos_manuais"] = f"{len(payload['eventos_manuais'])} ativo(s)"
        source_status["analytics"] = "ok"
        return payload, source_status

    def _read_json(self, file_path: Path) -> Any:
        if not file_path.exists():
            return []
        data = json.loads(file_path.read_text(encoding="utf-8") or "[]")
        return data

    def _write_consolidated(self, payload: dict[str, Any]) -> str:
        output = self.settings.data_dir / "consolidado.json"
        try:
            output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            return "ok"
        except OSError as error:
            return f"cache em memória; não foi possível gravar consolidado.json ({error})"

    def _is_active_event(self, event: dict[str, Any]) -> bool:
        status = str(event.get("status") or "").strip().lower()
        return not status.startswith("exclu") and not event.get("deleted_at")

    def _next_update_iso(self) -> str:
        next_update = datetime.now(timezone.utc) + timedelta(minutes=self.settings.refresh_interval_minutes)
        return next_update.isoformat(timespec="seconds").replace("+00:00", "Z")

    def _bigquery_status(self) -> str:
        if self.settings.bq_credentials_path.exists():
            return "credencial encontrada; integração pendente nesta etapa"
        return "mock_json; credencial BigQuery não configurada"
