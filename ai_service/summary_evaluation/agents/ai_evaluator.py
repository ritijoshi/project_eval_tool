import json
import os
import re
from typing import Dict, Any, List, Tuple, Optional

from langchain_groq import ChatGroq
from langchain_core.prompts import PromptTemplate
from tenacity import retry, wait_exponential, stop_after_attempt

from summary_evaluation.services.embedding_service import get_embedder, cosine_similarity

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
        "conceptUnderstanding": {"score": similarity_score, "reason": "Semantic similarity to the lecture transcript."},
        "clarityReadability": {"score": clarity_score, "reason": "Sentence length and readability heuristics."},
        "technicalAccuracy": {"score": similarity_score, "reason": "Proxy using transcript similarity."},
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
    core_concepts: List[str],
    summary_vec: List[float],
    embedder,
    threshold: float = 0.62
) -> Tuple[List[str], List[str], float]:
    if not core_concepts:
        return [], [], 0.0
    hits: List[str] = []
    misses: List[str] = []
    for concept in core_concepts:
        concept = str(concept or "").strip()
        if not concept:
            continue
        c_vec = embedder.embed_query(concept)
        sim = cosine_similarity(summary_vec, c_vec)
        if sim >= threshold:
            hits.append(concept)
        else:
            misses.append(concept)
    total = max(1, len(hits) + len(misses))
    return hits, misses, len(hits) / total


