import asyncio
import json
import os
import pytest
from unittest.mock import MagicMock

from assignment_evaluation.pipelines import orchestrator
from key_rotator import key_rotator


class MockRateLimitError(Exception):
    status_code = 429

    def __init__(self, message="429 Rate limit / TPM quota exceeded"):
        super().__init__(message)
        self.message = message


class MockInvalidRequestError(Exception):
    status_code = 400

    def __init__(self, message="400 Bad Request: prompt contains invalid syntax"):
        super().__init__(message)
        self.message = message


def _valid_json_payload():
    return json.dumps({
        "overallScore": 10.0,
        "confidence": 0.95,
        "criteria": [
            {
                "name": "Accuracy",
                "score": 10.0,
                "maxScore": 10.0,
                "feedback": "Flawless solution.",
                "evidence": "def solve(): return 42"
            }
        ]
    })


@pytest.fixture(autouse=True)
def _isolate_env(monkeypatch):
    """Isolate environment before each test."""
    monkeypatch.delenv("GROQ_API_KEYS", raising=False)
    monkeypatch.delenv("OPENAI_API_KEYS", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)


def test_scenario_1_first_key_succeeds_no_further_keys_or_models(monkeypatch):
    """Scenario 1: First API key succeeds: no additional keys or models should be attempted."""
    monkeypatch.setenv("GROQ_API_KEY", "gsk_key1, gsk_key2, gsk_key3")
    key_rotator.reload()

    attempts = []

    def mock_chat_groq(*args, **kwargs):
        model = kwargs.get("model_name")
        key = kwargs.get("groq_api_key")
        attempts.append((model, key))
        mock_instance = MagicMock()
        mock_resp = MagicMock()
        mock_resp.content = _valid_json_payload()
        mock_instance.invoke.return_value = mock_resp
        return mock_instance

    monkeypatch.setattr(orchestrator, "ChatGroq", mock_chat_groq)

    result = asyncio.run(orchestrator._invoke_groq(["test"]))
    assert "overallScore" in result
    # Only 1 attempt made: first key on first model
    assert len(attempts) == 1
    assert attempts[0] == (orchestrator._groq_model(), "gsk_key1")


def test_scenario_2_first_key_rate_limited_second_succeeds_same_model_retained(monkeypatch):
    """Scenario 2: First key is rate-limited, second key succeeds: same model must be retained."""
    monkeypatch.setenv("GROQ_API_KEY", "gsk_key1, gsk_key2, gsk_key3")
    key_rotator.reload()

    attempts = []
    primary_model = orchestrator._groq_model()

    def mock_chat_groq(*args, **kwargs):
        model = kwargs.get("model_name")
        key = kwargs.get("groq_api_key")
        attempts.append((model, key))
        mock_instance = MagicMock()
        if key == "gsk_key1":
            mock_instance.invoke.side_effect = MockRateLimitError("TPM limit exceeded")
        else:
            mock_resp = MagicMock()
            mock_resp.content = _valid_json_payload()
            mock_instance.invoke.return_value = mock_resp
        return mock_instance

    monkeypatch.setattr(orchestrator, "ChatGroq", mock_chat_groq)

    result = asyncio.run(orchestrator._invoke_groq(["test"]))
    assert "overallScore" in result
    # Both attempts must be on the primary model, cascading only the API key
    assert attempts == [
        (primary_model, "gsk_key1"),
        (primary_model, "gsk_key2"),
    ]


def test_scenario_3_all_keys_of_primary_model_rate_limited_cascades_to_next_model(monkeypatch):
    """Scenario 3: All keys of primary model rate-limited: only then should the next model be selected."""
    monkeypatch.setenv("GROQ_API_KEY", "gsk_key1, gsk_key2")
    key_rotator.reload()

    attempts = []
    candidate_models = [orchestrator._groq_model()]
    for m in orchestrator.GROQ_FALLBACK_MODELS:
        if m not in candidate_models:
            candidate_models.append(m)

    primary_model = candidate_models[0]
    secondary_model = candidate_models[1]

    def mock_chat_groq(*args, **kwargs):
        model = kwargs.get("model_name")
        key = kwargs.get("groq_api_key")
        attempts.append((model, key))
        mock_instance = MagicMock()
        # Fail all keys on primary model
        if model == primary_model:
            mock_instance.invoke.side_effect = MockRateLimitError("Model A quota exhausted")
        else:
            # Succeed on secondary model with key 1
            mock_resp = MagicMock()
            mock_resp.content = _valid_json_payload()
            mock_instance.invoke.return_value = mock_resp
        return mock_instance

    monkeypatch.setattr(orchestrator, "ChatGroq", mock_chat_groq)

    result = asyncio.run(orchestrator._invoke_groq(["test"]))
    assert "overallScore" in result

    # Must attempt all keys on Model 1, THEN cascade to Model 2 starting from Key 1
    assert attempts == [
        (primary_model, "gsk_key1"),
        (primary_model, "gsk_key2"),
        (secondary_model, "gsk_key1"),
    ]


