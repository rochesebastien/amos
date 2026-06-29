"""Read/write the key/value Setting store."""
from __future__ import annotations

import json
from dataclasses import dataclass

from sqlmodel import Session, select

from ..models import Setting

DEFAULTS = {
    "llm_base_url": "",
    "llm_api_key": "",
    "llm_model": "",
    "max_tool_iterations": "6",
    "language": "en",
    # JSON-encoded list of model ids the user has activated for use in chat
    "enabled_models": "[]",
}


def get_setting(session: Session, key: str, default: str = "") -> str:
    row = session.get(Setting, key)
    if row is None:
        return DEFAULTS.get(key, default)
    return row.value


def set_setting(session: Session, key: str, value: str) -> None:
    row = session.get(Setting, key)
    if row is None:
        row = Setting(key=key, value=value)
    else:
        row.value = value
    session.add(row)


def all_settings(session: Session) -> dict[str, str]:
    out = dict(DEFAULTS)
    for row in session.exec(select(Setting)).all():
        out[row.key] = row.value
    return out


@dataclass
class LLMConfig:
    base_url: str
    api_key: str
    model: str

    @property
    def configured(self) -> bool:
        return bool(self.base_url)


def get_llm_config(session: Session) -> LLMConfig:
    s = all_settings(session)
    base = (s.get("llm_base_url") or "").rstrip("/")
    return LLMConfig(base_url=base, api_key=s.get("llm_api_key", ""), model=s.get("llm_model", ""))


def parse_enabled_models(raw: str) -> list[dict]:
    """Normalise the enabled_models setting to a list of dicts.

    Each entry: {"id": str, "base_url": str, "api_key": str}. Legacy values
    stored as a plain list of strings are coerced (no per-model overrides).
    """
    try:
        value = json.loads(raw or "[]")
    except (ValueError, TypeError):
        return []
    if not isinstance(value, list):
        return []
    out: list[dict] = []
    for item in value:
        if isinstance(item, str):
            out.append({"id": item, "base_url": "", "api_key": ""})
        elif isinstance(item, dict) and item.get("id"):
            out.append(
                {
                    "id": str(item["id"]),
                    "base_url": str(item.get("base_url", "") or ""),
                    "api_key": str(item.get("api_key", "") or ""),
                }
            )
    return out


def get_enabled_models(session: Session) -> list[dict]:
    return parse_enabled_models(get_setting(session, "enabled_models", "[]"))


def get_llm_config_for_model(session: Session, model: str) -> LLMConfig:
    """Resolve the effective connection for a model: per-model override if set,
    otherwise the global gateway connection."""
    base = ""
    key = ""
    for m in get_enabled_models(session):
        if m["id"] == model:
            base = m.get("base_url", "")
            key = m.get("api_key", "")
            break
    glob = get_llm_config(session)
    return LLMConfig(
        base_url=(base or glob.base_url).rstrip("/"),
        api_key=key or glob.api_key,
        model=model,
    )
