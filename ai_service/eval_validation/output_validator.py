"""
LLM output validator for all four evaluation workflows.

Validates every response from the Groq LLM before it is accepted as a
result. Performs deterministic score recalculation and rejects responses
that violate the trusted rubric regardless of what the model returns.

Key principles:
  - The rubric is the authority; LLM-stated max scores are ignored.
  - Totals are recalculated in code, never trusted from the model.
  - Scores must be finite numbers within [0, max_score].
  - All required criteria must be present; no extras silently accepted.
  - Evidence fields are validated for non-emptiness; location verified
    when the extracted text is provided.
"""

import math
import re
from dataclasses import dataclass, field
from typing import Any, Optional

from eval_validation.rubric_validator import RubricCriterion


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

import os
_EVIDENCE_MIN_LENGTH = int(os.environ.get("EVAL_EVIDENCE_MIN_LENGTH", "10"))
_FEEDBACK_MIN_LENGTH = int(os.environ.get("EVAL_FEEDBACK_MIN_LENGTH", "2"))
_ROUNDING_DECIMALS = int(os.environ.get("EVAL_SCORE_ROUNDING_DECIMALS", "2"))


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class CriterionResult:
    criterion_id: str
    name: str
    score: float
    max_score: float            # Always from trusted rubric, not from LLM
    feedback: str
    evidence: str = ""
    reasoning: str = ""
    missing_concepts: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    evidence_verified: Optional[bool] = None   # None = not checked


@dataclass
class OutputValidationResult:
    valid: bool
    criteria_results: list[CriterionResult] = field(default_factory=list)
    calculated_total: float = 0.0
    max_total: float = 0.0
    percentage: float = 0.0
    validation_errors: list[str] = field(default_factory=list)
    validation_warnings: list[str] = field(default_factory=list)
    review_flags: list[str] = field(default_factory=list)
    requires_review: bool = False

    def raise_if_invalid(self) -> None:
        if not self.valid:
            raise ValueError(
                "LLM output validation failed: " + "; ".join(self.validation_errors)
            )

    def to_score_breakdown(self) -> dict:
        """Return the score breakdown in the application's existing format."""
        return {
            cr.name: {
                "score": round(cr.score, _ROUNDING_DECIMALS),
                "maxScore": round(cr.max_score, _ROUNDING_DECIMALS),
                "reason": cr.feedback,
                "evidence": cr.evidence,
                "evidenceVerified": cr.evidence_verified,
            }
            for cr in self.criteria_results
        }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _safe_float(value: Any) -> Optional[float]:
    try:
        f = float(value)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def _normalise_name(name: str) -> str:
    return name.strip().casefold()


def _check_evidence_in_text(evidence: str, source_text: str) -> bool:
    """
    Return True if a normalised form of `evidence` appears in `source_text`.
    Uses simple whitespace-normalisation rather than exact string matching.
    """
    if not evidence or not source_text:
        return False
    norm_evidence = re.sub(r"\s+", " ", evidence.strip().lower())
    norm_source = re.sub(r"\s+", " ", source_text.lower())
    return norm_evidence[:80] in norm_source


# ---------------------------------------------------------------------------
# Main validator
# ---------------------------------------------------------------------------