def test_scenario_4_secondary_model_succeeds_using_subsequent_api_key(monkeypatch):
    """Scenario 4: Secondary model succeeds using its second or subsequent API key."""
    monkeypatch.setenv("GROQ_API_KEY", "gsk_key1, gsk_key2")
    key_rotator.reload()

    attempts = []
    candidate_models = [orchestrator._groq_model()]
    for m in orchestrator.GROQ_FALLBACK_MODELS:
        if m not in candidate_models:
            candidate_models.append(m)

    primary_model = candidate_models[0]
    secondary_model = candidate_models[1]

    def mock_chat_groq(*args, **kwargs):
        model = kwargs.get("model_name")
        key = kwargs.get("groq_api_key")
        attempts.append((model, key))
        mock_instance = MagicMock()
        # Primary model: all keys rate limited
        if model == primary_model:
            mock_instance.invoke.side_effect = MockRateLimitError("Primary model quota exceeded")
        # Secondary model: key 1 rate limited, key 2 succeeds
        elif model == secondary_model and key == "gsk_key1":
            mock_instance.invoke.side_effect = MockRateLimitError("Secondary model key 1 rate limited")
        else:
            mock_resp = MagicMock()
            mock_resp.content = _valid_json_payload()
            mock_instance.invoke.return_value = mock_resp
        return mock_instance

    monkeypatch.setattr(orchestrator, "ChatGroq", mock_chat_groq)

    result = asyncio.run(orchestrator._invoke_groq(["test"]))
    assert "overallScore" in result

    # Sequence must be:
    # Model 1 Key 1 -> Model 1 Key 2 -> Model 2 Key 1 -> Model 2 Key 2 (succeeds)
    assert attempts == [
        (primary_model, "gsk_key1"),
        (primary_model, "gsk_key2"),
        (secondary_model, "gsk_key1"),
        (secondary_model, "gsk_key2"),
    ]


def test_scenario_5_all_models_and_keys_rate_limited_returns_structured_failure(monkeypatch):
    """Scenario 5: All model/API-key combinations are rate-limited: return a structured failure."""
    monkeypatch.setenv("GROQ_API_KEY", "gsk_key1, gsk_key2")
    key_rotator.reload()

    attempts = []

    def mock_chat_groq(*args, **kwargs):
        model = kwargs.get("model_name")
        key = kwargs.get("groq_api_key")
        attempts.append((model, key))
        mock_instance = MagicMock()
        mock_instance.invoke.side_effect = MockRateLimitError("Global daily limit reached")
        return mock_instance

    monkeypatch.setattr(orchestrator, "ChatGroq", mock_chat_groq)

    with pytest.raises(RuntimeError) as exc_info:
        asyncio.run(orchestrator._invoke_groq(["test"]))

    # Must contain informative structured exhaustion error message
    assert "exhausted due to rate limits" in str(exc_info.value)

    # Every model must have been attempted with every key
    candidate_models = [orchestrator._groq_model()]
    for m in orchestrator.GROQ_FALLBACK_MODELS:
        if m not in candidate_models:
            candidate_models.append(m)

    expected_attempts_count = len(candidate_models) * 2
    assert len(attempts) == expected_attempts_count


def test_scenario_6_non_rate_limit_error_fails_fast_without_cascading(monkeypatch):
    """Scenario 6: A non-rate-limit error occurs: preserve appropriate existing error-handling behaviour."""
    monkeypatch.setenv("GROQ_API_KEY", "gsk_key1, gsk_key2, gsk_key3")
    key_rotator.reload()

    attempts = []

    def mock_chat_groq(*args, **kwargs):
        model = kwargs.get("model_name")
        key = kwargs.get("groq_api_key")
        attempts.append((model, key))
        mock_instance = MagicMock()
        mock_instance.invoke.side_effect = MockInvalidRequestError("Invalid prompt parameter")
        return mock_instance

    monkeypatch.setattr(orchestrator, "ChatGroq", mock_chat_groq)

    with pytest.raises(MockInvalidRequestError):
        asyncio.run(orchestrator._invoke_groq(["test"]))

    # Must stop immediately on the first attempt without cycling other keys or models
    assert len(attempts) == 1
    assert attempts[0] == (orchestrator._groq_model(), "gsk_key1")

