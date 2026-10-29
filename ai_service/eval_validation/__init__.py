"""
eval_validation — Shared guardrails and validation layer for all four
evaluation workflows: individual/batch assignment and individual/batch summary.

Submodules
----------
rubric_validator   : Validates rubric criteria structure, bounds, uniqueness.
injection_guard    : Detects prompt-injection attempts in student submissions.
input_validator    : Validates file formats, ZIP security, extraction results.
output_validator   : Enforces rubric authority; recalculates scores deterministically.
review_policy      : Evaluation state machine, review decision logic, audit trail.
accuracy_metrics   : MAE, RMSE, QWK, reliability metrics, and benchmark runner.
"""

# Expose the most commonly used symbols at package level for convenience.
from eval_validation.rubric_validator import (
    validate_rubric,
    snapshot_rubric,
    assert_rubric_unchanged,
    RubricValidationResult,
    RubricCriterion,
)
from eval_validation.injection_guard import (
    scan_for_injection,
    delimit_student_content,
    build_injection_safe_system_instruction,
    InjectionScanResult,
)
from eval_validation.input_validator import (
    validate_file,
    validate_zip_security,
    validate_extraction,
    FileValidationResult,
    ZipSecurityResult,
    ExtractionValidationResult,
)
from eval_validation.output_validator import (
    validate_llm_output,
    OutputValidationResult,
)
from eval_validation.review_policy import (
    EvalStatus,
    ReviewReason,
    ReviewDecision,
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
    compute_reliability_metrics,
    compute_full_report,
    run_accuracy_benchmark,
)

__all__ = [
    # rubric_validator
    "validate_rubric",
    "snapshot_rubric",
    "assert_rubric_unchanged",
    "RubricValidationResult",
    "RubricCriterion",
    # injection_guard
    "scan_for_injection",
    "delimit_student_content",
    "build_injection_safe_system_instruction",
    "InjectionScanResult",
    # input_validator
    "validate_file",
    "validate_zip_security",
    "validate_extraction",
    "FileValidationResult",
    "ZipSecurityResult",
    "ExtractionValidationResult",
    # output_validator
    "validate_llm_output",
    "OutputValidationResult",
    # review_policy
    "EvalStatus",
    "ReviewReason",
    "ReviewDecision",
    "decide_review",
    "is_legal_transition",
    "assert_legal_transition",
    "build_audit_trail",
    # accuracy_metrics
    "compute_mae",
    "compute_rmse",
    "compute_exact_agreement",
    "compute_within_tolerance",
    "compute_qwk",
    "compute_normalised_mae",
    "compute_repeatability",
    "compute_reliability_metrics",
    "compute_full_report",
    "run_accuracy_benchmark",
]
