"""Tests for the review policy and accuracy metrics."""
import math
import pytest
from eval_validation.review_policy import (
    EvalStatus,
    decide_review,
    is_legal_transition,
    assert_legal_transition,
    build_audit_trail,
)
from eval_validation.accuracy_metrics import (
    compute_mae,
    compute_rmse,
    compute_exact_agreement,
    compute_within_tolerance,
    compute_qwk,
    compute_normalised_mae,
    compute_repeatability,
    compute_full_report,
    compute_reliability_metrics,
)


# ===========================================================================
# Review policy
# ===========================================================================

class TestStateMachine:

    def test_received_to_validating_is_legal(self):
        assert is_legal_transition(EvalStatus.RECEIVED, EvalStatus.VALIDATING)

    def test_received_to_completed_is_illegal(self):
        assert not is_legal_transition(EvalStatus.RECEIVED, EvalStatus.COMPLETED)

    def test_completed_has_no_legal_transitions(self):
        for status in EvalStatus:
            assert not is_legal_transition(EvalStatus.COMPLETED, status)

    def test_failed_has_no_legal_transitions(self):
        for status in EvalStatus:
            assert not is_legal_transition(EvalStatus.FAILED, status)

    def test_assert_legal_transition_raises_for_illegal(self):
        with pytest.raises(ValueError, match="Illegal evaluation state transition"):
            assert_legal_transition(EvalStatus.COMPLETED, EvalStatus.EVALUATING)

    def test_all_legal_transitions_are_reachable(self):
        # Verify the full pipeline is reachable
        chain = [
            (EvalStatus.RECEIVED, EvalStatus.VALIDATING),
            (EvalStatus.VALIDATING, EvalStatus.EVALUATING),
            (EvalStatus.EVALUATING, EvalStatus.VALIDATING_RESULT),
            (EvalStatus.VALIDATING_RESULT, EvalStatus.COMPLETED),
        ]
        for from_s, to_s in chain:
            assert is_legal_transition(from_s, to_s), f"{from_s} → {to_s} should be legal"


class TestReviewDecision:

    def test_valid_output_no_flags_gives_completed(self):
        decision = decide_review(output_valid=True)
        assert decision.status == EvalStatus.COMPLETED

    def test_invalid_output_with_retries_gives_evaluating(self):
        decision = decide_review(output_valid=False, validation_errors=["Bad JSON"], retry_count=0)
        assert decision.status == EvalStatus.EVALUATING
        assert decision.can_retry

    def test_invalid_output_exhausted_retries_gives_failed(self):
        decision = decide_review(output_valid=False, validation_errors=["Bad JSON"], retry_count=3)
        assert decision.status == EvalStatus.FAILED
        assert not decision.can_retry

    def test_injection_detected_gives_needs_review(self):
        decision = decide_review(output_valid=True, injection_detected=True)
        assert decision.status == EvalStatus.NEEDS_REVIEW

    def test_low_confidence_gives_needs_review(self):
        decision = decide_review(output_valid=True, confidence=0.3)
        assert decision.status == EvalStatus.NEEDS_REVIEW

    def test_high_confidence_does_not_require_review(self):
        decision = decide_review(output_valid=True, confidence=0.9)
        assert decision.status == EvalStatus.COMPLETED

    def test_short_extraction_flags_for_review(self):
        decision = decide_review(output_valid=True, extraction_short=True)
        assert decision.status == EvalStatus.NEEDS_REVIEW

    def test_fallback_evaluation_flags_for_review(self):
        decision = decide_review(output_valid=True, used_fallback=True)
        assert decision.status == EvalStatus.NEEDS_REVIEW

    def test_score_disagreement_above_threshold_flags_review(self):
        decision = decide_review(output_valid=True, score_disagreement=2.5)
        assert decision.status == EvalStatus.NEEDS_REVIEW

    def test_score_disagreement_below_threshold_does_not_flag(self):
        decision = decide_review(output_valid=True, score_disagreement=0.5)
        assert decision.status == EvalStatus.COMPLETED


class TestAuditTrail:

    def test_build_audit_trail_is_serialisable(self):
        import json
        trail = build_audit_trail(
            evaluation_id="eval-001",
            submission_reference="sub-abc",
            rubric_snapshot={"criteria": [], "total_max_score": 10},
            model_id="test-model",
            evaluator_version="1.0",
            retry_count=0,
            review_flags=[],
            final_status=EvalStatus.COMPLETED,
            calculated_total=7.5,
            max_total=10.0,
            validation_errors=[],
        )
        json.dumps(trail)  # Must not raise
        assert trail["finalStatus"] == "COMPLETED"
        assert "evaluationTimestamp" in trail


# ===========================================================================
# Accuracy metrics
# ===========================================================================

class TestMAE:
    def test_perfect_agreement_is_zero(self):
        assert compute_mae([5.0, 3.0], [5.0, 3.0]) == 0.0

    def test_known_mae(self):
        # |3-5| + |4-2| = 2 + 2 = 4; 4/2 = 2.0
        assert compute_mae([3.0, 4.0], [5.0, 2.0]) == 2.0

    def test_mismatched_lengths_raises(self):
        with pytest.raises(ValueError, match="same length"):
            compute_mae([1.0], [1.0, 2.0])

    def test_empty_raises(self):
        with pytest.raises(ValueError):
            compute_mae([], [])

    def test_non_finite_raises(self):
        with pytest.raises(ValueError):
            compute_mae([float("nan")], [1.0])


