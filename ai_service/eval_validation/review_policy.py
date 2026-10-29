"""
Evaluation state machine and review policy.

Defines explicit evaluation states, legal transitions, and the decision
logic that determines whether a result passes, needs retry, needs human
review, or has failed.

This module contains no LLM calls and no database operations.
"""

from __future__ import annotations

import enum
from dataclasses import dataclass, field
from typing import Optional


# ---------------------------------------------------------------------------
# Evaluation states
# ---------------------------------------------------------------------------

class EvalStatus(str, enum.Enum):
    """
    Lifecycle states for a single submission evaluation.

    RECEIVED        → Input received and queued.
    VALIDATING      → Input and file validation in progress.
    EVALUATING      → LLM call in progress.
    VALIDATING_RESULT → Post-LLM output validation in progress.
    NEEDS_REVIEW    → Passed structure validation but flagged for human review.
    COMPLETED       → All checks passed; grade is accepted.
    FAILED          → Validation or evaluation failed; no grade was assigned.
    """
    RECEIVED = "RECEIVED"
    VALIDATING = "VALIDATING"
    EVALUATING = "EVALUATING"
    VALIDATING_RESULT = "VALIDATING_RESULT"
    NEEDS_REVIEW = "NEEDS_REVIEW"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


# Legal state transitions
_LEGAL_TRANSITIONS: dict[EvalStatus, set[EvalStatus]] = {
    EvalStatus.RECEIVED:           {EvalStatus.VALIDATING, EvalStatus.FAILED},
    EvalStatus.VALIDATING:         {EvalStatus.EVALUATING, EvalStatus.FAILED},
    EvalStatus.EVALUATING:         {EvalStatus.VALIDATING_RESULT, EvalStatus.EVALUATING, EvalStatus.FAILED},
    EvalStatus.VALIDATING_RESULT:  {EvalStatus.COMPLETED, EvalStatus.NEEDS_REVIEW, EvalStatus.EVALUATING, EvalStatus.FAILED},
    EvalStatus.NEEDS_REVIEW:       {EvalStatus.COMPLETED, EvalStatus.FAILED},
    EvalStatus.COMPLETED:          set(),   # terminal
    EvalStatus.FAILED:             set(),   # terminal
}


def is_legal_transition(from_status: EvalStatus, to_status: EvalStatus) -> bool:
    return to_status in _LEGAL_TRANSITIONS.get(from_status, set())


def assert_legal_transition(from_status: EvalStatus, to_status: EvalStatus) -> None:
    if not is_legal_transition(from_status, to_status):
        raise ValueError(
            f"Illegal evaluation state transition: {from_status} → {to_status}"
        )


# ---------------------------------------------------------------------------
# Review policy
# ---------------------------------------------------------------------------

import os as _os

# Configurable thresholds
_LOW_CONFIDENCE_THRESHOLD = float(_os.environ.get("EVAL_REVIEW_CONFIDENCE_THRESHOLD", "0.5"))
_SCORE_DISAGREEMENT_THRESHOLD = float(_os.environ.get("EVAL_REVIEW_DISAGREEMENT_THRESHOLD", "1.5"))
_MAX_RETRIES = int(_os.environ.get("EVAL_MAX_RETRIES", "3"))


class ReviewReason(str, enum.Enum):
    LOW_CONFIDENCE       = "LOW_CONFIDENCE"
    UNVERIFIED_EVIDENCE  = "UNVERIFIED_EVIDENCE"
    MISSING_EVIDENCE     = "MISSING_EVIDENCE"
    SCORE_DISAGREEMENT   = "SCORE_DISAGREEMENT"
    INJECTION_DETECTED   = "INJECTION_DETECTED"
    EXTRACTION_SHORT     = "EXTRACTION_SHORT"
    EXTRACTION_OCR       = "EXTRACTION_OCR"
    VALIDATION_WARNING   = "VALIDATION_WARNING"
    RETRY_EXHAUSTED      = "RETRY_EXHAUSTED"
    FALLBACK_USED        = "FALLBACK_USED"


@dataclass
class ReviewDecision:
    """The review policy's verdict for one evaluation result."""
    status: EvalStatus
    review_reasons: list[ReviewReason] = field(default_factory=list)
    review_notes: list[str] = field(default_factory=list)
    retry_count: int = 0
    can_retry: bool = False


