import json
from types import SimpleNamespace

import pytest

from project_evaluation.agents import project_evaluator


def test_evaluate_project_clamps_scores_and_derives_overall_fields(monkeypatch):
    model_result = {
        "criteria": [
            {"name": "Machine Learning", "score": 24, "feedback": "Model is trained."},
            {"name": "API", "score": 25, "feedback": "API is complete."},
        ],
        "strengths": ["Prediction endpoint is implemented"],
        "missingConcepts": ["Model persistence"],
        "feedback": "Good core implementation.",
        "nextWeekTasks": ["Add model persistence"],
        "badges": ["API Builder"],
        "aiConfidence": {"score": 1.4, "reason": "Evidence is detailed."},
    }

    class FakeChatGroq:
        def __init__(self, **kwargs):
            pass

        def invoke(self, prompt):
            return SimpleNamespace(content=json.dumps(model_result))

    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    monkeypatch.setattr(project_evaluator, "ChatGroq", FakeChatGroq)
    rubric = {
        "projectGoal": "Build a prediction application",
        "criteria": [
            {"name": "Machine Learning", "maxScore": 30, "requirements": ["Train model"]},
            {"name": "API", "maxScore": 20, "requirements": ["Prediction endpoint"]},
        ],
    }
    evidence = {
        "requirementMapping": [
            {"requirement": "Save the trained model", "status": "MISSING"},
            {"requirement": "Write API tests", "status": "PARTIAL"},
        ],
        "coverage": 62.5,
    }

    result = project_evaluator.evaluate_project("Build a prediction application", rubric, evidence)

    assert result["criterionScores"][1]["score"] == 20
    assert result["overallScore"] == 88
    assert result["grade"] == "A"
    assert result["maxScore"] == 100
    assert result["requirementCoverage"] == 62.5
    assert result["missingRequirements"] == ["Save the trained model"]
    assert result["partialRequirements"] == ["Write API tests"]
    assert result["missingConcepts"] == ["Model persistence"]
    assert result["nextWeekTasks"] == ["Add model persistence"]
    assert result["aiConfidence"]["score"] == 1


def test_evaluate_project_requires_rubric_criteria(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "test-key")

    with pytest.raises(ValueError, match="at least one criterion"):
        project_evaluator.evaluate_project("Goal", {"criteria": []}, {})


def test_parse_response_accepts_json_fence_and_rejects_invalid_json():
    parsed = project_evaluator._parse_response('```json\n{"criteria": []}\n```')
    assert parsed == {"criteria": []}

    with pytest.raises(ValueError, match="invalid JSON"):
        project_evaluator._parse_response("not json")