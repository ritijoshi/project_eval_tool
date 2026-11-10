import asyncio
import json
import os
import pytest
from unittest.mock import MagicMock, patch

from key_rotator import KeyRotator, parse_key_list, mask_key
from assignment_evaluation.pipelines import orchestrator


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    monkeypatch.delenv("GROQ_API_KEYS", raising=False)
    monkeypatch.delenv("OPENAI_API_KEYS", raising=False)



class MockQuotaError(Exception):
    status_code = 429

    def __init__(self, message="429 Rate limit / TPM quota exceeded"):
        super().__init__(message)
        self.message = message


def _valid_json_payload():
    return json.dumps({
        "overallScore": 9.0,
        "confidence": 0.9,
        "criteria": [
            {
                "name": "Accuracy",
                "score": 9.0,
                "maxScore": 10.0,
                "feedback": "Well implemented.",
                "evidence": "def solve(): return 42"
            }
        ],
        "strengths": ["Clean solution"],
        "mistakes": [],
        "missingConcepts": [],
        "weakAreas": [],
        "missingKeyPoints": [],
        "requiredConcepts": ["algorithm"],
        "conceptsCovered": ["algorithm"],
        "scoreExplanation": "9 out of 10",
        "feedback": "Great work overall."
    })


RUBRIC = {
    "criteria": [{"name": "Accuracy", "maxScore": 10.0, "description": "Correctness"}],
    "rubricText": "Accuracy - 10 points",
    "assignmentQuestion": "Implement solver",
    "modelAnswer": "def solve(): return 42",
}


def test_groq_key_rotator_rotates_on_429(monkeypatch):
    """Verify _invoke_groq rotates keys when key 1 hits 429 and succeeds on key 2."""
    monkeypatch.setenv("GROQ_API_KEY", "gsk_key_alpha, gsk_key_beta")
    orchestrator.key_rotator.reload()

    invoked_keys = []

    def mock_chat_groq(*args, **kwargs):
        used_key = kwargs.get("groq_api_key")
        invoked_keys.append(used_key)
        mock_instance = MagicMock()
        if used_key == "gsk_key_alpha":
            # Simulate 429 quota exhaustion
            mock_instance.invoke.side_effect = MockQuotaError("Rate limit: tokens per minute (TPM) limit reached")
        else:
            # Succeeds on second key
            mock_resp = MagicMock()
            mock_resp.content = _valid_json_payload()
            mock_instance.invoke.return_value = mock_resp
        return mock_instance

    monkeypatch.setattr(orchestrator, "ChatGroq", mock_chat_groq)

    # Calling _invoke_groq should automatically rotate past key_alpha to key_beta
    result = asyncio.run(orchestrator._invoke_groq(["test message"]))
    assert "overallScore" in result
    assert invoked_keys == ["gsk_key_alpha", "gsk_key_beta"]

    # On next invocation, key_alpha should still be in cooldown, so it uses key_beta directly
    invoked_keys.clear()
    result2 = asyncio.run(orchestrator._invoke_groq(["second test message"]))
    assert "overallScore" in result2
    assert invoked_keys == ["gsk_key_beta"]


def test_batch_simulation_with_cascading(monkeypatch):
    """
    Simulate batch evaluation of multiple students where API key exhaustion
    occurs midway and is handled seamlessly.
    """
    monkeypatch.setenv("GROQ_API_KEY", "gsk_first, gsk_second, gsk_third")
    monkeypatch.setenv("OLLAMA_ENABLED", "false")
    orchestrator.key_rotator.reload()

    exhaust_first = True

    def mock_chat_groq(*args, **kwargs):
        nonlocal exhaust_first
        used_key = kwargs.get("groq_api_key")
        mock_instance = MagicMock()
        if used_key == "gsk_first" and exhaust_first:
            raise MockQuotaError("429 TPM limit exceeded")
        mock_resp = MagicMock()
        mock_resp.content = _valid_json_payload()
        mock_instance.invoke.return_value = mock_resp
        return mock_instance

    monkeypatch.setattr(orchestrator, "ChatGroq", mock_chat_groq)

    # Student 1 evaluates: key 1 hits 429, cascades to key 2, succeeds
    res1 = asyncio.run(orchestrator.evaluate_single_submission_with_llm(
        student_text="def solve(): return 42",
        rubric_package=RUBRIC,
        assignment_type="code",
        student_name="Student 1",
        file_name="student1.py",
    ))
    assert res1["success"] is True
    assert res1["score"] == 9.0

    # Student 2 evaluates: uses active key 2 directly and succeeds immediately
    res2 = asyncio.run(orchestrator.evaluate_single_submission_with_llm(
        student_text="def solve(): return 42",
        rubric_package=RUBRIC,
        assignment_type="code",
        student_name="Student 2",
        file_name="student2.py",
    ))
    assert res2["success"] is True
    assert res2["score"] == 9.0


def test_cascade_to_openai_when_groq_exhausted(monkeypatch):
    """When all Groq keys are exhausted, evaluation cascades seamlessly to OpenAI."""
    monkeypatch.setenv("GROQ_API_KEY", "gsk_only_one")
    monkeypatch.setenv("OPENAI_API_KEY", "sk_openai_backup")
    monkeypatch.setenv("OLLAMA_ENABLED", "false")
    orchestrator.key_rotator.reload()

    async def mock_groq_fail(_messages):
        raise MockQuotaError("All Groq keys quota exhausted")

    async def mock_openai_success(_messages):
        return _valid_json_payload()

    monkeypatch.setattr(orchestrator, "_invoke_groq", mock_groq_fail)
    monkeypatch.setattr(orchestrator, "_invoke_openai", mock_openai_success)

    result = asyncio.run(orchestrator.evaluate_single_submission_with_llm(
        student_text="def solve(): return 42",
        rubric_package=RUBRIC,
        assignment_type="code",
        student_name="Student Cascade",
        file_name="cascade.py",
    ))
    assert result["success"] is True
    assert result["score"] == 9.0

