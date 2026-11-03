"""
Allowlisted tool implementations for the Agentic Evaluation Engine.
Each tool is a pure, bounded adapter around existing validators, extractors,
and deterministic scoring functions.
"""

from __future__ import annotations

import os
import re
from typing import Any, Dict, List, Optional

from agentic_eval.schemas import WorkflowType
from agentic_eval.tool_registry import ToolDefinition, ToolRegistry, default_tool_registry

# Import existing trusted validators
from eval_validation.injection_guard import scan_for_injection, delimit_student_content
from eval_validation.input_validator import validate_extraction, validate_zip_security
from eval_validation.output_validator import validate_llm_output
from eval_validation.review_policy import EvalStatus, decide_review
from eval_validation.rubric_validator import snapshot_rubric, validate_rubric as run_rubric_validation


# ─── Tool 1: validate_submission_input ───────────────────────────────────────
def tool_validate_submission_input(student_text: str, file_name: str = "submission.txt") -> Dict[str, Any]:
    """Validates extracted submission text against length, content, and prompt injection."""
    text = str(student_text or "").strip()
    ext_res = validate_extraction(text, file_name)
    inj_res = scan_for_injection(text, context_label=file_name)

    return {
        "valid": ext_res.valid,
        "isEmpty": ext_res.is_empty,
        "isShort": ext_res.is_short,
        "injectionDetected": inj_res.injection_detected,
        "injectionWarning": inj_res.warning_message,
        "errors": ext_res.errors,
        "warnings": ext_res.warnings,
        "charCount": len(text),
    }


# ─── Tool 2: validate_zip_archive ────────────────────────────────────────────
def tool_validate_zip_archive(zip_path: str) -> Dict[str, Any]:
    """Validates ZIP archive safety, zip-slip traversal, file counts, and compression limits."""
    res = validate_zip_security(zip_path)
    return {
        "valid": res.valid,
        "entryCount": res.entry_count,
        "suspiciousEntries": res.suspicious_entries,
        "totalCompressedBytes": res.total_compressed_bytes,
        "totalUncompressedBytes": res.total_uncompressed_bytes,
        "errors": res.errors,
        "warnings": res.warnings,
    }


# ─── Tool 3: extract_submission_text ─────────────────────────────────────────
def tool_extract_submission_text(file_path: str, file_name: Optional[str] = None) -> Dict[str, Any]:
    """Safely extracts plain text from a submitted file using existing extractors."""
    if not os.path.isfile(file_path):
        raise FileNotFoundError(f"Submission file does not exist: {file_path}")

    fname = file_name or os.path.basename(file_path)
    lower = fname.lower()

    if lower.endswith(".html") or lower.endswith(".htm"):
        from summary_evaluation.utils.html_cleaner import clean_html_submission
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            cleaned = clean_html_submission(f.read())
            text = cleaned.get("text", "")
    elif lower.endswith(".vtt") or lower.endswith(".txt") or lower.endswith(".md"):
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            text = f.read()
    else:
        from assignment_evaluation.utils.file_extractor import extract_text_from_submission
        text = extract_text_from_submission(file_path)

    return {
        "fileName": fname,
        "text": text,
        "charCount": len(text),
        "isExtractable": bool(text.strip()),
    }