def _build_deterministic_evaluation(
    student_summary: str,
    transcript_text: str,
    core_concepts: List[str],
    transcript_vecs: Optional[List[List[float]]] = None
) -> Dict[str, Any]:
    if not student_summary.strip() or not transcript_text.strip():
        return _build_fallback_evaluation(student_summary, {}, core_concepts)

    embedder = get_embedder()
    summary_vec = embedder.embed_query(student_summary)

    if transcript_vecs is None:
        transcript_chunks = _chunk_text(transcript_text)
        transcript_vecs = embedder.embed_documents(transcript_chunks) if transcript_chunks else []

    similarity = 0.0
    if transcript_vecs:
        similarity = max(cosine_similarity(summary_vec, t_vec) for t_vec in transcript_vecs)

    transcript_keywords = _extract_keywords(transcript_text)
    summary_keywords = _extract_keywords(student_summary)
    keyword_overlap = len(set(transcript_keywords) & set(summary_keywords))
    keyword_overlap_ratio = keyword_overlap / max(1, len(set(transcript_keywords)))

    concept_hits, concept_misses, semantic_concept_ratio = _semantic_concept_coverage(
        core_concepts,
        summary_vec,
        embedder
    )

    missing_key_points = concept_misses[:6]
    concepts_covered = concept_hits[:6]

    off_topic = [k for k in summary_keywords if k not in transcript_keywords][:6]

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
            "reason": f"Matched {keyword_overlap} of {len(set(transcript_keywords))} transcript keywords."
        },
        "conceptUnderstanding": {
            "score": round(concept_understanding, 1),
            "reason": "Semantic similarity against transcript content."
        },
        "clarityReadability": {
            "score": round(clarity_score, 1),
            "reason": f"Avg sentence length supports readability (word count: {word_count})."
        },
        "technicalAccuracy": {
            "score": round(technical_accuracy, 1),
            "reason": "Adjusted by off-topic keyword drift and transcript similarity."
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
            "reason": "Keyword overlap with transcript topics."
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
        weak_areas.append("Missing important concepts from the transcript.")
    if technical_accuracy < 6.0:
        weak_areas.append("Some explanations drift from transcript content.")
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
        "summaryInsights": "Deterministic comparison against transcript and core concepts.",
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


def _select_relevant_transcript_chunks(
    transcript_chunks: List[str],
    summary_text: str,
    top_k: int = 4,
    transcript_vecs: Optional[List[List[float]]] = None
) -> List[str]:
    if not transcript_chunks or not summary_text.strip():
        return []
    embedder = get_embedder()
    summary_vec = embedder.embed_query(summary_text)
    scored: List[Tuple[float, str]] = []
    for idx, chunk in enumerate(transcript_chunks):
        if not chunk.strip():
            continue
        if transcript_vecs and idx < len(transcript_vecs):
            c_vec = transcript_vecs[idx]
        else:
            c_vec = embedder.embed_query(chunk)
        scored.append((cosine_similarity(summary_vec, c_vec), chunk))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [c for _, c in scored[:top_k]]


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
    transcript_text: str,
    core_concepts: List[str],
    deterministic_metrics: Dict[str, float],
    transcript_vecs: Optional[List[List[float]]] = None,
    transcript_chunks: Optional[List[str]] = None
) -> Dict[str, Any]:
    if not student_summary.strip():
        return _build_fallback_evaluation(student_summary, deterministic_metrics, core_concepts)

    deterministic_eval = _build_deterministic_evaluation(
        student_summary=student_summary,
        transcript_text=transcript_text,
        core_concepts=core_concepts,
        transcript_vecs=transcript_vecs
    )

    if not _groq_enabled():
        _log_llm_event("DISABLED", "GROQ_API_KEY missing or placeholder; using deterministic evaluation")
        return {
            "metrics": deterministic_eval["metrics"],
            "strengths": deterministic_eval.get("strengths", []),
            "weakAreas": deterministic_eval.get("weakAreas", []),
            "improvements": deterministic_eval.get("improvements", []),
            "summaryInsights": deterministic_eval.get("summaryInsights", ""),
            "missingKeyPoints": deterministic_eval.get("missingKeyPoints", []),
            "conceptsCovered": deterministic_eval.get("conceptsCovered", []),
            "fallback": True
        }

    llm = ChatGroq(
        model_name=os.environ.get("GROQ_MODEL", "llama3-8b-8192"),
        temperature=0.2,
        max_tokens=900
    )

    if transcript_chunks is None:
        transcript_chunks = _chunk_text(transcript_text)

    relevant_chunks = _select_relevant_transcript_chunks(
        transcript_chunks=transcript_chunks,
        summary_text=student_summary,
        top_k=4,
        transcript_vecs=transcript_vecs
    )

    prompt = PromptTemplate.from_template(
        "You are an academic evaluator. Compare the transcript excerpts with the student summary.\n"
        "Return ONLY valid JSON with the schema below.\n\n"
        "SCHEMA:\n"
        "{{\n"
        "  \"metrics\": {{\n"
        "    \"topicCoverage\": {{\"score\": 0-10, \"reason\": \"...\"}},\n"
        "    \"conceptUnderstanding\": {{\"score\": 0-10, \"reason\": \"...\"}},\n"
        "    \"clarityReadability\": {{\"score\": 0-10, \"reason\": \"...\"}},\n"
        "    \"technicalAccuracy\": {{\"score\": 0-10, \"reason\": \"...\"}},\n"
        "    \"completeness\": {{\"score\": 0-10, \"reason\": \"...\"}},\n"
        "    \"conciseness\": {{\"score\": 0-10, \"reason\": \"...\"}},\n"
        "    \"logicalFlow\": {{\"score\": 0-10, \"reason\": \"...\"}},\n"
        "    \"keywordMatch\": {{\"score\": 0-10, \"reason\": \"...\"}},\n"
        "    \"criticalThinkingDepth\": {{\"score\": 0-10, \"reason\": \"...\"}},\n"
        "    \"aiConfidence\": {{\"score\": 0-10, \"reason\": \"...\"}}\n"
        "  }},\n"
        "  \"strengths\": [\"...\"],\n"
        "  \"weakAreas\": [\"...\"],\n"
        "  \"improvements\": [\"...\"],\n"
        "  \"summaryInsights\": \"...\",\n"
        "  \"missingKeyPoints\": [\"...\"],\n"
        "  \"conceptsCovered\": [\"...\"]\n"
        "}}\n\n"
        "RULES:\n"
        "- Base scores on semantic comparison between transcript and summary.\n"
        "- Reference specific concepts and note omissions or misunderstandings.\n"
        "- If you cite missing concepts, include them in missingKeyPoints verbatim.\n"
        "- If you cite covered concepts, include them in conceptsCovered verbatim.\n"
        "- Provide 2-4 items per list.\n"
        "- Do not return markdown or extra text.\n\n"
        "CORE CONCEPTS: {concepts}\n\n"
        "TRANSCRIPT EXCERPTS:\n{transcript}\n\n"
        "STUDENT SUMMARY:\n{summary}\n\n"
        "DETERMINISTIC SIGNALS (for calibration only):\n{signals}\n"
    )

    try:
        prompt_payload = {
            "concepts": ", ".join(core_concepts[:10]),
            "transcript": "\n---\n".join(relevant_chunks)[:3500],
            "summary": student_summary[:2200],
            "signals": json.dumps(deterministic_metrics, ensure_ascii=True)
        }
        _log_llm_event("PROMPT", _truncate(json.dumps(prompt_payload, ensure_ascii=True)))
        chain = prompt | llm
        response = chain.invoke(prompt_payload)
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
        strengths = deterministic_eval.get("strengths", [])
        weak_areas = deterministic_eval.get("weakAreas", [])
        improvements = deterministic_eval.get("improvements", [])
        summary_insights = deterministic_eval.get("summaryInsights", "")
        merged_metrics = deterministic_eval["metrics"]
        overall_score = deterministic_eval.get("overallScore", 0.0)
        breakdown = deterministic_eval.get("scoreBreakdown", [])
        explanation = deterministic_eval.get("scoreExplanation", "")
        missing_key_points = deterministic_eval.get("missingKeyPoints", [])
        concepts_covered = deterministic_eval.get("conceptsCovered", [])

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
        "fallback": False
    }
