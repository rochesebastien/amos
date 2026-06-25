"""Read/write the key/value Setting store."""
from __future__ import annotations

from dataclasses import dataclass

from sqlmodel import Session, select

from ..models import Setting

DEFAULTS = {
    "llm_base_url": "",
    "llm_api_key": "",
    "llm_model": "",
    "max_tool_iterations": "6",
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
