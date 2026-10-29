"""
Accuracy and reliability metrics for evaluation benchmarking.

Provides functions to compute MAE, RMSE, exact agreement, within-tolerance
agreement, and Quadratic Weighted Kappa (QWK) between AI-generated scores
and human reference scores.

This module has NO external dependencies beyond the standard library and
numpy.  It is designed to be called from a standalone benchmark script or
from test code; it does not import anything from the evaluation pipelines.

Usage
-----
    from eval_validation.accuracy_metrics import (
        compute_mae, compute_rmse, compute_exact_agreement,
        compute_within_tolerance, compute_qwk, compute_full_report,
    )

    report = compute_full_report(ai_scores, human_scores, max_score=10)
    print(report)
"""

from __future__ import annotations

import math
import json
import os
from typing import Optional


# ---------------------------------------------------------------------------
# Core metric functions
# ---------------------------------------------------------------------------

def _validate_inputs(ai_scores: list[float], human_scores: list[float]) -> None:
    if len(ai_scores) != len(human_scores):
        raise ValueError(
            f"ai_scores and human_scores must have the same length; "
            f"got {len(ai_scores)} and {len(human_scores)}."
        )
    if not ai_scores:
        raise ValueError("Score lists must not be empty.")
    for i, (a, h) in enumerate(zip(ai_scores, human_scores)):
        if not math.isfinite(a):
            raise ValueError(f"ai_scores[{i}] is not finite: {a}")
        if not math.isfinite(h):
            raise ValueError(f"human_scores[{i}] is not finite: {h}")


def compute_mae(ai_scores: list[float], human_scores: list[float]) -> float:
    """Mean Absolute Error between AI and human scores."""
    _validate_inputs(ai_scores, human_scores)
    return sum(abs(a - h) for a, h in zip(ai_scores, human_scores)) / len(ai_scores)


def compute_rmse(ai_scores: list[float], human_scores: list[float]) -> float:
    """Root Mean Squared Error — penalises larger deviations more strongly."""
    _validate_inputs(ai_scores, human_scores)
    mse = sum((a - h) ** 2 for a, h in zip(ai_scores, human_scores)) / len(ai_scores)
    return math.sqrt(mse)


def compute_exact_agreement(ai_scores: list[float], human_scores: list[float]) -> float:
    """Fraction of AI scores that exactly match the human reference."""
    _validate_inputs(ai_scores, human_scores)
    matches = sum(1 for a, h in zip(ai_scores, human_scores) if a == h)
    return matches / len(ai_scores)


def compute_within_tolerance(
    ai_scores: list[float],
    human_scores: list[float],
    *,
    tolerance: float = 1.0,
) -> float:
    """
    Fraction of AI scores within `tolerance` marks of the human reference.
    The default tolerance of 1.0 is suitable for rubrics scored 0-10.
    Normalise by max_score if comparing rubrics with different scales.
    """
    _validate_inputs(ai_scores, human_scores)
    within = sum(1 for a, h in zip(ai_scores, human_scores) if abs(a - h) <= tolerance)
    return within / len(ai_scores)


def compute_qwk(
    ai_scores: list[float],
    human_scores: list[float],
    *,
    min_score: float = 0.0,
    max_score: float = 10.0,
) -> float:
    """
    Quadratic Weighted Kappa — appropriate for ordinal grading scales.
    Returns a value in [-1, 1] where 1 = perfect agreement.

    Scores are rounded to the nearest integer for the confusion matrix.
    Only suitable when both AI and human scores are drawn from the same
    ordinal scale.
    """
    _validate_inputs(ai_scores, human_scores)
    n = len(ai_scores)
    low = int(round(min_score))
    high = int(round(max_score))
    num_classes = high - low + 1

    ai_int  = [max(low, min(high, int(round(a)))) for a in ai_scores]
    hum_int = [max(low, min(high, int(round(h)))) for h in human_scores]

    # Observed weight matrix
    observed = [[0] * num_classes for _ in range(num_classes)]
    for a, h in zip(ai_int, hum_int):
        observed[a - low][h - low] += 1

    # Expected weight matrix (outer product of marginals)
    ai_marginal  = [0] * num_classes
    hum_marginal = [0] * num_classes
    for a, h in zip(ai_int, hum_int):
        ai_marginal[a - low]  += 1
        hum_marginal[h - low] += 1

    weight = [[0.0] * num_classes for _ in range(num_classes)]
    for i in range(num_classes):
        for j in range(num_classes):
            weight[i][j] = ((i - j) ** 2) / ((num_classes - 1) ** 2)

    numerator = 0.0
    denominator = 0.0
    for i in range(num_classes):
        for j in range(num_classes):
            expected = ai_marginal[i] * hum_marginal[j] / n
            numerator   += weight[i][j] * observed[i][j]
            denominator += weight[i][j] * expected

    if denominator == 0:
        return 1.0
    return 1.0 - numerator / denominator


