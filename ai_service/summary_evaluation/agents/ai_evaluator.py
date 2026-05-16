import json
import os
import re
from typing import Dict, Any, List, Tuple, Optional

import numpy as np

from langchain_groq import ChatGroq
from langchain_core.prompts import PromptTemplate
from tenacity import retry, wait_exponential, stop_after_attempt

from summary_evaluation.services.embedding_service import (
    get_embedder,
    cosine_similarity,
    compute_concept_coverage_score,
)
from summary_evaluation.services.groq_circuit import (
    GroqCircuitBreaker,
    is_request_too_large_error,
    should_trip_circuit,
)

_STOPWORDS = {
    "the", "a", "an", "and", "or", "but", "if", "then", "to", "of", "in", "on", "for",
    "with", "as", "by", "at", "from", "is", "are", "was", "were", "be", "been", "being",
    "this", "that", "these", "those", "it", "its", "into", "over", "under", "about",
    "we", "they", "their", "our", "you", "your", "he", "she", "his", "her",
    "can", "could", "should", "would", "may", "might", "will", "shall", "do", "does", "did"
}

_OVERALL_SCORE_WEIGHTS = {
    "topicCoverage": 0.18,
    "conceptUnderstanding": 0.18,
    "technicalAccuracy": 0.15,
    "completeness": 0.12,
    "clarityReadability": 0.10,
    "logicalFlow": 0.08,
    "criticalThinkingDepth": 0.08,
    "keywordMatch": 0.05,
    "conciseness": 0.03,
    "aiConfidence": 0.03,
}


def _clamp(value: float, low: float = 0.0, high: float = 10.0) -> float:
    return max(low, min(high, value))