class TestRMSE:
    def test_perfect_agreement_is_zero(self):
        assert compute_rmse([5.0, 5.0], [5.0, 5.0]) == 0.0

    def test_known_rmse(self):
        # sqrt((1^2 + 3^2) / 2) = sqrt(5) ≈ 2.236
        result = compute_rmse([4.0, 7.0], [5.0, 4.0])
        assert abs(result - math.sqrt(5)) < 1e-9


class TestExactAgreement:
    def test_all_match(self):
        assert compute_exact_agreement([1.0, 2.0, 3.0], [1.0, 2.0, 3.0]) == 1.0

    def test_no_match(self):
        assert compute_exact_agreement([1.0, 2.0], [3.0, 4.0]) == 0.0

    def test_partial_match(self):
        assert compute_exact_agreement([1.0, 2.0, 3.0], [1.0, 99.0, 3.0]) == pytest.approx(2 / 3)


class TestWithinTolerance:
    def test_all_within_one(self):
        ai = [5.0, 3.0, 7.0]
        human = [4.5, 3.5, 7.0]
        assert compute_within_tolerance(ai, human, tolerance=1.0) == 1.0

    def test_none_within_zero_tolerance(self):
        assert compute_within_tolerance([1.0, 2.0], [2.0, 3.0], tolerance=0.0) == 0.0

    def test_partial(self):
        result = compute_within_tolerance([1.0, 5.0, 3.0], [1.0, 3.0, 3.0], tolerance=1.0)
        assert result == pytest.approx(2 / 3)


class TestQWK:
    def test_perfect_agreement_is_one(self):
        scores = [1.0, 2.0, 3.0, 4.0, 5.0]
        assert compute_qwk(scores, scores, min_score=0.0, max_score=5.0) == pytest.approx(1.0)

    def test_opposite_agreement_is_negative(self):
        ai    = [0.0, 0.0, 0.0, 5.0, 5.0, 5.0]
        human = [5.0, 5.0, 5.0, 0.0, 0.0, 0.0]
        qwk = compute_qwk(ai, human, min_score=0.0, max_score=5.0)
        assert qwk < 0

    def test_returns_value_in_range(self):
        ai    = [1.0, 3.0, 2.0, 4.0]
        human = [2.0, 2.0, 4.0, 3.0]
        qwk = compute_qwk(ai, human, min_score=0.0, max_score=5.0)
        assert -1.0 <= qwk <= 1.0


class TestNormalisedMAE:
    def test_fully_normalised(self):
        # Both use max=10; |9-10|/10 = 0.1, |4-5|/10 = 0.1; avg = 0.1
        result = compute_normalised_mae([9.0, 4.0], [10.0, 5.0], [10.0, 10.0])
        assert abs(result - 0.1) < 1e-9

    def test_zero_max_raises(self):
        with pytest.raises(ValueError, match="positive"):
            compute_normalised_mae([1.0], [2.0], [0.0])


class TestRepeatability:
    def test_identical_runs_give_zero_std(self):
        runs = [[5.0, 3.0, 7.0], [5.0, 3.0, 7.0], [5.0, 3.0, 7.0]]
        result = compute_repeatability(runs)
        assert result["mean_std"] == 0.0
        assert result["exact_consistency_rate"] == 1.0

    def test_varying_runs_give_nonzero_std(self):
        runs = [[5.0, 3.0], [6.0, 2.0], [4.0, 4.0]]
        result = compute_repeatability(runs)
        assert result["mean_std"] > 0.0
        assert result["exact_consistency_rate"] < 1.0

    def test_mismatched_run_lengths_raise(self):
        with pytest.raises(ValueError):
            compute_repeatability([[1.0, 2.0], [3.0]])


class TestFullReport:
    def test_report_contains_required_keys(self):
        ai    = [4.0, 3.0, 5.0, 2.0, 4.0]
        human = [5.0, 3.0, 4.0, 3.0, 5.0]
        report = compute_full_report(ai, human, max_score=5.0, tolerance=1.0, label="Q1")
        for key in ("mae", "rmse", "exactAgreement", "withinToleranceAgreement",
                    "quadraticWeightedKappa", "sampleSize", "limitations"):
            assert key in report, f"Missing key: {key}"

    def test_report_limitations_present(self):
        report = compute_full_report([1.0], [1.0], max_score=5.0)
        assert isinstance(report["limitations"], list)
        assert len(report["limitations"]) > 0


class TestReliabilityMetrics:
    def test_perfect_reliability(self):
        result = compute_reliability_metrics(
            100,
            valid_output_count=100,
            evidence_verified_count=100,
            rubric_compliant_count=100,
            guardrail_pass_count=100,
            review_required_count=0,
            failed_count=0,
            retry_count=0,
        )
        assert result["validOutputRate"] == 1.0
        assert result["evaluationFailureRate"] == 0.0

    def test_zero_total_returns_zero_rates(self):
        result = compute_reliability_metrics(
            0,
            valid_output_count=0,
            evidence_verified_count=0,
            rubric_compliant_count=0,
            guardrail_pass_count=0,
            review_required_count=0,
            failed_count=0,
            retry_count=0,
        )
        assert result["validOutputRate"] == 0.0
