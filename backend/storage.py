from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any
from urllib import error, parse, request
from uuid import uuid4

from .config import Settings


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def is_active_event(event: dict[str, Any]) -> bool:
    status = str(event.get("status", "")).strip().lower()
    return not status.startswith("exclu") and not event.get("deleted_at")


def public_event(event: dict[str, Any]) -> dict[str, Any]:
    event_id = event.get("event_id") or event.get("id") or f"manual_{uuid4().hex}"
    return {
        **event,
        "id": event_id,
        "event_id": event_id,
        "status": event.get("status") or "Ativo",
    }


class LocalManualEventStore:
    """MVP compartilhado: persiste eventos manuais em data/eventos_manuais.json."""

    def __init__(self, settings: Settings):
        self.path = settings.data_dir / "eventos_manuais.json"
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self.path.write_text("[]\n", encoding="utf-8")

    def list_events(self, include_deleted: bool = False) -> list[dict[str, Any]]:
        events = [public_event(event) for event in self._read_all()]
        if not include_deleted:
            events = [event for event in events if is_active_event(event)]
        return sorted(events, key=lambda item: str(item.get("data_inicio") or item.get("data") or ""))

    def create_event(self, payload: dict[str, Any], user: str) -> dict[str, Any]:
        now = utc_now()
        event_id = payload.get("event_id") or payload.get("id") or f"manual_{uuid4().hex}"
        event = public_event(
            {
                **payload,
                "id": event_id,
                "event_id": event_id,
                "status": payload.get("status") or "Ativo",
                "created_by": payload.get("created_by") or user,
                "created_at": payload.get("created_at") or now,
                "updated_by": payload.get("updated_by") or user,
                "updated_at": payload.get("updated_at") or now,
            }
        )
        events = [event for event in self._read_all() if (event.get("event_id") or event.get("id")) != event_id]
        events.append(event)
        self._write_all(events)
        return event

    def update_event(self, event_id: str, payload: dict[str, Any], user: str) -> dict[str, Any] | None:
        events = self._read_all()
        updated = None
        for index, event in enumerate(events):
            current_id = event.get("event_id") or event.get("id")
            if current_id != event_id:
                continue
            updated = public_event(
                {
                    **event,
                    **payload,
                    "id": event_id,
                    "event_id": event_id,
                    "created_by": event.get("created_by") or user,
                    "created_at": event.get("created_at") or utc_now(),
                    "updated_by": user,
                    "updated_at": utc_now(),
                }
            )
            events[index] = updated
            break
        if not updated:
            return None
        self._write_all(events)
        return updated

    def delete_event(self, event_id: str, user: str) -> dict[str, Any] | None:
        events = self._read_all()
        deleted = None
        for index, event in enumerate(events):
            current_id = event.get("event_id") or event.get("id")
            if current_id != event_id:
                continue
            deleted = public_event(
                {
                    **event,
                    "id": event_id,
                    "event_id": event_id,
                    "status": "Excluído",
                    "deleted_at": utc_now(),
                    "updated_by": user,
                    "updated_at": utc_now(),
                }
            )
            events[index] = deleted
            break
        if not deleted:
            return None
        self._write_all(events)
        return deleted

    def _read_all(self) -> list[dict[str, Any]]:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8") or "[]")
            return data if isinstance(data, list) else []
        except (OSError, json.JSONDecodeError):
            return []

    def _write_all(self, events: list[dict[str, Any]]) -> None:
        self.path.write_text(json.dumps(events, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


class BigQueryManualEventStore(LocalManualEventStore):
    """Placeholder enterprise: mantém a interface pronta para app_calendar.manual_events."""


class AppsScriptManualEventStore:
    """Storage compartilhado: usa Apps Script como ponte para Google Sheets."""

    def __init__(self, settings: Settings):
        if not settings.events_apps_script_url:
            raise ValueError("EVENTS_APPS_SCRIPT_URL precisa estar configurada para EVENTS_STORAGE=apps_script.")
        self.url = settings.events_apps_script_url

    def list_events(self, include_deleted: bool = False) -> list[dict[str, Any]]:
        payload = self._request_json(params={"includeDeleted": "1" if include_deleted else "0"})
        events = payload.get("events", []) if isinstance(payload, dict) else []
        normalized = [public_event(event) for event in events if isinstance(event, dict)]
        if not include_deleted:
            normalized = [event for event in normalized if is_active_event(event)]
        return sorted(normalized, key=lambda item: str(item.get("data_inicio") or item.get("data") or ""))

    def create_event(self, payload: dict[str, Any], user: str) -> dict[str, Any]:
        response = self._request_json(
            payload={
                "action": "create",
                "event": payload,
                "user": user,
                "sync_github": False,
            }
        )
        return public_event(response.get("event") or payload)

    def update_event(self, event_id: str, payload: dict[str, Any], user: str) -> dict[str, Any] | None:
        response = self._request_json(
            payload={
                "action": "update",
                "event_id": event_id,
                "event": payload,
                "user": user,
                "sync_github": False,
            }
        )
        event = response.get("event")
        return public_event(event) if isinstance(event, dict) else None

    def delete_event(self, event_id: str, user: str) -> dict[str, Any] | None:
        response = self._request_json(
            payload={
                "action": "delete",
                "event_id": event_id,
                "user": user,
                "sync_github": False,
            }
        )
        event = response.get("event")
        return public_event(event) if isinstance(event, dict) else None

    def _request_json(
        self,
        payload: dict[str, Any] | None = None,
        params: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        url = self.url
        if params:
            separator = "&" if "?" in url else "?"
            url = f"{url}{separator}{parse.urlencode(params)}"

        data = None
        headers = {"Accept": "application/json"}
        method = "GET"
        if payload is not None:
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json; charset=utf-8"
            method = "POST"

        try:
            remote_request = request.Request(url, data=data, headers=headers, method=method)
            with request.urlopen(remote_request, timeout=45) as response:
                raw_body = response.read().decode("utf-8")
        except error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Apps Script respondeu HTTP {exc.code}: {detail}") from exc
        except error.URLError as exc:
            raise RuntimeError(f"Nao foi possivel acessar o Apps Script: {exc.reason}") from exc

        try:
            parsed = json.loads(raw_body or "{}")
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"Apps Script retornou JSON invalido: {raw_body[:200]}") from exc

        if isinstance(parsed, dict) and parsed.get("success") is False:
            raise RuntimeError(str(parsed.get("error") or "Apps Script recusou a operacao."))
        if not isinstance(parsed, dict):
            raise RuntimeError("Apps Script precisa retornar um objeto JSON.")
        return parsed


class GoogleSheetsManualEventStore(AppsScriptManualEventStore):
    """Alias operacional: Google Sheets entra pelo Web App do Apps Script."""


def build_event_store(settings: Settings) -> LocalManualEventStore | AppsScriptManualEventStore:
    if settings.events_storage == "bigquery":
        return BigQueryManualEventStore(settings)
    if settings.events_storage in {"apps_script", "sheets", "google_sheets"}:
        return GoogleSheetsManualEventStore(settings)
    return LocalManualEventStore(settings)