def _safe_json_extract(raw_text: str) -> Dict[str, Any]:
    if not raw_text:
        raise ValueError("Empty LLM response")

    try:
        return json.loads(raw_text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", raw_text, flags=re.DOTALL)
        if not match:
            raise
        return json.loads(match.group(0))


def _normalize_metric(metric: Dict[str, Any]) -> Dict[str, Any]:
    score = metric.get("score", 0)
    try:
        score = float(score)
    except (TypeError, ValueError):
        score = 0.0
    return {
        "score": round(_clamp(score), 1),
        "reason": str(metric.get("reason", "")).strip()
    }


def _compute_weighted_overall(metrics: Dict[str, Any]) -> Tuple[float, List[Dict[str, Any]], str]:
    breakdown: List[Dict[str, Any]] = []
    weighted_sum = 0.0
    total_weight = 0.0

    for metric_key, weight in _OVERALL_SCORE_WEIGHTS.items():
        metric = metrics.get(metric_key) if isinstance(metrics, dict) else None
        score = None
        if isinstance(metric, dict):
            score = metric.get("score")
        if score is None:
            continue
        try:
            score_value = float(score)
        except (TypeError, ValueError):
            continue
        score_value = _clamp(score_value)
        weighted = score_value * weight
        weighted_sum += weighted
        total_weight += weight
        breakdown.append({
            "metric": metric_key,
            "score": round(score_value, 1),
            "weight": round(weight, 3),
            "weightedScore": round(weighted, 3),
        })

    if total_weight <= 0:
        return 0.0, [], "No valid metrics available for overall score."

    overall = _clamp(weighted_sum / total_weight)
    breakdown.sort(key=lambda item: item["weightedScore"], reverse=True)
    top = breakdown[:3]
    influences = ", ".join(
        f"{item['metric']} ({item['weightedScore']:.2f})" for item in top
    )
    explanation = f"Top influences: {influences}."
    return round(overall, 1), breakdown, explanation


def _log_llm_event(event: str, detail: str) -> None:
    print(f"[LLM_EVAL] {event}: {detail}")


def _truncate(text: str, max_len: int = 900) -> str:
    if not text:
        return ""
    text = text.replace("\n", " ").strip()
    if len(text) <= max_len:
        return text
    return text[:max_len].rstrip() + "..."


def _groq_enabled() -> bool:
    groq_key = os.environ.get("GROQ_API_KEY")
    return bool(groq_key) and groq_key != "gsk-placeholder"


def _heuristic_clarity(text: str) -> float:
    sentences = [s.strip() for s in re.split(r"[.!?]", text) if s.strip()]
    if not sentences:
        return 0.0
    avg_words = sum(len(s.split()) for s in sentences) / len(sentences)
    if avg_words <= 18:
        return 8.5
    if avg_words <= 25:
        return 7.0
    if avg_words <= 35:
        return 5.5
    return 4.0


def _heuristic_flow(text: str) -> float:
    connectors = ["therefore", "however", "because", "thus", "first", "second", "finally", "in summary"]
    hits = sum(1 for c in connectors if c in text.lower())
    return _clamp(4.0 + hits * 1.0)


def _heuristic_conciseness(word_count: int) -> float:
    if 150 <= word_count <= 450:
        return 8.5
    if word_count < 150:
        return _clamp(4.0 + (word_count / 150.0) * 4.0)
    return _clamp(7.0 - ((word_count - 450) / 300.0) * 3.0)


def _reference_keywords(reference_package: Dict[str, Any]) -> List[str]:
    keywords = reference_package.get("important_keywords") or reference_package.get("important_terms") or []
    topics = reference_package.get("main_topics") or []
    return [str(k).strip() for k in list(keywords) + list(topics) if str(k).strip()]


def _build_fallback_evaluation(
    student_summary: str,
    deterministic_metrics: Dict[str, float],
    core_concepts: List[str]
) -> Dict[str, Any]:
    word_count = len(student_summary.split())
    coverage_score = _clamp(deterministic_metrics.get("coverage", 0.0) * 10.0)
    similarity_score = _clamp(deterministic_metrics.get("similarity", 0.0) * 10.0)
    completeness_score = _clamp(deterministic_metrics.get("completeness", 0.0) * 10.0)

    clarity_score = _heuristic_clarity(student_summary)
    flow_score = _heuristic_flow(student_summary)
    conciseness_score = _heuristic_conciseness(word_count)
    critical_score = _clamp(3.5 + (flow_score / 10.0) * 4.0)
    confidence_score = _clamp((coverage_score + similarity_score + completeness_score) / 3.0)

    metrics = {
        "topicCoverage": {"score": coverage_score, "reason": "Based on overlap with core lecture concepts."},
        "conceptUnderstanding": {"score": similarity_score, "reason": "Semantic similarity to the AI reference summary."},
        "clarityReadability": {"score": clarity_score, "reason": "Sentence length and readability heuristics."},
        "technicalAccuracy": {"score": similarity_score, "reason": "Proxy using reference-summary similarity."},
        "completeness": {"score": completeness_score, "reason": "Length-based completeness heuristic."},
        "conciseness": {"score": conciseness_score, "reason": "Word count compared to ideal summary length."},
        "logicalFlow": {"score": flow_score, "reason": "Connector usage and structure signals."},
        "keywordMatch": {"score": coverage_score, "reason": "Matched against expected core concepts."},
        "criticalThinkingDepth": {"score": critical_score, "reason": "Limited evidence of analysis connectors."},
        "aiConfidence": {"score": confidence_score, "reason": "Confidence derived from deterministic signals."}
    }

    overall_score, breakdown, explanation = _compute_weighted_overall(metrics)

    strengths = []
    weak_areas = []
    improvements = []

    if coverage_score >= 7.0:
        strengths.append("Covers several core lecture topics.")
    if clarity_score >= 7.0:
        strengths.append("Readable and reasonably structured.")
    if completeness_score < 6.0:
        weak_areas.append("Summary is shorter than expected for full coverage.")
        improvements.append("Expand coverage with more key points from the lecture.")
    if coverage_score < 6.0:
        weak_areas.append("Missing multiple core concepts.")
        if core_concepts:
            improvements.append(f"Explicitly mention: {', '.join(core_concepts[:3])}.")
    if not strengths:
        strengths.append("Touches on some lecture content but needs refinement.")
    if not weak_areas:
        weak_areas.append("No critical weaknesses detected by fallback heuristics.")
    if not improvements:
        improvements.append("Add clearer structure and more precise explanations.")

    return {
        "metrics": metrics,
        "strengths": strengths[:4],
        "weakAreas": weak_areas[:4],
        "improvements": improvements[:4],
        "summaryInsights": "Fallback evaluation generated from deterministic signals.",
        "missingKeyPoints": core_concepts[:4] if coverage_score < 6.0 else [],
        "conceptsCovered": core_concepts[:4] if coverage_score >= 6.0 else [],
        "overallScore": overall_score,
        "scoreBreakdown": breakdown,
        "scoreExplanation": explanation,
        "fallback": True
    }


def _tokenize(text: str) -> List[str]:
    tokens = re.findall(r"[A-Za-z0-9\-]+", text.lower())
    return [t for t in tokens if t not in _STOPWORDS and len(t) > 2]


def _extract_keywords(text: str, top_n: int = 14) -> List[str]:
    tokens = _tokenize(text)
    freq: Dict[str, int] = {}
    for token in tokens:
        freq[token] = freq.get(token, 0) + 1
    ranked = sorted(freq.items(), key=lambda item: item[1], reverse=True)
    return [token for token, _ in ranked[:top_n]]


def _chunk_text(text: str, chunk_size: int = 800, overlap: int = 150) -> List[str]:
    if not text:
        return []
    chunks = []
    step = max(1, chunk_size - overlap)
    for start in range(0, len(text), step):
        chunk = text[start:start + chunk_size]
        if chunk.strip():
            chunks.append(chunk)
    return chunks


def _critical_thinking_score(text: str) -> float:
    cues = [
        "because", "therefore", "however", "in contrast", "as a result", "this implies",
        "consequently", "on the other hand", "in summary", "for example", "this suggests"
    ]
    lower = text.lower()
    hits = sum(1 for cue in cues if cue in lower)
    return _clamp(3.0 + hits * 1.2)


def _semantic_concept_coverage(
    student_summary: str,
    core_concepts: List[str],
    summary_vec: List[float],
    embedder,
) -> Tuple[List[str], List[str], float]:
    labels = [str(c).strip() for c in core_concepts if str(c).strip()]
    if not labels:
        return [], [], 0.0
    concept_vecs = embedder.embed_documents(labels)
    ratio, hits, misses = compute_concept_coverage_score(
        student_summary,
        concept_vecs,
        concept_labels=labels,
        student_vec=summary_vec,
    )
    return hits, misses, ratio


def _build_deterministic_evaluation(
    student_summary: str,
    reference_package: Dict[str, Any],
    core_concepts: List[str],
    reference_vecs: Optional[List[List[float]]] = None,
) -> Dict[str, Any]:
    reference_summary = str(reference_package.get("reference_summary", "")).strip()
    if not student_summary.strip() or not reference_summary:
        return _build_fallback_evaluation(student_summary, {}, core_concepts)

    embedder = get_embedder()
    summary_vec = embedder.embed_query(student_summary)

    if reference_vecs is None:
        reference_chunks = _chunk_text(reference_summary, chunk_size=500, overlap=80)
        reference_vecs = embedder.embed_documents(reference_chunks) if reference_chunks else []

    similarity = 0.0
    if reference_vecs:
        similarity = max(cosine_similarity(summary_vec, ref_vec) for ref_vec in reference_vecs)

    reference_keywords = _reference_keywords(reference_package)
    if not reference_keywords:
        reference_keywords = _extract_keywords(reference_summary)
    summary_keywords = _extract_keywords(student_summary)
    keyword_overlap = len(set(reference_keywords) & set(summary_keywords))
    keyword_overlap_ratio = keyword_overlap / max(1, len(set(reference_keywords)))

    concept_hits, concept_misses, semantic_concept_ratio = _semantic_concept_coverage(
        student_summary,
        core_concepts,
        summary_vec,
        embedder,
    )

    missing_key_points = concept_misses[:6]
    concepts_covered = concept_hits[:6]

    off_topic = [k for k in summary_keywords if k not in reference_keywords][:6]

    word_count = len(student_summary.split())
    clarity_score = _heuristic_clarity(student_summary)
    flow_score = _heuristic_flow(student_summary)
    conciseness_score = _heuristic_conciseness(word_count)
    critical_score = _critical_thinking_score(student_summary)

    topic_coverage = _clamp(((keyword_overlap_ratio * 0.4) + (semantic_concept_ratio * 0.6)) * 10.0)
    concept_understanding = _clamp(similarity * 10.0)
    completeness_score = _clamp(min(10.0, max(3.0, (word_count / 180.0) * 10.0)))
    off_topic_ratio = len(off_topic) / max(1, len(summary_keywords))
    technical_accuracy = _clamp((similarity * 10.0) - (off_topic_ratio * 4.0))
    keyword_match = _clamp(keyword_overlap_ratio * 10.0)
    confidence = _clamp((topic_coverage + concept_understanding + clarity_score + completeness_score) / 4.0)

    metrics = {
        "topicCoverage": {
            "score": round(topic_coverage, 1),
            "reason": (
                f"Concept coverage {semantic_concept_ratio:.0%} "
                f"({len(concept_hits)}/{max(1, len(concept_hits) + len(concept_misses))} topics)."
            )
        },
        "conceptUnderstanding": {
            "score": round(concept_understanding, 1),
            "reason": "Semantic similarity against the AI reference summary."
        },
        "clarityReadability": {
            "score": round(clarity_score, 1),
            "reason": f"Avg sentence length supports readability (word count: {word_count})."
        },
        "technicalAccuracy": {
            "score": round(technical_accuracy, 1),
            "reason": "Adjusted by off-topic keyword drift and reference-summary similarity."
        },
        "completeness": {
            "score": round(completeness_score, 1),
            "reason": "Estimated coverage based on summary length and detail density."
        },
        "conciseness": {
            "score": round(conciseness_score, 1),
            "reason": "Compared summary length to ideal concise range."
        },
        "logicalFlow": {
            "score": round(flow_score, 1),
            "reason": "Detected connective phrases that indicate structure."
        },
        "keywordMatch": {
            "score": round(keyword_match, 1),
            "reason": "Keyword overlap with reference topics and terms."
        },
        "criticalThinkingDepth": {
            "score": round(critical_score, 1),
            "reason": "Presence of reasoning cues and analytical connectors."
        },
        "aiConfidence": {
            "score": round(confidence, 1),
            "reason": "Confidence derived from semantic and coverage signals."
        }
    }

    overall_score, breakdown, explanation = _compute_weighted_overall(metrics)

    strengths = []
    if topic_coverage >= 7.0:
        strengths.append("Covers most of the key lecture topics.")
    if concept_understanding >= 7.0:
        strengths.append("Captures the core ideas in a semantically aligned way.")
    if clarity_score >= 7.0:
        strengths.append("Readable and structured explanation.")

    weak_areas = []
    if missing_key_points:
        weak_areas.append("Missing important concepts from the reference summary.")
    if technical_accuracy < 6.0:
        weak_areas.append("Some explanations drift from the expected lecture content.")
    if conciseness_score < 6.0:
        weak_areas.append("Length is not optimal for a concise summary.")
    if off_topic:
        weak_areas.append(f"Includes off-topic terms: {', '.join(off_topic[:3])}.")

    improvements = []
    if missing_key_points:
        improvements.append(f"Add coverage for: {', '.join(missing_key_points[:3])}.")
    if off_topic:
        improvements.append("Remove off-topic details and focus on lecture concepts.")
    if clarity_score < 6.0:
        improvements.append("Use clearer sentence structure and transitions.")

    if not strengths:
        strengths.append("Includes some lecture-aligned points but needs refinement.")
    if not weak_areas:
        weak_areas.append("No major weaknesses detected in deterministic analysis.")
    if not improvements:
        improvements.append("Deepen explanations with more concrete lecture references.")

    return {
        "metrics": metrics,
        "strengths": strengths[:4],
        "weakAreas": weak_areas[:4],
        "improvements": improvements[:4],
        "summaryInsights": "Deterministic comparison against the AI reference summary and core concepts.",
        "missingKeyPoints": missing_key_points[:6],
        "conceptsCovered": concepts_covered[:6],
        "overallScore": overall_score,
        "scoreBreakdown": breakdown,
        "scoreExplanation": explanation,
        "fallback": False
    }


def fallback_evaluation(
    student_summary: str,
    deterministic_metrics: Dict[str, float],
    core_concepts: List[str]
) -> Dict[str, Any]:
    return _build_fallback_evaluation(student_summary, deterministic_metrics, core_concepts)


def format_qualitative_feedback(ai_evaluation: Dict[str, Any]) -> str:
    if not ai_evaluation:
        return ""

    summary = str(ai_evaluation.get("summaryInsights", "")).strip()
    strengths = ai_evaluation.get("strengths", [])
    weak_areas = ai_evaluation.get("weakAreas", [])
    improvements = ai_evaluation.get("improvements", [])

    sections = []
    if summary:
        sections.append(f"Summary: {summary}")
    if strengths:
        sections.append("Strengths: " + "; ".join(strengths))
    if weak_areas:
        sections.append("Weak Areas: " + "; ".join(weak_areas))
    if improvements:
        sections.append("Improvements: " + "; ".join(improvements))

    return "\n".join(sections).strip()


def _format_reference_context(
    reference_package: Dict[str, Any],
    max_summary_len: int = 900,
    *,
    compact: bool = False,
) -> str:
    summary = str(reference_package.get("reference_summary", "")).strip()[:max_summary_len]
    objectives = reference_package.get("learning_objectives") or []
    insights = reference_package.get("expected_insights") or []
    keywords = _reference_keywords(reference_package)

    if compact:
        parts = [summary]
        if objectives:
            parts.append("Objectives: " + "; ".join(str(o) for o in objectives[:4]))
        if keywords:
            parts.append("Keywords: " + ", ".join(keywords[:10]))
        return "\n".join(parts)

    sections = [f"REFERENCE:\n{summary}"]
    if objectives:
        sections.append("OBJECTIVES:\n- " + "\n- ".join(str(o) for o in objectives[:5]))
    if insights:
        sections.append("INSIGHTS:\n- " + "\n- ".join(str(i) for i in insights[:5]))
    if keywords:
        sections.append("KEYWORDS: " + ", ".join(keywords[:12]))
    return "\n\n".join(sections)


def _compact_deterministic_signals(metrics: Dict[str, float]) -> str:
    keys = ("similarity", "coverage", "completeness")
    slim = {k: round(float(metrics[k]), 3) for k in keys if k in metrics}
    return json.dumps(slim, ensure_ascii=True)


def _mean_vector(vectors: List[List[float]]) -> List[float]:
    if not vectors:
        return []
    return np.mean(np.array(vectors), axis=0).tolist()


def _select_relevant_excerpts(
    query_vec: List[float],
    chunks: List[str],
    chunk_vecs: Optional[List[List[float]]],
    *,
    top_k: int,
    max_chars: int,
    embedder=None,
) -> str:
    """Pick the highest-similarity chunks up to max_chars (deduped)."""
    if not chunks:
        return ""
    if not query_vec:
        return chunks[0][:max_chars]

    embedder = embedder or get_embedder()
    scored: List[Tuple[float, str]] = []
    for idx, chunk in enumerate(chunks):
        text = chunk.strip()
        if not text:
            continue
        if chunk_vecs and idx < len(chunk_vecs):
            vec = chunk_vecs[idx]
        else:
            vec = embedder.embed_query(text)
        scored.append((cosine_similarity(query_vec, vec), text))

    if not scored:
        return ""

    scored.sort(key=lambda item: item[0], reverse=True)
    selected: List[str] = []
    used = 0
    seen_prefixes = set()
    for _, chunk in scored:
        prefix = chunk[:64].lower()
        if prefix in seen_prefixes:
            continue
        seen_prefixes.add(prefix)
        separator = 4 if selected else 0
        if used + separator + len(chunk) > max_chars:
            remaining = max_chars - used - separator
            if remaining > 80:
                selected.append(chunk[:remaining].rstrip())
            break
        selected.append(chunk)
        used += separator + len(chunk)
        if len(selected) >= top_k:
            break

    if not selected:
        selected = [scored[0][1][:max_chars]]
    return "\n---\n".join(selected)


def _reference_metadata_block(reference_package: Dict[str, Any], *, compact: bool) -> str:
    objectives = reference_package.get("learning_objectives") or []
    insights = reference_package.get("expected_insights") or []
    keywords = _reference_keywords(reference_package)
    lines: List[str] = []
    if keywords:
        limit = 8 if compact else 12
        lines.append("KEYWORDS: " + ", ".join(keywords[:limit]))
    if objectives:
        limit = 3 if compact else 5
        lines.append("OBJECTIVES: " + "; ".join(str(o) for o in objectives[:limit]))
    if insights and not compact:
        lines.append("INSIGHTS: " + "; ".join(str(i) for i in insights[:4]))
    return "\n".join(lines)


def _build_relevant_eval_excerpts(
    student_summary: str,
    reference_package: Dict[str, Any],
    reference_vecs: Optional[List[List[float]]],
    reference_chunks: Optional[List[str]],
    *,
    ref_max_chars: int,
    sum_max_chars: int,
    compact: bool,
) -> Tuple[str, str]:
    """
    Build Groq prompt excerpts via embedding similarity (not head truncation).
    Reference chunks are scored against the full student summary; student chunks
    against the reference centroid.
    """
    embedder = get_embedder()
    reference_summary = str(reference_package.get("reference_summary", "")).strip()
    student_summary = student_summary.strip()

    if reference_chunks is None:
        chunk_size = 350 if compact else 450
        reference_chunks = _chunk_text(reference_summary, chunk_size=chunk_size, overlap=70)
    if reference_vecs is None and reference_chunks:
        reference_vecs = embedder.embed_documents(reference_chunks)

    student_chunk_size = 320 if compact else 400
    student_chunks = _chunk_text(student_summary, chunk_size=student_chunk_size, overlap=60)
    student_vecs = embedder.embed_documents(student_chunks) if len(student_chunks) > 1 else []

    student_vec = embedder.embed_query(student_summary)
    ref_centroid = _mean_vector(reference_vecs) if reference_vecs else student_vec

    ref_top_k = 2 if compact else int(os.environ.get("GROQ_EVAL_REF_TOP_K", "3"))
    sum_top_k = 2 if compact else int(os.environ.get("GROQ_EVAL_STUDENT_TOP_K", "3"))
    meta = _reference_metadata_block(reference_package, compact=compact)
    meta_budget = min(280 if compact else 380, ref_max_chars // 3)
    body_budget = max(200, ref_max_chars - meta_budget)

    if len(reference_summary) <= body_budget and len(reference_chunks) <= 1:
        ref_body = reference_summary
    else:
        ref_body = _select_relevant_excerpts(
            student_vec,
            reference_chunks or [reference_summary],
            reference_vecs,
            top_k=ref_top_k,
            max_chars=body_budget,
            embedder=embedder,
        )

    ref_parts = [p for p in (meta, f"REFERENCE EXCERPTS:\n{ref_body}" if ref_body else "") if p]
    reference_context = "\n\n".join(ref_parts)[:ref_max_chars]

    if len(student_summary) <= sum_max_chars and len(student_chunks) <= 1:
        student_excerpt = student_summary
    else:
        student_excerpt = _select_relevant_excerpts(
            ref_centroid,
            student_chunks or [student_summary],
            student_vecs if len(student_chunks) > 1 else None,
            top_k=sum_top_k,
            max_chars=sum_max_chars,
            embedder=embedder,
        )

    return reference_context, student_excerpt[:sum_max_chars]


def _build_student_eval_payload(
    student_summary: str,
    reference_package: Dict[str, Any],
    core_concepts: List[str],
    deterministic_metrics: Dict[str, float],
    reference_vecs: Optional[List[List[float]]] = None,
    reference_chunks: Optional[List[str]] = None,
    *,
    compact: bool = False,
) -> Dict[str, str]:
    ref_cap = 500 if compact else int(os.environ.get("GROQ_EVAL_REFERENCE_CHARS", "1100"))
    sum_cap = 450 if compact else int(os.environ.get("GROQ_EVAL_SUMMARY_CHARS", "900"))
    reference_context, student_excerpt = _build_relevant_eval_excerpts(
        student_summary,
        reference_package,
        reference_vecs,
        reference_chunks,
        ref_max_chars=ref_cap,
        sum_max_chars=sum_cap,
        compact=compact,
    )
    _log_llm_event(
        "EXCERPTS",
        f"ref_chars={len(reference_context)} student_chars={len(student_excerpt)} compact={compact}",
    )
    return {
        "concepts": ", ".join(core_concepts[:6 if compact else 8]),
        "reference": reference_context,
        "summary": student_excerpt,
        "signals": _compact_deterministic_signals(deterministic_metrics),
    }


_EVAL_PROMPT_COMPACT = (
    "Compare student summary to the reference. Return ONLY JSON:\n"
    '{{"metrics":{{"topicCoverage":{{"score":0-10,"reason":"..."}},'
    '"conceptUnderstanding":{{"score":0-10,"reason":"..."}},'
    '"clarityReadability":{{"score":0-10,"reason":"..."}},'
    '"technicalAccuracy":{{"score":0-10,"reason":"..."}},'
    '"completeness":{{"score":0-10,"reason":"..."}},'
    '"conciseness":{{"score":0-10,"reason":"..."}},'
    '"logicalFlow":{{"score":0-10,"reason":"..."}},'
    '"keywordMatch":{{"score":0-10,"reason":"..."}},'
    '"criticalThinkingDepth":{{"score":0-10,"reason":"..."}},'
    '"aiConfidence":{{"score":0-10,"reason":"..."}}}},'
    '"strengths":[],"weakAreas":[],"improvements":[],"summaryInsights":"...",'
    '"missingKeyPoints":[],"conceptsCovered":[]}}\n'
    "Use deterministic signals for calibration. Short reasons (max 12 words).\n"
    "CONCEPTS: {concepts}\nREFERENCE:\n{reference}\nSTUDENT:\n{summary}\nSIGNALS: {signals}\n"
)


def _deterministic_ai_result(
    deterministic_eval: Dict[str, Any],
    *,
    circuit_skipped: bool = False,
) -> Dict[str, Any]:
    result = {
        "metrics": deterministic_eval["metrics"],
        "strengths": deterministic_eval.get("strengths", []),
        "weakAreas": deterministic_eval.get("weakAreas", []),
        "improvements": deterministic_eval.get("improvements", []),
        "summaryInsights": deterministic_eval.get("summaryInsights", ""),
        "missingKeyPoints": deterministic_eval.get("missingKeyPoints", []),
        "conceptsCovered": deterministic_eval.get("conceptsCovered", []),
        "overallScore": deterministic_eval.get("overallScore", 0.0),
        "scoreBreakdown": deterministic_eval.get("scoreBreakdown", []),
        "scoreExplanation": deterministic_eval.get("scoreExplanation", ""),
        "fallback": True,
    }
    if circuit_skipped:
        result["groqCircuitSkipped"] = True
    return result


def _merge_metrics(
    llm_metrics: Dict[str, Any],
    deterministic_metrics: Dict[str, Any]
) -> Dict[str, Any]:
    merged: Dict[str, Any] = {}
    for key, value in (deterministic_metrics or {}).items():
        if isinstance(value, dict):
            merged[key] = _normalize_metric(value)
    for key, value in (llm_metrics or {}).items():
        if isinstance(value, dict):
            merged[key] = _normalize_metric(value)
    return merged


@retry(wait=wait_exponential(multiplier=2, min=2, max=10), stop=stop_after_attempt(3))
def evaluate_summary_with_ai(
    student_summary: str,
    reference_package: Dict[str, Any],
    core_concepts: List[str],
    deterministic_metrics: Dict[str, float],
    reference_vecs: Optional[List[List[float]]] = None,
    reference_chunks: Optional[List[str]] = None,
    circuit_breaker: Optional[GroqCircuitBreaker] = None,
) -> Dict[str, Any]:
    if not student_summary.strip():
        return _build_fallback_evaluation(student_summary, deterministic_metrics, core_concepts)

    deterministic_eval = _build_deterministic_evaluation(
        student_summary=student_summary,
        reference_package=reference_package,
        core_concepts=core_concepts,
        reference_vecs=reference_vecs,
    )

    if not _groq_enabled():
        _log_llm_event("DISABLED", "GROQ_API_KEY missing or placeholder; using deterministic evaluation")
        return _deterministic_ai_result(deterministic_eval)

    if circuit_breaker and circuit_breaker.should_skip_groq():
        _log_llm_event("CIRCUIT_OPEN", circuit_breaker.reason or "skipping Groq for remaining students")
        return _deterministic_ai_result(deterministic_eval, circuit_skipped=True)

    max_output = int(os.environ.get("GROQ_EVAL_MAX_OUTPUT_TOKENS", "500"))
    llm = ChatGroq(
        model_name=os.environ.get("GROQ_MODEL", "llama-3.1-8b-instant"),
        temperature=0.2,
        max_tokens=max_output,
    )

    prompt = PromptTemplate.from_template(_EVAL_PROMPT_COMPACT)

    def _invoke_groq(*, compact: bool = False):
        payload = _build_student_eval_payload(
            student_summary,
            reference_package,
            core_concepts,
            deterministic_metrics,
            reference_vecs=reference_vecs,
            reference_chunks=reference_chunks,
            compact=compact,
        )
        _log_llm_event("PROMPT", _truncate(json.dumps(payload, ensure_ascii=True)))
        chain = prompt | llm
        return chain.invoke(payload), payload

    try:
        response, _ = _invoke_groq(compact=False)
        _log_llm_event("RESPONSE", _truncate(getattr(response, "content", "")))

        payload = _safe_json_extract(response.content)
        strengths = payload.get("strengths", [])[:4]
        weak_areas = payload.get("weakAreas", [])[:4]
        improvements = payload.get("improvements", [])[:4]
        summary_insights = str(payload.get("summaryInsights", "")).strip()
        llm_metrics = payload.get("metrics", {})
        merged_metrics = _merge_metrics(llm_metrics, deterministic_eval["metrics"])
        overall_score, breakdown, explanation = _compute_weighted_overall(merged_metrics)
        missing_key_points = payload.get("missingKeyPoints", []) or deterministic_eval.get("missingKeyPoints", [])
        concepts_covered = payload.get("conceptsCovered", []) or deterministic_eval.get("conceptsCovered", [])
    except Exception as exc:
        _log_llm_event("ERROR", str(exc))
        if is_request_too_large_error(exc):
            _log_llm_event("RETRY", "request too large — retrying with compact payload")
            try:
                response, _ = _invoke_groq(compact=True)
                _log_llm_event("RESPONSE", _truncate(getattr(response, "content", "")))
                payload = _safe_json_extract(response.content)
                strengths = payload.get("strengths", [])[:4]
                weak_areas = payload.get("weakAreas", [])[:4]
                improvements = payload.get("improvements", [])[:4]
                summary_insights = str(payload.get("summaryInsights", "")).strip()
                llm_metrics = payload.get("metrics", {})
                merged_metrics = _merge_metrics(llm_metrics, deterministic_eval["metrics"])
                overall_score, breakdown, explanation = _compute_weighted_overall(merged_metrics)
                missing_key_points = payload.get("missingKeyPoints", []) or deterministic_eval.get("missingKeyPoints", [])
                concepts_covered = payload.get("conceptsCovered", []) or deterministic_eval.get("conceptsCovered", [])
            except Exception as retry_exc:
                _log_llm_event("ERROR", f"compact retry failed: {retry_exc}")
                if circuit_breaker and should_trip_circuit(retry_exc):
                    circuit_breaker.trip(str(retry_exc))
                return _deterministic_ai_result(deterministic_eval)
        else:
            if circuit_breaker and should_trip_circuit(exc):
                circuit_breaker.trip(str(exc))
            return _deterministic_ai_result(deterministic_eval)

    return {
        "metrics": merged_metrics,
        "strengths": strengths or deterministic_eval.get("strengths", []),
        "weakAreas": weak_areas or deterministic_eval.get("weakAreas", []),
        "improvements": improvements or deterministic_eval.get("improvements", []),
        "summaryInsights": summary_insights or deterministic_eval.get("summaryInsights", ""),
        "missingKeyPoints": missing_key_points,
        "conceptsCovered": concepts_covered,
        "overallScore": overall_score,
        "scoreBreakdown": breakdown,
        "scoreExplanation": explanation,
        "fallback": False,
    }
