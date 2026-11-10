"""
Key Rotator and API Key Cascading Manager.

Enables automatic pooling and cascading across multiple API keys for Groq and OpenAI:
- Configured via GROQ_API_KEY or GROQ_API_KEYS (comma, semicolon, or newline separated)
- Configured via OPENAI_API_KEY or OPENAI_API_KEYS (comma, semicolon, or newline separated)

When a rate limit (TPM/RPM, daily quota, HTTP 429) or authentication error occurs on one key,
the KeyRotator automatically rotates to the next available key without interrupting
ongoing single or batch evaluations.
"""

from __future__ import annotations

import logging
import os
import re
import threading
import time
from typing import Dict, List, Optional, Set

logger = logging.getLogger(__name__)

# Known placeholder values that should never be treated as valid API keys
PLACEHOLDER_KEYS: Set[str] = {
    "gsk-placeholder",
    "sk-placeholder",
    "replace_with_groq_api_key",
    "replace_with_openai_api_key",
    "your_groq_api_key_here",
    "your_openai_api_key_here",
    "none",
    "null",
    "false",
    "",
}


def mask_key(key: Optional[str]) -> str:
    """Safely mask an API key for logs and diagnostics (e.g. 'gsk_abc...wxyz')."""
    if not key or not isinstance(key, str):
        return "<none>"
    cleaned = key.strip()
    if len(cleaned) <= 8:
        return "***"
    return f"{cleaned[:6]}...{cleaned[-4:]}"


def parse_key_list(raw_value: Optional[str]) -> List[str]:
    """
    Parse a delimiter-separated string or single value into a deduplicated list of clean API keys.
    Supports comma, semicolon, space, or newline delimiters.
    """
    if not raw_value or not isinstance(raw_value, str):
        return []

    # Replace semicolons and newlines with commas
    normalized = raw_value.replace(";", ",").replace("\n", ",").replace("\r", ",")
    tokens = [t.strip().strip("'\"") for t in normalized.split(",")]

    keys: List[str] = []
    seen: Set[str] = set()

    for token in tokens:
        # Also split on whitespace if multiple keys were pasted with spaces
        for subtoken in token.split():
            clean = subtoken.strip().strip("'\"")
            if not clean:
                continue
            if clean.lower() in PLACEHOLDER_KEYS:
                continue
            if clean not in seen:
                seen.add(clean)
                keys.append(clean)

    return keys