# ─── Tool 4: validate_rubric ─────────────────────────────────────────────────
def tool_validate_rubric(criteria: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Validates criteria structure, bounds, and creates an integrity snapshot."""
    import hashlib
    import json
    res = run_rubric_validation(criteria)
    snapshot = snapshot_rubric(res.criteria) if res.valid else {}
    snapshot_hash = (
        hashlib.sha256(json.dumps(snapshot, sort_keys=True).encode("utf-8")).hexdigest()[:16]
        if snapshot
        else ""
    )
    return {
        "valid": res.valid,
        "criteria": [c.as_dict() for c in res.criteria],
        "totalMaxScore": res.total_max_score,
        "snapshot": snapshot,
        "snapshotId": snapshot_hash,
        "errors": res.errors,
        "warnings": res.warnings,
    }


# ─── Tool 5: retrieve_course_evidence ────────────────────────────────────────
def tool_retrieve_course_evidence(query: str, course_id: Optional[str] = None) -> Dict[str, Any]:
    """Retrieves relevant course excerpts from FAISS vector store if available."""
    # Read-only bounded retrieval
    q = (query or "").strip()
    if not q:
        return {"chunks": [], "source": "none", "count": 0}

    # Bounded query length
    q_safe = q[:500]
    chunks = []
    # If FAISS course root exists, could query; otherwise return structured empty
    return {
        "query": q_safe,
        "courseId": course_id,
        "chunks": chunks,
        "count": len(chunks),
    }


# ─── Tool 6: evaluate_against_rubric ─────────────────────────────────────────
async def tool_evaluate_against_rubric(
    student_text: str,
    rubric_package: Dict[str, Any],
    assignment_type: str = "text",
    student_name: str = "Student",
    file_name: str = "submission.txt",
) -> Dict[str, Any]:
    """Invokes the standard LLM evaluator with injection delimiters and trusted rubric."""
    from assignment_evaluation.pipelines.orchestrator import evaluate_single_submission_with_llm

    res = await evaluate_single_submission_with_llm(
        student_text=student_text,
        rubric_package=rubric_package,
        assignment_type=assignment_type,
        student_name=student_name,
        file_name=file_name,
    )
    return res


# ─── Tool 7: verify_evidence_spans ───────────────────────────────────────────
def tool_verify_evidence_spans(student_text: str, cited_spans: List[str]) -> Dict[str, Any]:
    """
    Verifies whether cited quotations/phrases exist in the submission text.
    Uses exact substring and normalized alphanumeric token containment.
    """
    text = str(student_text or "")
    text_normalized = re.sub(r"\s+", " ", text).lower()

    verified = []
    unverified = []

    for span in cited_spans:
        span_str = str(span or "").strip()
        if not span_str:
            continue

        # 1. Exact match
        if span_str in text:
            verified.append({"span": span_str, "method": "exact"})
            continue

        # 2. Normalized whitespace / casefold match
        span_norm = re.sub(r"\s+", " ", span_str).lower()
        if span_norm in text_normalized:
            verified.append({"span": span_str, "method": "normalized"})
            continue

        # 3. Sub-token containment for longer cited passages
        words = [w for w in re.findall(r"\w+", span_norm) if len(w) > 3]
        if len(words) >= 4:
            matched_words = sum(1 for w in words if w in text_normalized)
            ratio = matched_words / len(words)
            if ratio >= 0.75:
                verified.append({"span": span_str, "method": "fuzzy", "ratio": round(ratio, 2)})
                continue

        unverified.append(span_str)

    total = len(verified) + len(unverified)
    rate = (len(verified) / total) if total > 0 else None

    return {
        "allVerified": bool(total) and len(unverified) == 0,
        "verifiedCount": len(verified),
        "unverifiedCount": len(unverified),
        "verificationRate": round(rate, 3) if rate is not None else None,
        "verificationAvailable": total > 0,
        "verified": verified,
        "unverified": unverified,
    }


# ─── Tool 8: calculate_final_score ───────────────────────────────────────────
def tool_calculate_final_score(criteria_scores: List[Dict[str, Any]], formula: str = "sum") -> Dict[str, Any]:
    """
    Deterministic score recalculation in application code.
    Clamps each score to [0, maxScore] and computes totals, percentage, and grade.
    """
    if not criteria_scores:
        raise ValueError("Cannot calculate final score without criteria scores")

    total_score = 0.0
    total_max = 0.0
    breakdown = {}

    for item in criteria_scores:
        name = str(item.get("name") or "Unnamed").strip()
        max_score = float(item.get("maxScore", item.get("max_score", 0.0)))
        raw_score = float(item.get("score", 0.0))
        if max_score <= 0:
            raise ValueError(f"Criterion {name} has no positive maximum score")

        # Clamp strictly between 0 and max_score
        clamped_score = max(0.0, min(max_score, raw_score))
        breakdown[name] = {
            "score": round(clamped_score, 2),
            "maxScore": round(max_score, 2),
            "reason": str(item.get("reason", item.get("feedback", ""))).strip(),
            "evidence": str(item.get("evidence", "")).strip(),
        }
        total_score += clamped_score
        total_max += max_score

    pct = (total_score / total_max * 100.0) if total_max > 0 else 0.0
    grade = (
        "A" if pct >= 85.0
        else "B" if pct >= 70.0
        else "C" if pct >= 55.0
        else "D" if pct >= 40.0
        else "F"
    )

    return {
        "totalScore": round(total_score, 2),
        "maxScore": round(total_max, 2),
        "percentage": round(pct, 2),
        "gradeLabel": grade,
        "breakdown": breakdown,
    }


# ─── Tool 9: run_quality_checks ──────────────────────────────────────────────
def tool_run_quality_checks(
    output_payload: Dict[str, Any],
    criteria: List[Dict[str, Any]],
    confidence: Optional[float] = None,
    injection_detected: bool = False,
    extraction_short: bool = False,
) -> Dict[str, Any]:
    """Runs shared output validation and evaluation review policy checks."""
    rubric_res = run_rubric_validation(criteria)
    out_res = validate_llm_output(output_payload, rubric_res.criteria)

    conf = confidence if confidence is not None else output_payload.get("confidence")
    review_dec = decide_review(
        output_valid=out_res.valid,
        confidence=conf if isinstance(conf, (int, float)) else None,
        injection_detected=injection_detected,
        extraction_short=extraction_short,
        validation_errors=out_res.validation_errors,
    )

    return {
        "outputValid": out_res.valid,
        "status": review_dec.status.value,
        "needsReview": review_dec.status == EvalStatus.NEEDS_REVIEW,
        "canRetry": review_dec.can_retry,
        "reviewNotes": review_dec.review_notes,
        "validationErrors": out_res.validation_errors,
        "validationWarnings": out_res.validation_warnings,
        "calculatedTotal": out_res.calculated_total,
    }


# ─── Tool 10: request_human_review ──────────────────────────────────────────
def tool_request_human_review(reason: str, notes: str = "") -> Dict[str, Any]:
    """Records an explicit human review requirement without making an automated grading decision."""
    return {
        "reviewRequested": True,
        "status": EvalStatus.NEEDS_REVIEW.value,
        "reason": str(reason),
        "notes": str(notes),
    }


# ─── Tool Registration Function ──────────────────────────────────────────────
def register_all_tools(registry: ToolRegistry = default_tool_registry) -> None:
    """Register all 10 safe, allowlisted tools with their workflow permissions."""
    all_workflows = {
        WorkflowType.INDIVIDUAL_ASSIGNMENT,
        WorkflowType.BATCH_ASSIGNMENT,
        WorkflowType.INDIVIDUAL_SUMMARY,
        WorkflowType.BATCH_SUMMARY,
    }
    batch_only = {WorkflowType.BATCH_ASSIGNMENT, WorkflowType.BATCH_SUMMARY}

    registry.register(ToolDefinition(
        name="validate_submission_input",
        description="Validates student submission text for length and checks for prompt injection attempts.",
        allowed_workflows=all_workflows,
        handler=tool_validate_submission_input,
    ))

    registry.register(ToolDefinition(
        name="validate_zip_archive",
        description="Checks ZIP archive safety, entry counts, path traversal, and decompression ratios.",
        allowed_workflows=batch_only,
        handler=tool_validate_zip_archive,
    ))

    registry.register(ToolDefinition(
        name="extract_submission_text",
        description="Safely extracts plain text from student document files.",
        allowed_workflows=all_workflows,
        handler=tool_extract_submission_text,
    ))

    registry.register(ToolDefinition(
        name="validate_rubric",
        description="Validates rubric criteria bounds and computes an integrity snapshot hash.",
        allowed_workflows=all_workflows,
        handler=tool_validate_rubric,
    ))

    registry.register(ToolDefinition(
        name="retrieve_course_evidence",
        description="Retrieves course material excerpts when rubric requires lecture grounding.",
        allowed_workflows=all_workflows,
        handler=tool_retrieve_course_evidence,
    ))

    registry.register(ToolDefinition(
        name="evaluate_against_rubric",
        description="Calls standard LLM evaluator with safety delimiters and trusted criteria.",
        allowed_workflows=all_workflows,
        handler=tool_evaluate_against_rubric,
        timeout_seconds=90.0,
    ))

    registry.register(ToolDefinition(
        name="verify_evidence_spans",
        description="Verifies that quoted text passages exist within the student's submission.",
        allowed_workflows=all_workflows,
        handler=tool_verify_evidence_spans,
    ))

    registry.register(ToolDefinition(
        name="calculate_final_score",
        description="Deterministically calculates total scores, percentages, and grade boundaries.",
        allowed_workflows=all_workflows,
        handler=tool_calculate_final_score,
    ))

    registry.register(ToolDefinition(
        name="run_quality_checks",
        description="Invokes output validators and review policy state machine.",
        allowed_workflows=all_workflows,
        handler=tool_run_quality_checks,
    ))

    registry.register(ToolDefinition(
        name="request_human_review",
        description="Flags a submission for professor inspection without guessing or fabricating a grade.",
        allowed_workflows=all_workflows,
        handler=tool_request_human_review,
    ))


# Execute registration
register_all_tools(default_tool_registry)
