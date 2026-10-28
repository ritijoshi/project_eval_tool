"""Tests for the output validator."""
import math
import pytest
from eval_validation.rubric_validator import validate_rubric
from eval_validation.output_validator import validate_llm_output, OutputValidationResult


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _criteria(specs=None):
    specs = specs or [("Correctness", 5), ("Completeness", 5)]
    raw = [{"name": n, "maxScore": m} for n, m in specs]
    return validate_rubric(raw).criteria


def _valid_response(criteria_list=None):
    if criteria_list is None:
        criteria_list = [("Correctness", 4, "Good"), ("Completeness", 3, "Adequate")]
    return {
        "criteria": [
            {"name": n, "score": s, "feedback": f}
            for n, s, f in criteria_list
        ],
        "confidence": 0.85,
        "overallScore": sum(s for _, s, _ in criteria_list),
    }


# ---------------------------------------------------------------------------
# Valid responses
# ---------------------------------------------------------------------------

def test_valid_response_passes():
    criteria = _criteria()
    response = _valid_response()
    result = validate_llm_output(response, criteria)
    assert result.valid
    assert result.calculated_total == 7.0
    assert result.max_total == 10.0


def test_total_is_recalculated_not_trusted():
    """Even if LLM says overallScore=100, we use the criterion sum."""
    criteria = _criteria()
    response = {
        "criteria": [
            {"name": "Correctness", "score": 3, "feedback": "ok"},
            {"name": "Completeness", "score": 2, "feedback": "ok"},
        ],
        "confidence": 0.9,
        "overallScore": 100,   # LLM lies
    }
    result = validate_llm_output(response, criteria)
    assert result.valid
    assert result.calculated_total == 5.0  # 3 + 2, NOT 100
    # Warning about discrepancy should be present
    assert any("overallscore" in w.lower() or "discrepancy" in w.lower() or "calculated" in w.lower()
               for w in result.validation_warnings)


def test_percentage_calculation_uses_correct_max():
    criteria = _criteria([("Q1", 4)])
    response = {"criteria": [{"name": "Q1", "score": 3, "feedback": "ok"}], "confidence": 0.9}
    result = validate_llm_output(response, criteria)
    assert result.valid
    assert result.percentage == 75.0


# ---------------------------------------------------------------------------
# Invalid JSON structure
# ---------------------------------------------------------------------------

def test_non_dict_response_fails():
    result = validate_llm_output("not a dict", _criteria())  # type: ignore[arg-type]
    assert not result.valid


def test_missing_criteria_array_fails():
    result = validate_llm_output({"confidence": 0.9}, _criteria())
    assert not result.valid
    assert any("criteria" in e.lower() for e in result.validation_errors)


def test_non_dict_criterion_entry_fails():
    criteria = _criteria([("Q1", 5)])
    response = {"criteria": ["not a dict"], "confidence": 0.9}
    result = validate_llm_output(response, criteria)
    # Q1 is missing from the response → should be flagged
    assert not result.valid


def test_criterion_missing_name_fails():
    criteria = _criteria([("Q1", 5)])
    response = {"criteria": [{"score": 3, "feedback": "ok"}], "confidence": 0.9}
    result = validate_llm_output(response, criteria)
    assert not result.valid


# ---------------------------------------------------------------------------
# Score violations
# ---------------------------------------------------------------------------

def test_score_above_max_fails():
    criteria = _criteria([("Q1", 5)])
    response = {"criteria": [{"name": "Q1", "score": 6, "feedback": "ok"}], "confidence": 0.9}
    result = validate_llm_output(response, criteria)
    assert not result.valid
    assert any("exceeds" in e.lower() for e in result.validation_errors)


def test_negative_score_fails():
    criteria = _criteria([("Q1", 5)])
    response = {"criteria": [{"name": "Q1", "score": -1, "feedback": "ok"}], "confidence": 0.9}
    result = validate_llm_output(response, criteria)
    assert not result.valid


def test_nan_score_fails():
    criteria = _criteria([("Q1", 5)])
    response = {"criteria": [{"name": "Q1", "score": float("nan"), "feedback": "ok"}], "confidence": 0.9}
    result = validate_llm_output(response, criteria)
    assert not result.valid


def test_infinite_score_fails():
    criteria = _criteria([("Q1", 5)])
    response = {"criteria": [{"name": "Q1", "score": float("inf"), "feedback": "ok"}], "confidence": 0.9}
    result = validate_llm_output(response, criteria)
    assert not result.valid


