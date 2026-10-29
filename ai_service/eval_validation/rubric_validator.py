"""
Shared rubric validator used by all four evaluation workflows.

Validates rubric structure, criterion integrity, score bounds, and consistency.
This module is deliberately free of LLM or database dependencies so it can
be used in unit tests without mocking.
"""

import math
import re
from dataclasses import dataclass, field
from typing import Any

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# Maximum total score permitted across any rubric.  Professors can raise
# this by setting the RUBRIC_MAX_TOTAL_SCORE environment variable.
import os
_DEFAULT_RUBRIC_MAX_TOTAL = float(os.environ.get("RUBRIC_MAX_TOTAL_SCORE", "1000"))
_MIN_CRITERION_DESCRIPTION_LEN = int(os.environ.get("RUBRIC_MIN_DESCRIPTION_LEN", "0"))


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class RubricCriterion:
    """Normalised criterion ready for evaluation."""
    criterion_id: str          # Stable lowercase key derived from name
    name: str                  # Original display name
    description: str
    max_score: float

    def as_dict(self) -> dict:
        return {
            "criterion_id": self.criterion_id,
            "name": self.name,
            "description": self.description,
            "maxScore": self.max_score,
        }


@dataclass
class RubricValidationResult:
    valid: bool
    criteria: list[RubricCriterion] = field(default_factory=list)
    total_max_score: float = 0.0
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def raise_if_invalid(self) -> None:
        if not self.valid:
            raise ValueError(
                "Rubric validation failed: " + "; ".join(self.errors)
            )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_criterion_id(name: str) -> str:
    """Return a normalised, stable identifier from a criterion name."""
    cleaned = re.sub(r"[^a-z0-9]+", "_", name.strip().lower()).strip("_")
    return cleaned or "criterion"


def _check_numeric(value: Any, field_name: str) -> float:
    """Return float or raise descriptive ValueError."""
    try:
        numeric = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field_name} must be a finite number, got: {value!r}") from exc
    if not math.isfinite(numeric):
        raise ValueError(f"{field_name} must be finite, got: {numeric}")
    return numeric


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def validate_rubric(
    raw_criteria: list[dict],
    *,
    require_descriptions: bool = False,
    max_total: float | None = None,
) -> RubricValidationResult:
    """
    Validate a list of rubric criteria dicts (from parse_rubric or the API).

    Each dict must have at minimum: name (str), maxScore (number).
    description is optional unless require_descriptions=True.

    Returns a RubricValidationResult. Never raises; call .raise_if_invalid()
    at the call site if you want an exception.
    """
    effective_max_total = max_total if max_total is not None else _DEFAULT_RUBRIC_MAX_TOTAL
    errors: list[str] = []
    warnings: list[str] = []
    criteria: list[RubricCriterion] = []
    seen_ids: dict[str, int] = {}  # criterion_id -> index for duplicate detection

    if not raw_criteria:
        return RubricValidationResult(
            valid=False,
            errors=["Rubric contains no criteria."],
        )

    if not isinstance(raw_criteria, list):
        return RubricValidationResult(
            valid=False,
            errors=["Rubric criteria must be a list."],
        )

    for index, item in enumerate(raw_criteria):
        position = f"criterion[{index}]"

        if not isinstance(item, dict):
            errors.append(f"{position} must be a dict, got {type(item).__name__}")
            continue

        name = str(item.get("name") or item.get("title") or "").strip()
        if not name:
            errors.append(f"{position} has an empty name/title.")
            continue

        # Score
        raw_score = item.get("maxScore") if item.get("maxScore") is not None else item.get("max_score")
        try:
            max_score = _check_numeric(raw_score, f"{position}.maxScore")
        except ValueError as exc:
            errors.append(str(exc))
            continue

        if max_score <= 0:
            errors.append(
                f"Criterion '{name}': maxScore must be positive, got {max_score}."
            )
            continue

        description = str(item.get("description") or "").strip()
        if require_descriptions and len(description) < max(1, _MIN_CRITERION_DESCRIPTION_LEN):
            warnings.append(f"Criterion '{name}' has no meaningful description.")

        criterion_id = _make_criterion_id(name)
        if criterion_id in seen_ids:
            errors.append(
                f"Duplicate criterion: '{name}' (id='{criterion_id}') "
                f"appears at positions {seen_ids[criterion_id]} and {index}."
            )
        seen_ids[criterion_id] = index
        criteria.append(RubricCriterion(
            criterion_id=criterion_id,
            name=name,
            description=description,
            max_score=max_score,
        ))

    total = sum(c.max_score for c in criteria)
    if total > effective_max_total:
        errors.append(
            f"Rubric total ({total}) exceeds the configured maximum ({effective_max_total})."
        )

    valid = not errors
    return RubricValidationResult(
        valid=valid,
        criteria=criteria,
        total_max_score=total,
        errors=errors,
        warnings=warnings,
    )


def snapshot_rubric(criteria: list[RubricCriterion]) -> dict:
    """
    Return a serialisable snapshot of validated criteria for audit storage.
    Store this alongside each evaluation result so historical grades can
    be traced to the rubric version that was actually used.
    """
    return {
        "criteria": [c.as_dict() for c in criteria],
        "total_max_score": sum(c.max_score for c in criteria),
        "criterion_count": len(criteria),
    }


def assert_rubric_unchanged(
    snapshot: dict,
    current_criteria: list[RubricCriterion],
) -> list[str]:
    """
    Compare a stored rubric snapshot against current criteria.
    Returns a list of discrepancy messages (empty = unchanged).
    """
    discrepancies: list[str] = []
    snap_criteria = {c["criterion_id"]: c for c in snapshot.get("criteria", [])}
    curr_criteria = {c.criterion_id: c for c in current_criteria}

    for cid, snap in snap_criteria.items():
        if cid not in curr_criteria:
            discrepancies.append(f"Criterion '{snap['name']}' was present in snapshot but is now missing.")
            continue
        curr = curr_criteria[cid]
        if curr.max_score != snap["maxScore"]:
            discrepancies.append(
                f"Criterion '{snap['name']}' maxScore changed from {snap['maxScore']} to {curr.max_score}."
            )

    for cid in curr_criteria:
        if cid not in snap_criteria:
            discrepancies.append(f"New criterion '{curr_criteria[cid].name}' not present in snapshot.")

    return discrepancies