def compute_normalised_mae(
    ai_scores: list[float],
    human_scores: list[float],
    max_scores: list[float],
) -> float:
    """
    MAE normalised by each criterion's maximum score.
    Useful when comparing criteria with different point scales.
    """
    _validate_inputs(ai_scores, human_scores)
    if len(max_scores) != len(ai_scores):
        raise ValueError("max_scores must have the same length as ai_scores.")
    errors = []
    for a, h, m in zip(ai_scores, human_scores, max_scores):
        if m <= 0:
            raise ValueError(f"max_score must be positive, got {m}.")
        errors.append(abs(a - h) / m)
    return sum(errors) / len(errors)


# ---------------------------------------------------------------------------
# Repeatability
# ---------------------------------------------------------------------------

def compute_repeatability(
    score_runs: list[list[float]],
) -> dict:
    """
    Measure score repeatability across multiple runs of identical inputs.

    `score_runs` is a list of score lists; each inner list contains the
    scores for all submissions in one run.  All inner lists must be the
    same length.

    Returns:
      - mean_score_per_submission: average score across runs per submission
      - std_per_submission:        standard deviation across runs per submission
      - mean_std:                  average std across all submissions
      - max_std:                   maximum std (worst case)
      - exact_consistency_rate:    fraction of submissions whose score never
                                   changed across all runs
    """
    if not score_runs or not score_runs[0]:
        raise ValueError("score_runs must be a non-empty list of non-empty lists.")
    n_subs = len(score_runs[0])
    if any(len(run) != n_subs for run in score_runs):
        raise ValueError("All runs must contain the same number of submissions.")

    means: list[float] = []
    stds: list[float] = []
    exact_consistent = 0

    for i in range(n_subs):
        scores = [run[i] for run in score_runs]
        mean = sum(scores) / len(scores)
        variance = sum((s - mean) ** 2 for s in scores) / len(scores)
        std = math.sqrt(variance)
        means.append(mean)
        stds.append(std)
        if len(set(scores)) == 1:
            exact_consistent += 1

    return {
        "mean_score_per_submission": means,
        "std_per_submission": stds,
        "mean_std": sum(stds) / len(stds),
        "max_std": max(stds),
        "exact_consistency_rate": exact_consistent / n_subs,
        "run_count": len(score_runs),
        "submission_count": n_subs,
    }


# ---------------------------------------------------------------------------
# Reliability metrics
# ---------------------------------------------------------------------------

def compute_reliability_metrics(
    total_submissions: int,
    *,
    valid_output_count: int,
    evidence_verified_count: int,
    rubric_compliant_count: int,
    guardrail_pass_count: int,
    review_required_count: int,
    failed_count: int,
    retry_count: int,
) -> dict:
    """
    Compute reliability metrics for a batch evaluation run.
    All counts are for the set of submissions that reached that stage.
    """
    def rate(numerator: int, denominator: int = total_submissions) -> float:
        return round(numerator / denominator, 4) if denominator > 0 else 0.0

    return {
        "totalSubmissions": total_submissions,
        "validOutputRate": rate(valid_output_count),
        "evidenceVerificationPassRate": rate(evidence_verified_count),
        "rubricCompliancePassRate": rate(rubric_compliant_count),
        "guardrailPassRate": rate(guardrail_pass_count),
        "humanReviewRate": rate(review_required_count),
        "evaluationFailureRate": rate(failed_count),
        "retryRate": rate(retry_count),
    }


# ---------------------------------------------------------------------------
# Full benchmark report
# ---------------------------------------------------------------------------

def compute_full_report(
    ai_scores: list[float],
    human_scores: list[float],
    *,
    max_score: float = 10.0,
    tolerance: float = 1.0,
    label: str = "Criterion",
) -> dict:
    """
    Compute a complete accuracy report for one criterion or for totals.

    Returns a dict suitable for JSON serialisation or printing.
    """
    n = len(ai_scores)
    _validate_inputs(ai_scores, human_scores)

    mae      = compute_mae(ai_scores, human_scores)
    rmse     = compute_rmse(ai_scores, human_scores)
    exact    = compute_exact_agreement(ai_scores, human_scores)
    within   = compute_within_tolerance(ai_scores, human_scores, tolerance=tolerance)
    qwk      = compute_qwk(ai_scores, human_scores, min_score=0.0, max_score=max_score)
    norm_mae = compute_normalised_mae(ai_scores, human_scores, [max_score] * n)

    # Human score statistics (for context)
    h_mean = sum(human_scores) / n
    h_var  = sum((h - h_mean) ** 2 for h in human_scores) / n
    h_std  = math.sqrt(h_var)

    return {
        "label": label,
        "sampleSize": n,
        "maxScore": max_score,
        "tolerance": tolerance,
        "mae": round(mae, 4),
        "rmse": round(rmse, 4),
        "normalisedMae": round(norm_mae, 4),
        "exactAgreement": round(exact, 4),
        "withinToleranceAgreement": round(within, 4),
        "quadraticWeightedKappa": round(qwk, 4),
        "humanScoreMean": round(h_mean, 4),
        "humanScoreStd": round(h_std, 4),
        "limitations": [
            "QWK requires ordinal scale; verify scale before interpreting.",
            f"Sample size {n} is {'small' if n < 30 else 'moderate' if n < 100 else 'adequate'} — interpret with caution.",
            "No confidence intervals are computed; collect a larger dataset for statistical significance.",
        ],
    }