class KeyRotator:
    """
    Thread-safe API Key Rotator supporting multi-key pools with automatic cascading,
    exhaustion cooldowns, and environment synchronization.
    """

    def __init__(self, cooldown_seconds: float = 120.0):
        self._lock = threading.Lock()
        self._cooldown_seconds = cooldown_seconds
        self._keys: Dict[str, List[str]] = {"groq": [], "openai": []}
        self._active_indices: Dict[str, int] = {"groq": 0, "openai": 0}
        self._exhausted_until: Dict[str, Dict[str, float]] = {"groq": {}, "openai": {}}
        self._failure_counts: Dict[str, Dict[str, int]] = {"groq": {}, "openai": {}}
        self.reload()

    def reload(self) -> None:
        """
        Reload keys from os.environ.
        Synchronizes os.environ['GROQ_API_KEY'] and os.environ['OPENAI_API_KEY']
        with the active key so external tools and libraries remain consistent.
        """
        with self._lock:
            # 1. Groq keys
            raw_groq = os.environ.get("GROQ_API_KEYS") or os.environ.get("GROQ_API_KEY") or ""
            groq_keys = parse_key_list(raw_groq)

            # 2. OpenAI keys
            raw_openai = os.environ.get("OPENAI_API_KEYS") or os.environ.get("OPENAI_API_KEY") or ""
            openai_keys = parse_key_list(raw_openai)

            self._keys["groq"] = groq_keys
            self._keys["openai"] = openai_keys

            # Reset indices if out of range
            for provider in ("groq", "openai"):
                if self._active_indices[provider] >= len(self._keys[provider]):
                    self._active_indices[provider] = 0

            # Keep os.environ pointing to a single clean active key rather than a comma-separated list
            active_groq = self._get_active_key_unlocked("groq")
            if active_groq:
                os.environ["GROQ_API_KEY"] = active_groq

            active_openai = self._get_active_key_unlocked("openai")
            if active_openai:
                os.environ["OPENAI_API_KEY"] = active_openai

            if groq_keys:
                logger.info(
                    f"[KeyRotator] Loaded {len(groq_keys)} Groq API key(s). Active: {mask_key(active_groq)}"
                )
            if openai_keys:
                logger.info(
                    f"[KeyRotator] Loaded {len(openai_keys)} OpenAI API key(s). Active: {mask_key(active_openai)}"
                )

    def _is_key_exhausted_unlocked(self, provider: str, key: str) -> bool:
        """Check whether a key is currently in cooldown."""
        exhausted_until = self._exhausted_until.get(provider, {}).get(key, 0.0)
        return time.time() < exhausted_until

    def _get_active_key_unlocked(self, provider: str) -> Optional[str]:
        """Internal helper to get active key or next non-exhausted key without re-acquiring lock."""
        keys = self._keys.get(provider, [])
        if not keys:
            return None

        total = len(keys)
        start_idx = self._active_indices[provider] % total

        # Check if the currently indexed key is available
        current_candidate = keys[start_idx]
        if not self._is_key_exhausted_unlocked(provider, current_candidate):
            return current_candidate

        # Search for any non-exhausted key in pool
        for i in range(1, total):
            idx = (start_idx + i) % total
            candidate = keys[idx]
            if not self._is_key_exhausted_unlocked(provider, candidate):
                self._active_indices[provider] = idx
                return candidate

        # If all keys are marked exhausted, check if any cooldown expired
        now = time.time()
        for idx, candidate in enumerate(keys):
            if now >= self._exhausted_until[provider].get(candidate, 0.0):
                self._active_indices[provider] = idx
                self._exhausted_until[provider].pop(candidate, None)
                return candidate

        # All cooldowns are in the future: return the one whose cooldown expires earliest
        earliest_key = min(
            keys,
            key=lambda k: self._exhausted_until[provider].get(k, 0.0),
        )
        self._active_indices[provider] = keys.index(earliest_key)
        return earliest_key

    def get_active_key(self, provider: str) -> Optional[str]:
        """
        Return the currently active key for the given provider ('groq' or 'openai').
        Automatically rotates past exhausted keys.
        """
        provider = provider.lower()
        with self._lock:
            # Check if os.environ changed externally
            raw_env = os.environ.get(f"{provider.upper()}_API_KEYS") or os.environ.get(f"{provider.upper()}_API_KEY")
            current_keys = self._keys.get(provider, [])
            if raw_env and (not current_keys or ("," in raw_env and len(current_keys) <= 1)):
                self.reload()

            key = self._get_active_key_unlocked(provider)
            if key:
                os.environ[f"{provider.upper()}_API_KEY"] = key
            return key

    def rotate_key(self, provider: str, reason: str = "") -> Optional[str]:
        """
        Mark the current key for `provider` as exhausted and cascade to the next available key.
        Returns the new active key, or None if all keys are currently exhausted.
        """
        provider = provider.lower()
        with self._lock:
            keys = self._keys.get(provider, [])
            if not keys:
                return None

            total = len(keys)
            old_idx = self._active_indices[provider] % total
            old_key = keys[old_idx]

            # Mark old key as exhausted with cooldown
            now = time.time()
            self._exhausted_until.setdefault(provider, {})[old_key] = now + self._cooldown_seconds
            self._failure_counts.setdefault(provider, {})[old_key] = (
                self._failure_counts[provider].get(old_key, 0) + 1
            )

            # Find the next key that is not exhausted
            next_key: Optional[str] = None
            next_idx = old_idx

            for i in range(1, total):
                cand_idx = (old_idx + i) % total
                cand_key = keys[cand_idx]
                if not self._is_key_exhausted_unlocked(provider, cand_key):
                    next_idx = cand_idx
                    next_key = cand_key
                    break

            if next_key and next_key != old_key:
                self._active_indices[provider] = next_idx
                os.environ[f"{provider.upper()}_API_KEY"] = next_key
                logger.warning(
                    f"[KeyRotator] Provider '{provider}': API key {mask_key(old_key)} hit rate limit ({reason}). "
                    f"Cascading to key {next_idx + 1}/{total} ({mask_key(next_key)}) without interrupting batch evaluation."
                )
                print(
                    f"[KeyRotator] Provider '{provider}': Key {mask_key(old_key)} exhausted. "
                    f"Cascaded to {mask_key(next_key)} ({next_idx + 1}/{total})."
                )
                return next_key

            logger.warning(
                f"[KeyRotator] Provider '{provider}': All {total} keys are currently exhausted ({reason})."
            )
            return None

    def mark_success(self, provider: str, key: str) -> None:
        """Record successful invocation on this key, clearing error tracking."""
        provider = provider.lower()
        with self._lock:
            if provider in self._exhausted_until and key in self._exhausted_until[provider]:
                self._exhausted_until[provider].pop(key, None)
            if provider in self._failure_counts and key in self._failure_counts[provider]:
                self._failure_counts[provider][key] = 0

    def get_all_keys(self, provider: str) -> List[str]:
        """Return all configured keys for a provider."""
        provider = provider.lower()
        with self._lock:
            raw_env = os.environ.get(f"{provider.upper()}_API_KEYS") or os.environ.get(f"{provider.upper()}_API_KEY") or ""
            if not raw_env and self._keys.get(provider, []):
                self._keys[provider] = []
                self._active_indices[provider] = 0
            return list(self._keys.get(provider, []))

    def has_available_keys(self, provider: str) -> bool:
        """Check if provider has at least one configured key."""
        return len(self.get_all_keys(provider)) > 0

    def is_groq_quota_or_rate_limit(self, exc: Exception) -> bool:
        """Detect whether an exception from Groq represents a rate limit, quota, or 429."""
        status = self._extract_http_status(exc)
        if status == 429:
            return True
        msg = str(exc).lower()
        return any(
            token in msg
            for token in (
                "daily",
                "quota",
                "token limit",
                "tokens limit",
                "tokens per minute",
                "requests per minute",
                "requests per day",
                "tpm",
                "rpm",
                "rpd",
                "limit exceeded",
                "rate limit",
                "exceeded your limit",
                "too many requests",
                "resource exhausted",
            )
        )

    def is_openai_quota_or_rate_limit(self, exc: Exception) -> bool:
        """Detect whether an exception from OpenAI represents quota or rate limit exhaustion."""
        status = self._extract_http_status(exc)
        if status == 429:
            return True
        msg = str(exc).lower()
        return any(
            token in msg
            for token in (
                "insufficient_quota",
                "quota",
                "rate_limit_exceeded",
                "rate limit",
                "exceeded your current quota",
                "billing",
                "tokens per min",
                "requests per min",
                "too many requests",
            )
        )

    def is_auth_error(self, exc: Exception) -> bool:
        """Detect invalid credentials (401/403) so we can cascade past bad/expired keys."""
        status = self._extract_http_status(exc)
        if status in {401, 403}:
            return True
        msg = str(exc).lower()
        return any(
            token in msg
            for token in (
                "invalid_api_key",
                "invalid api key",
                "incorrect api key",
                "unauthorized",
                "authentication failed",
                "authentication error",
                "forbidden",
                "401",
                "403",
            )
        )

    @staticmethod
    def _extract_http_status(exc: Exception) -> Optional[int]:
        """Extract HTTP status code from various exception types."""
        for candidate in (
            getattr(exc, "status_code", None),
            getattr(getattr(exc, "response", None), "status_code", None),
            getattr(exc, "http_status", None),
        ):
            if candidate is not None:
                try:
                    return int(candidate)
                except (TypeError, ValueError):
                    pass
        return None

    def get_diagnostics(self) -> dict:
        """Return safe masked diagnostic summary for health and debug endpoints."""
        with self._lock:
            groq_keys = self._keys["groq"]
            openai_keys = self._keys["openai"]
            groq_active = self._get_active_key_unlocked("groq")
            openai_active = self._get_active_key_unlocked("openai")

            return {
                "groq": {
                    "configured": bool(groq_keys),
                    "total_keys": len(groq_keys),
                    "active_key": mask_key(groq_active),
                    "keys_available": sum(1 for k in groq_keys if not self._is_key_exhausted_unlocked("groq", k)),
                },
                "openai": {
                    "configured": bool(openai_keys),
                    "total_keys": len(openai_keys),
                    "active_key": mask_key(openai_active),
                    "keys_available": sum(1 for k in openai_keys if not self._is_key_exhausted_unlocked("openai", k)),
                },
            }

    def reset(self) -> None:
        """Reset rotator state (primarily used in test suites)."""
        with self._lock:
            self._keys = {"groq": [], "openai": []}
            self._active_indices = {"groq": 0, "openai": 0}
            self._exhausted_until = {"groq": {}, "openai": {}}
            self._failure_counts = {"groq": {}, "openai": {}}


# Global singleton instance
key_rotator = KeyRotator()