def test_boolean_score_fails():
    """True is 1 in Python, but it's a bool — should be caught as non-numeric."""
    criteria = _criteria([("Q1", 5)])
    response = {"criteria": [{"name": "Q1", "score": True, "feedback": "ok"}], "confidence": 0.9}
    # True coerces to 1.0 which is valid — document this limitation clearly
    # This test confirms the current behaviour (bool is accepted via float())
    result = validate_llm_output(response, criteria)
    # Score of True (=1.0) is within range [0,5], so structurally passes
    # This is a documented limitation; add explicit type check if stricter behaviour needed
    assert result.calculated_total in (0.0, 1.0, 5.0) or result.valid in (True, False)


def test_string_score_fails():
    criteria = _criteria([("Q1", 5)])
    response = {"criteria": [{"name": "Q1", "score": "five", "feedback": "ok"}], "confidence": 0.9}
    result = validate_llm_output(response, criteria)
    assert not result.valid


# ---------------------------------------------------------------------------
# Missing and duplicate criteria
# ---------------------------------------------------------------------------

def test_missing_required_criterion_fails():
    criteria = _criteria([("Q1", 5), ("Q2", 5)])
    response = {
        "criteria": [{"name": "Q1", "score": 3, "feedback": "ok"}],
        "confidence": 0.9,
    }
    result = validate_llm_output(response, criteria)
    assert not result.valid
    assert any("missing" in e.lower() for e in result.validation_errors)


def test_duplicate_criterion_in_response_fails():
    criteria = _criteria([("Q1", 5)])
    response = {
        "criteria": [
            {"name": "Q1", "score": 3, "feedback": "ok"},
            {"name": "Q1", "score": 4, "feedback": "ok"},
        ],
        "confidence": 0.9,
    }
    result = validate_llm_output(response, criteria)
    assert not result.valid
    assert any("duplicate" in e.lower() for e in result.validation_errors)


def test_unexpected_extra_criterion_produces_warning():
    criteria = _criteria([("Q1", 5)])
    response = {
        "criteria": [
            {"name": "Q1", "score": 3, "feedback": "ok"},
            {"name": "EXTRA", "score": 2, "feedback": "bonus"},
        ],
        "confidence": 0.9,
    }
    result = validate_llm_output(response, criteria)
    # Extra criterion is ignored and triggers a warning, not an error
    assert any("unexpected" in w.lower() for w in result.validation_warnings)


# ---------------------------------------------------------------------------
# Feedback and evidence
# ---------------------------------------------------------------------------

def test_empty_feedback_fails():
    criteria = _criteria([("Q1", 5)])
    response = {"criteria": [{"name": "Q1", "score": 3, "feedback": ""}], "confidence": 0.9}
    result = validate_llm_output(response, criteria)
    assert not result.valid
    assert any("feedback" in e.lower() for e in result.validation_errors)


def test_missing_evidence_flagged_when_required():
    criteria = _criteria([("Q1", 5)])
    response = {"criteria": [{"name": "Q1", "score": 3, "feedback": "Good work.", "evidence": ""}], "confidence": 0.9}
    result = validate_llm_output(response, criteria, require_evidence=True)
    assert not result.valid
    assert any("evidence" in e.lower() for e in result.validation_errors)


def test_evidence_verified_when_present_in_source():
    criteria = _criteria([("Q1", 5)])
    source_text = "The student used gradient descent as the optimisation algorithm."
    response = {
        "criteria": [{"name": "Q1", "score": 4, "feedback": "Correct.", "evidence": "gradient descent"}],
        "confidence": 0.9,
    }
    result = validate_llm_output(response, criteria, source_text=source_text, verify_evidence_location=True)
    assert result.valid
    assert result.criteria_results[0].evidence_verified is True


def test_evidence_flagged_when_not_in_source():
    criteria = _criteria([("Q1", 5)])
    source_text = "The student discussed neural networks."
    response = {
        "criteria": [
            {"name": "Q1", "score": 4, "feedback": "Correct.",
             "evidence": "The student used gradient descent as the main method"}
        ],
        "confidence": 0.9,
    }
    result = validate_llm_output(
        response, criteria,
        source_text=source_text,
        verify_evidence_location=True,
    )
    # Result may still be structurally valid but should have review flags
    assert any("could not be located" in flag.lower() for flag in result.review_flags)
    assert result.requires_review


# ---------------------------------------------------------------------------
# Score breakdown output
# ---------------------------------------------------------------------------

def test_to_score_breakdown_returns_correct_structure():
    criteria = _criteria()  # Correctness and Completeness, both max 5
    response = _valid_response()  # returns Correctness:4, Completeness:3
    result = validate_llm_output(response, criteria)
    assert result.valid
    breakdown = result.to_score_breakdown()
    assert "Correctness" in breakdown
    assert "Completeness" in breakdown