# ---------------------------------------------------------------------------
# Benchmark runner interface
# ---------------------------------------------------------------------------

def run_accuracy_benchmark(
    comparison_data: list[dict] | dict,
    *,
    total_max_score: float = 100.0,
    tolerance: float = 2.0,
    dataset_name: str = "Unspecified Reference Dataset",
    is_synthetic: bool = False,
    is_human_reference: bool = False,
) -> dict:
    """
    Executes a structured benchmark comparing AI evaluation scores against
    reference grades.

    CRITICAL SAFETY REQUIREMENT:
    `accuracyMeasured: true` is set ONLY when the input is explicitly identified
    as a genuine human-graded reference dataset (via `is_human_reference=True`
    or explicit metadata in the dataset payload) and is not synthetic/demo data.
    Supplying an arbitrary .json or .csv without explicit human-grade certification
    will produce `accuracyMeasured: false` and `status: "UNVERIFIED_DATASET"`.

    Parameters
    ----------
    comparison_data:
        List of comparison dicts OR a dict payload containing a "samples" / "data"
        list and metadata. Each item contains:
          - 'aiScore': float
          - 'humanScore': float
          - 'criterion': optional str
          - 'maxScore': optional float
          - 'guardrailPass': optional bool
          - 'needsReview': optional bool
    total_max_score:
        Maximum total score scale.
    tolerance:
        Absolute score delta allowed for 'within-tolerance' agreement.
    dataset_name:
        Descriptive label for the reference dataset.
    is_synthetic:
        Set to True when running synthetic/calibration samples for pipeline
        testing. Always sets accuracyMeasured to False.
    is_human_reference:
        Explicitly certify that the reference scores originate from verified
        human grading (e.g. professor or teaching assistant evaluations).
        Defaults to False.
    """
    # Handle dict payload with top-level metadata
    records = comparison_data
    if isinstance(comparison_data, dict):
        if not is_human_reference:
            is_human_reference = bool(
                comparison_data.get("isHumanReference")
                or comparison_data.get("is_human_reference")
                or comparison_data.get("datasetType") == "human_graded_reference"
            )
        if dataset_name == "Unspecified Reference Dataset":
            dataset_name = comparison_data.get("datasetName") or comparison_data.get("name") or dataset_name
        records = (
            comparison_data.get("samples")
            or comparison_data.get("data")
            or comparison_data.get("records")
            or comparison_data.get("comparisons")
            or []
        )

    # Detect synthetic / demo keywords
    is_demo = is_synthetic or any(
        kw in dataset_name.lower()
        for kw in ("synthetic", "demo", "demonstration", "mock", "calibration", "simulated")
    )

    # If records has sample-level human reference certification
    if not is_human_reference and isinstance(records, list) and records:
        if all(item.get("isHumanReference") or item.get("is_human_reference") for item in records if isinstance(item, dict)):
            is_human_reference = True

    if not records:
        return {
            "status": "UNMEASURED",
            "message": "No comparison data provided. Actual grading accuracy remains unmeasured.",
            "datasetName": dataset_name,
            "sampleSize": 0,
            "isSyntheticDemonstration": is_demo,
            "isHumanReference": is_human_reference,
            "accuracyMeasured": False,
            "overallAgreement": None,
            "perCriterionAgreement": {},
            "disclaimer": "Actual grading accuracy against human-graded academic submissions remains unmeasured.",
        }

    ai_totals = []
    human_totals = []
    by_criterion: dict[str, dict[str, list[float]]] = {}
    guardrail_passes = 0
    review_count = 0

    for item in records:
        if not isinstance(item, dict):
            continue
        ai_s = float(item.get("aiScore", item.get("ai_score", 0.0)))
        human_s = float(item.get("humanScore", item.get("human_score", 0.0)))
        crit = item.get("criterion") or item.get("criterionName")

        if crit:
            crit_max = float(item.get("maxScore", 10.0))
            if crit not in by_criterion:
                by_criterion[crit] = {"ai": [], "human": [], "max": crit_max}
            by_criterion[crit]["ai"].append(ai_s)
            by_criterion[crit]["human"].append(human_s)
        else:
            ai_totals.append(ai_s)
            human_totals.append(human_s)

        if item.get("guardrailPass") is True:
            guardrail_passes += 1
        if item.get("needsReview") is True:
            review_count += 1

    overall_report = None
    if ai_totals and human_totals:
        overall_report = compute_full_report(
            ai_totals,
            human_totals,
            max_score=total_max_score,
            tolerance=tolerance,
            label="Total Score Agreement",
        )

    criterion_reports = {}
    for crit_name, data in by_criterion.items():
        if data["ai"] and data["human"]:
            criterion_reports[crit_name] = compute_full_report(
                data["ai"],
                data["human"],
                max_score=data["max"],
                tolerance=max(1.0, data["max"] * 0.1),
                label=f"Criterion: {crit_name}",
            )

    # STRICT ACCURACY MEASUREMENT DETERMINATION:
    # accuracyMeasured is True ONLY if explicitly certified as human reference AND not demo
    if is_demo:
        status = "SYNTHETIC_DEMONSTRATION"
        accuracy_measured = False
        disclaimer = (
            "Synthetic demonstration data used for pipeline and formula verification only. "
            "Actual grading accuracy against human-graded academic submissions remains unmeasured."
        )
    elif is_human_reference:
        status = "EVALUATED_AGAINST_HUMAN_REFERENCE"
        accuracy_measured = True
        disclaimer = f"Evaluated against certified human-graded reference dataset '{dataset_name}'."
    else:
        status = "UNVERIFIED_DATASET"
        accuracy_measured = False
        disclaimer = (
            "Dataset supplied without explicit certification as a genuine human-graded reference dataset. "
            "Actual grading accuracy against human-graded academic submissions remains unmeasured."
        )

    return {
        "status": status,
        "datasetName": dataset_name,
        "sampleSize": len(records),
        "totalMaxScore": total_max_score,
        "tolerance": tolerance,
        "isSyntheticDemonstration": is_demo,
        "isHumanReference": is_human_reference and not is_demo,
        "accuracyMeasured": accuracy_measured,
        "overallAgreement": overall_report,
        "perCriterionAgreement": criterion_reports,
        "guardrailPassRate": round(guardrail_passes / len(records), 4) if records else 0.0,
        "humanReviewRate": round(review_count / len(records), 4) if records else 0.0,
        "disclaimer": disclaimer,
    }