def validate_llm_output(
    raw_response: dict,
    trusted_criteria: list[RubricCriterion],
    *,
    source_text: Optional[str] = None,
    require_evidence: bool = False,
    verify_evidence_location: bool = False,
) -> OutputValidationResult:
    """
    Validate a parsed LLM response dict against the trusted rubric.

    Parameters
    ----------
    raw_response       : Parsed JSON from the LLM (after _parse_json_object).
    trusted_criteria   : Criteria from the validated rubric — the authority.
    source_text        : Original extracted submission text for evidence checks.
    require_evidence   : If True, each criterion must have non-empty evidence.
    verify_evidence_location : If True, attempt to find each evidence string
                         in source_text; flag if not found.
    """
    errors: list[str] = []
    warnings: list[str] = []
    review_flags: list[str] = []
    criteria_results: list[CriterionResult] = []

    if not isinstance(raw_response, dict):
        return OutputValidationResult(
            valid=False,
            validation_errors=["LLM response must be a JSON object."],
        )

    # ── Build lookup from LLM response ─────────────────────────────────────
    raw_criteria = raw_response.get("criteria")
    if not isinstance(raw_criteria, list):
        return OutputValidationResult(
            valid=False,
            validation_errors=["LLM response is missing the 'criteria' array."],
        )

    llm_by_name: dict[str, dict] = {}
    seen_names: set[str] = set()
    for item in raw_criteria:
        if not isinstance(item, dict):
            errors.append("Each criterion entry must be a dict.")
            continue
        name_key = _normalise_name(str(item.get("name") or item.get("title") or ""))
        if not name_key:
            errors.append("A criterion entry is missing a name.")
            continue
        if name_key in seen_names:
            errors.append(f"Duplicate criterion in LLM response: '{name_key}'.")
        seen_names.add(name_key)
        llm_by_name[name_key] = item

    # ── Check for unexpected extra criteria ────────────────────────────────
    trusted_keys = {_normalise_name(c.name) for c in trusted_criteria}
    extra = seen_names - trusted_keys
    if extra:
        warnings.append(f"LLM returned unexpected criteria: {sorted(extra)}. They will be ignored.")

    # ── Validate each trusted criterion ────────────────────────────────────
    total_score = 0.0
    max_total = sum(c.max_score for c in trusted_criteria)

    for criterion in trusted_criteria:
        key = _normalise_name(criterion.name)
        llm_item = llm_by_name.get(key)

        if llm_item is None:
            errors.append(f"Criterion '{criterion.name}' is missing from LLM response.")
            # Add a zero-score placeholder so downstream code can still run
            criteria_results.append(CriterionResult(
                criterion_id=criterion.criterion_id,
                name=criterion.name,
                score=0.0,
                max_score=criterion.max_score,
                feedback="[Missing from LLM response]",
            ))
            continue

        # Score
        raw_score = _safe_float(llm_item.get("score"))
        if raw_score is None:
            errors.append(f"Criterion '{criterion.name}': score is not a finite number.")
            raw_score = 0.0

        # Enforce rubric max — never trust the LLM's own maxScore
        if raw_score < 0:
            errors.append(
                f"Criterion '{criterion.name}': score {raw_score} is negative."
            )
            raw_score = 0.0
        elif raw_score > criterion.max_score:
            errors.append(
                f"Criterion '{criterion.name}': score {raw_score} exceeds "
                f"rubric maximum {criterion.max_score}."
            )
            raw_score = criterion.max_score  # clamp for downstream but keep error

        score = round(raw_score, _ROUNDING_DECIMALS)
        total_score += score

        # Feedback
        feedback = str(llm_item.get("feedback") or llm_item.get("reason") or "").strip()
        if len(feedback) < _FEEDBACK_MIN_LENGTH:
            errors.append(f"Criterion '{criterion.name}': feedback is missing or too short.")

        # Evidence
        evidence = str(llm_item.get("evidence") or "").strip()
        if require_evidence and len(evidence) < _EVIDENCE_MIN_LENGTH:
            errors.append(f"Criterion '{criterion.name}': evidence is required but missing or too short.")
            review_flags.append(f"Missing evidence for criterion '{criterion.name}'.")

        # Evidence location verification
        evidence_verified: Optional[bool] = None
        if evidence and verify_evidence_location and source_text:
            evidence_verified = _check_evidence_in_text(evidence, source_text)
            if not evidence_verified:
                review_flags.append(
                    f"Evidence for '{criterion.name}' could not be located in the submission: "
                    f"{repr(evidence[:60])}"
                )

        reasoning = str(llm_item.get("reasoning") or "").strip()
        missing_concepts = [
            str(c).strip()
            for c in (llm_item.get("missing_concepts") or [])
            if str(c).strip()
        ]
        err_items = [
            str(c).strip()
            for c in (llm_item.get("errors") or [])
            if str(c).strip()
        ]

        criteria_results.append(CriterionResult(
            criterion_id=criterion.criterion_id,
            name=criterion.name,
            score=score,
            max_score=criterion.max_score,
            feedback=feedback,
            evidence=evidence,
            reasoning=reasoning,
            missing_concepts=missing_concepts,
            errors=err_items,
            evidence_verified=evidence_verified,
        ))

    # ── Deterministic total calculation ────────────────────────────────────
    calculated_total = round(total_score, _ROUNDING_DECIMALS)
    percentage = round((calculated_total / max_total * 100) if max_total > 0 else 0.0, _ROUNDING_DECIMALS)

    # Sanity-check against LLM-stated total (informational only)
    llm_total = _safe_float(raw_response.get("overallScore") or raw_response.get("totalScore"))
    if llm_total is not None:
        discrepancy = abs(llm_total - calculated_total)
        if discrepancy > 0.5:
            warnings.append(
                f"LLM stated overallScore={llm_total} but criterion sum={calculated_total}. "
                "Using calculated sum."
            )

    # ── Review flags from broader response ─────────────────────────────────
    confidence = _safe_float(raw_response.get("confidence"))
    if confidence is not None and confidence < 0.5:
        review_flags.append(f"Low model confidence ({confidence:.2f}); recommend human review.")

    requires_review = bool(review_flags)

    valid = not errors
    return OutputValidationResult(
        valid=valid,
        criteria_results=criteria_results,
        calculated_total=calculated_total,
        max_total=round(max_total, _ROUNDING_DECIMALS),
        percentage=percentage,
        validation_errors=errors,
        validation_warnings=warnings,
        review_flags=review_flags,
        requires_review=requires_review,
    )
