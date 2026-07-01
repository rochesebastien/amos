"""Shared httpx client factory that routes every outbound request through the
configured proxy (if any).

The proxy is a single global application setting, so we cache it in-process and
refresh it whenever settings are read or updated (see ``config.refresh_proxy``).
Any service making outbound HTTP calls should build its client through
``async_client`` so the proxy is applied uniformly (LLM gateway, model
discovery, remote MCPs, OpenAPI tools, ...).
"""
from __future__ import annotations

import httpx

# Outbound proxy URL, e.g. "http://user:pass@host:3128" or "socks5://host:1080".
# Empty string means a direct connection.
_proxy: str = ""


def set_proxy(url: str | None) -> None:
    """Update the process-wide outbound proxy."""
    global _proxy
    _proxy = (url or "").strip()


def get_proxy() -> str:
    return _proxy


def async_client(**kwargs) -> httpx.AsyncClient:
    """Build an ``httpx.AsyncClient`` honoring the configured outbound proxy.

    Callers keep passing their usual kwargs (timeout, headers, ...); the proxy
    is injected only when one is configured, so behaviour is unchanged when it
    is empty.
    """
    if _proxy:
        kwargs.setdefault("proxy", _proxy)
    return httpx.AsyncClient(**kwargs)