if __name__ == "__main__":
    import sys
    print("=" * 60)
    print("Agentic AI Evaluation Benchmark Runner")
    print("=" * 60)
    
    args = sys.argv[1:]
    is_human_cert = "--human-reference" in args or "--certified" in args
    file_args = [a for a in args if not a.startswith("--")]

    if file_args and os.path.exists(file_args[0]):
        filepath = file_args[0]
        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)
        report = run_accuracy_benchmark(
            data,
            dataset_name=os.path.basename(filepath),
            is_synthetic=False,
            is_human_reference=is_human_cert,
        )
        print(json.dumps(report, indent=2))
        if not report["accuracyMeasured"]:
            print("\n[SAFETY NOTICE] Dataset was evaluated for scoring consistency, but accuracyMeasured is FALSE")
            print("because the file was not certified as a genuine human-graded reference dataset.")
            print("To certify a verified human reference dataset, pass the --human-reference CLI flag or set 'isHumanReference': true in the file.")
    else:
        print("[INFO] No external dataset provided.")
        print("[INFO] Demonstrating benchmark calculation using 5 verifiable calibration points:")
        demo_data = [
            {"aiScore": 85.0, "humanScore": 82.0, "maxScore": 100.0, "guardrailPass": True},
            {"aiScore": 72.0, "humanScore": 75.0, "maxScore": 100.0, "guardrailPass": True},
            {"aiScore": 90.0, "humanScore": 90.0, "maxScore": 100.0, "guardrailPass": True},
            {"aiScore": 60.0, "humanScore": 65.0, "maxScore": 100.0, "guardrailPass": True, "needsReview": True},
            {"aiScore": 45.0, "humanScore": 40.0, "maxScore": 100.0, "guardrailPass": True, "needsReview": True},
        ]
        demo_report = run_accuracy_benchmark(
            demo_data,
            dataset_name="Synthetic Demonstration Samples",
            is_synthetic=True,
            is_human_reference=False,
        )
        print(json.dumps(demo_report, indent=2))
        print("\nNOTE: The above is a synthetic demonstration to verify metric formulas.")
        print("Actual grading accuracy against an official human-graded academic dataset remains unmeasured.")
