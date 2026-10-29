"""Tests for the shared rubric validator."""
import pytest
from eval_validation.rubric_validator import (
    validate_rubric,
    snapshot_rubric,
    assert_rubric_unchanged,
    RubricCriterion,
)


# ---------------------------------------------------------------------------
# Valid rubrics
# ---------------------------------------------------------------------------

def test_valid_single_criterion():
    result = validate_rubric([{"name": "Correctness", "maxScore": 5}])
    assert result.valid
    assert len(result.criteria) == 1
    assert result.total_max_score == 5.0


def test_valid_multiple_criteria():
    result = validate_rubric([
        {"name": "A", "maxScore": 4},
        {"name": "B", "maxScore": 3},
        {"name": "C", "maxScore": 3},
    ])
    assert result.valid
    assert result.total_max_score == 10.0


def test_description_is_optional_by_default():
    result = validate_rubric([{"name": "X", "maxScore": 5}])
    assert result.valid


def test_max_score_as_float():
    result = validate_rubric([{"name": "X", "maxScore": 2.5}])
    assert result.valid
    assert result.criteria[0].max_score == 2.5


def test_criterion_id_is_normalised():
    result = validate_rubric([{"name": "Part A — Data Prep", "maxScore": 3}])
    assert result.valid
    assert "_" in result.criteria[0].criterion_id
    assert result.criteria[0].criterion_id == result.criteria[0].criterion_id.lower()


def test_title_alias_accepted():
    """Rubrics using 'title' instead of 'name' must be accepted."""
    result = validate_rubric([{"title": "Quality", "maxScore": 5}])
    assert result.valid
    assert result.criteria[0].name == "Quality"


def test_max_score_alias_accepted():
    result = validate_rubric([{"name": "Q1", "max_score": 4}])
    assert result.valid
    assert result.criteria[0].max_score == 4.0


# ---------------------------------------------------------------------------
# Invalid rubrics
# ---------------------------------------------------------------------------

def test_empty_criteria_list_is_invalid():
    result = validate_rubric([])
    assert not result.valid
    assert any("no criteria" in e.lower() for e in result.errors)


def test_non_list_is_invalid():
    result = validate_rubric("not a list")  # type: ignore[arg-type]
    assert not result.valid


def test_missing_name_is_invalid():
    result = validate_rubric([{"maxScore": 5}])
    assert not result.valid
    assert any("empty name" in e.lower() for e in result.errors)


def test_zero_max_score_is_invalid():
    result = validate_rubric([{"name": "Q1", "maxScore": 0}])
    assert not result.valid


def test_negative_max_score_is_invalid():
    result = validate_rubric([{"name": "Q1", "maxScore": -3}])
    assert not result.valid


def test_non_numeric_max_score_is_invalid():
    result = validate_rubric([{"name": "Q1", "maxScore": "five"}])
    assert not result.valid
    assert any("finite number" in e.lower() or "maxscore" in e.lower() for e in result.errors)


def test_nan_max_score_is_invalid():
    import math
    result = validate_rubric([{"name": "Q1", "maxScore": math.nan}])
    assert not result.valid


def test_infinite_max_score_is_invalid():
    import math
    result = validate_rubric([{"name": "Q1", "maxScore": math.inf}])
    assert not result.valid


def test_duplicate_criterion_name_is_invalid():
    result = validate_rubric([
        {"name": "Correctness", "maxScore": 5},
        {"name": "Correctness", "maxScore": 3},
    ])
    assert not result.valid
    assert any("duplicate" in e.lower() for e in result.errors)


def test_duplicate_criterion_case_insensitive():
    result = validate_rubric([
        {"name": "correctness", "maxScore": 5},
        {"name": "CORRECTNESS", "maxScore": 3},
    ])
    assert not result.valid


def test_raise_if_invalid_raises():
    result = validate_rubric([])
    with pytest.raises(ValueError, match="Rubric validation failed"):
        result.raise_if_invalid()


# ---------------------------------------------------------------------------
# Snapshot and unchanged assertion
# ---------------------------------------------------------------------------

def test_snapshot_is_serialisable():
    import json
    result = validate_rubric([{"name": "A", "maxScore": 5}, {"name": "B", "maxScore": 5}])
    snapshot = snapshot_rubric(result.criteria)
    # Must not raise
    json.dumps(snapshot)
    assert snapshot["total_max_score"] == 10.0
    assert snapshot["criterion_count"] == 2


def test_assert_rubric_unchanged_passes_for_identical():
    result = validate_rubric([{"name": "A", "maxScore": 5}])
    snapshot = snapshot_rubric(result.criteria)
    discrepancies = assert_rubric_unchanged(snapshot, result.criteria)
    assert discrepancies == []


def test_assert_rubric_unchanged_detects_removed_criterion():
    criteria_a = validate_rubric([{"name": "A", "maxScore": 5}, {"name": "B", "maxScore": 3}]).criteria
    snapshot = snapshot_rubric(criteria_a)
    criteria_b = validate_rubric([{"name": "A", "maxScore": 5}]).criteria
    discrepancies = assert_rubric_unchanged(snapshot, criteria_b)
    assert any("missing" in d.lower() for d in discrepancies)


def test_assert_rubric_unchanged_detects_score_change():
    criteria_a = validate_rubric([{"name": "A", "maxScore": 5}]).criteria
    snapshot = snapshot_rubric(criteria_a)
    criteria_b = validate_rubric([{"name": "A", "maxScore": 8}]).criteria
    discrepancies = assert_rubric_unchanged(snapshot, criteria_b)
    assert any("maxscore changed" in d.lower() for d in discrepancies)


def test_assert_rubric_unchanged_detects_added_criterion():
    criteria_a = validate_rubric([{"name": "A", "maxScore": 5}]).criteria
    snapshot = snapshot_rubric(criteria_a)
    criteria_b = validate_rubric([{"name": "A", "maxScore": 5}, {"name": "B", "maxScore": 3}]).criteria
    discrepancies = assert_rubric_unchanged(snapshot, criteria_b)
    assert any("new criterion" in d.lower() for d in discrepancies)
