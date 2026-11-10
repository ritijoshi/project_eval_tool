import os
import pytest
from key_rotator import KeyRotator, mask_key, parse_key_list


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    monkeypatch.delenv("GROQ_API_KEYS", raising=False)
    monkeypatch.delenv("OPENAI_API_KEYS", raising=False)



def test_parse_key_list_delimiters_and_placeholders():
    raw = "gsk_key1, gsk_key2; gsk_key3\ngsk_key4 gsk-placeholder   replace_with_groq_api_key  "
    keys = parse_key_list(raw)
    assert keys == ["gsk_key1", "gsk_key2", "gsk_key3", "gsk_key4"]


def test_mask_key():
    assert mask_key("gsk_1234567890abcdef") == "gsk_12...cdef"
    assert mask_key("") == "<none>"
    assert mask_key(None) == "<none>"
    assert mask_key("short") == "***"


def test_rotator_cascades_through_keys(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "gsk_first, gsk_second, gsk_third")
    monkeypatch.setenv("OPENAI_API_KEY", "sk_first, sk_second")

    rotator = KeyRotator(cooldown_seconds=60.0)

    # Initially first key is active
    assert rotator.get_active_key("groq") == "gsk_first"
    assert os.environ["GROQ_API_KEY"] == "gsk_first"

    # Simulate quota exhaustion on first key
    next_key = rotator.rotate_key("groq", reason="429 Rate Limit Exceeded")
    assert next_key == "gsk_second"
    assert rotator.get_active_key("groq") == "gsk_second"
    assert os.environ["GROQ_API_KEY"] == "gsk_second"

    # Simulate quota exhaustion on second key
    next_key = rotator.rotate_key("groq", reason="Daily Quota Exceeded")
    assert next_key == "gsk_third"
    assert rotator.get_active_key("groq") == "gsk_third"

    # When third key also exhausts, all keys are exhausted
    next_key = rotator.rotate_key("groq", reason="TPM limit")
    assert next_key is None


def test_rotator_diagnostics_never_leaks_raw_keys(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "gsk_secret12345, gsk_secret67890")
    monkeypatch.setenv("OPENAI_API_KEY", "sk_topsecret12345")

    rotator = KeyRotator()
    diag = rotator.get_diagnostics()

    assert diag["groq"]["total_keys"] == 2
    assert diag["openai"]["total_keys"] == 1
    rendered = str(diag)
    assert "gsk_secret12345" not in rendered
    assert "sk_topsecret12345" not in rendered
    assert "gsk_se" in rendered


def test_error_detection():
    rotator = KeyRotator()

    class Mock429(Exception):
        status_code = 429
        def __str__(self):
            return "Rate limit reached for requests per minute"

    class MockDailyQuota(Exception):
        status_code = 400
        def __str__(self):
            return "429: You have exceeded your daily quota limit"

    assert rotator.is_groq_quota_or_rate_limit(Mock429()) is True
    assert rotator.is_groq_quota_or_rate_limit(MockDailyQuota()) is True
    assert rotator.is_openai_quota_or_rate_limit(Exception("insufficient_quota: check your plan")) is True
    assert rotator.is_auth_error(Exception("401: Invalid API Key provided")) is True