def decide_review(
    *,
    output_valid: bool,
    review_flags: list[str] | None = None,
    validation_errors: list[str] | None = None,
    confidence: Optional[float] = None,
    retry_count: int = 0,
    injection_detected: bool = False,
    extraction_short: bool = False,
    extraction_ocr: bool = False,
    used_fallback: bool = False,
    score_disagreement: Optional[float] = None,
) -> ReviewDecision:
    """
    Apply the review policy and return a ReviewDecision.

    Rules (in priority order):
      1. Invalid output with retries remaining → EVALUATING (retry).
      2. Invalid output with no retries → FAILED.
      3. Injection detected → NEEDS_REVIEW.
      4. Low confidence → NEEDS_REVIEW.
      5. Unverified / missing evidence → NEEDS_REVIEW.
      6. Other review flags → NEEDS_REVIEW.
      7. Fallback used → NEEDS_REVIEW.
      8. Otherwise → COMPLETED.
    """
    reasons: list[ReviewReason] = []
    notes: list[str] = list(review_flags or [])
    errors = list(validation_errors or [])

    # 1 & 2: structural failure
    if not output_valid:
        can_retry = retry_count < _MAX_RETRIES
        if can_retry:
            return ReviewDecision(
                status=EvalStatus.EVALUATING,
                review_reasons=[],
                review_notes=[f"Retry {retry_count + 1}/{_MAX_RETRIES}: " + "; ".join(errors[:2])],
                retry_count=retry_count,
                can_retry=True,
            )
        reasons.append(ReviewReason.RETRY_EXHAUSTED)
        return ReviewDecision(
            status=EvalStatus.FAILED,
            review_reasons=reasons,
            review_notes=["Validation failed after " + str(retry_count) + " retries: " + "; ".join(errors[:3])],
            retry_count=retry_count,
            can_retry=False,
        )

    # 3: injection
    if injection_detected:
        reasons.append(ReviewReason.INJECTION_DETECTED)
        notes.append("Potential prompt-injection content detected in submission.")

    # 4: confidence
    if confidence is not None and confidence < _LOW_CONFIDENCE_THRESHOLD:
        reasons.append(ReviewReason.LOW_CONFIDENCE)
        notes.append(f"Model confidence {confidence:.2f} below threshold {_LOW_CONFIDENCE_THRESHOLD}.")

    # 5: evidence issues (from review_flags text)
    for flag in (review_flags or []):
        if "evidence" in flag.lower():
            r = (ReviewReason.UNVERIFIED_EVIDENCE
                 if "could not be located" in flag.lower()
                 else ReviewReason.MISSING_EVIDENCE)
            if r not in reasons:
                reasons.append(r)

    # 6: other flags
    if review_flags:
        for flag in review_flags:
            if "disagreement" in flag.lower() or "discrepancy" in flag.lower():
                if ReviewReason.SCORE_DISAGREEMENT not in reasons:
                    reasons.append(ReviewReason.SCORE_DISAGREEMENT)

    # 7: extraction issues
    if extraction_short:
        reasons.append(ReviewReason.EXTRACTION_SHORT)
        notes.append("Submission text was very short; verify extraction quality.")
    if extraction_ocr:
        reasons.append(ReviewReason.EXTRACTION_OCR)
        notes.append("Text was extracted via OCR; accuracy may vary.")

    # 8: fallback
    if used_fallback:
        reasons.append(ReviewReason.FALLBACK_USED)
        notes.append("Deterministic fallback evaluation was used instead of LLM.")

    # Score disagreement between two evaluations
    if score_disagreement is not None and score_disagreement > _SCORE_DISAGREEMENT_THRESHOLD:
        if ReviewReason.SCORE_DISAGREEMENT not in reasons:
            reasons.append(ReviewReason.SCORE_DISAGREEMENT)
        notes.append(f"Re-evaluation score disagreement {score_disagreement:.2f} exceeds threshold.")

    if reasons:
        return ReviewDecision(
            status=EvalStatus.NEEDS_REVIEW,
            review_reasons=reasons,
            review_notes=notes,
            retry_count=retry_count,
            can_retry=False,
        )

    return ReviewDecision(
        status=EvalStatus.COMPLETED,
        review_reasons=[],
        review_notes=[],
        retry_count=retry_count,
        can_retry=False,
    )


# ---------------------------------------------------------------------------
# Audit trail helper
# ---------------------------------------------------------------------------

import datetime


def build_audit_trail(
    *,
    evaluation_id: str,
    submission_reference: str,
    rubric_snapshot: dict,
    model_id: str,
    evaluator_version: str,
    retry_count: int,
    review_flags: list[str],
    final_status: EvalStatus,
    calculated_total: float,
    max_total: float,
    validation_errors: list[str],
) -> dict:
    """
    Build a metadata record that can be stored alongside each evaluation.
    This allows auditing and reproducing the decision without storing
    the full prompt or sensitive student data.
    """
    return {
        "evaluationId": evaluation_id,
        "submissionReference": submission_reference,
        "rubricSnapshot": rubric_snapshot,
        "modelId": model_id,
        "evaluatorVersion": evaluator_version,
        "evaluationTimestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "retryCount": retry_count,
        "reviewFlags": review_flags,
        "finalStatus": final_status.value,
        "calculatedTotal": calculated_total,
        "maxTotal": max_total,
        "validationErrors": validation_errors,
    }
