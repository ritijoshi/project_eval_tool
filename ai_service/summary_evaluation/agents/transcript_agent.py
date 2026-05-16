import json
import os
import re
from typing import Any, Dict, List, Optional

from langchain_core.prompts import PromptTemplate
from langchain_groq import ChatGroq
from tenacity import retry, wait_exponential, stop_after_attempt

from summary_evaluation.services.groq_circuit import GroqCircuitBreaker, should_trip_circuit

_CONDENSATION_SCHEMA = """
{{
  "reference_summary": "A complete ideal lecture summary (200-450 words) covering all major points.",
  "main_topics": ["topic 1", "topic 2"],
  "core_concepts": ["concept 1", "concept 2"],
  "important_keywords": ["keyword 1", "keyword 2"],
  "learning_objectives": ["objective 1", "objective 2"],
  "expected_insights": ["insight 1", "insight 2"]
}}
"""

_EMPTY_REFERENCE: Dict[str, Any] = {
    "reference_summary": "",
    "main_topics": [],
    "core_concepts": [],
    "important_keywords": [],
    "learning_objectives": [],
    "expected_insights": [],
    "important_terms": [],
    "examples_discussed": [],
}


def _groq_enabled() -> bool:
    groq_key = os.environ.get("GROQ_API_KEY")
    return bool(groq_key) and groq_key != "gsk-placeholder"


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


def _prepare_transcript_for_condensation(text: str, max_chars: int = 18000) -> str:
    """Preserve intro and conclusion when the transcript exceeds context limits."""
    if len(text) <= max_chars:
        return text
    head_len = int(max_chars * 0.65)
    tail_len = max_chars - head_len - 60
    return (
        text[:head_len]
        + "\n\n[... middle section omitted for length; focus on the surrounding content ...]\n\n"
        + text[-tail_len:]
    )


def _normalize_reference_package(payload: Dict[str, Any], parsed_text: str) -> Dict[str, Any]:
    reference_summary = str(payload.get("reference_summary", "")).strip()
    main_topics = [str(x).strip() for x in payload.get("main_topics", []) if str(x).strip()]
    core_concepts = [str(x).strip() for x in payload.get("core_concepts", []) if str(x).strip()]
    important_keywords = [
        str(x).strip() for x in payload.get("important_keywords", payload.get("important_terms", []))
        if str(x).strip()
    ]
    learning_objectives = [
        str(x).strip() for x in payload.get("learning_objectives", []) if str(x).strip()
    ]
    expected_insights = [
        str(x).strip() for x in payload.get("expected_insights", payload.get("examples_discussed", []))
        if str(x).strip()
    ]

    if not reference_summary and parsed_text:
        reference_summary = parsed_text[:1200].strip()

    if not core_concepts:
        core_concepts = main_topics[:8] or ["Lecture Content"]

    return {
        "reference_summary": reference_summary,
        "main_topics": main_topics,
        "core_concepts": core_concepts,
        "important_keywords": important_keywords,
        "learning_objectives": learning_objectives,
        "expected_insights": expected_insights,
        "important_terms": important_keywords,
        "examples_discussed": expected_insights,
    }


def _heuristic_reference_package(parsed_text: str) -> Dict[str, Any]:
    """Deterministic fallback when Groq condensation is unavailable or fails."""
    words = re.findall(r"[A-Za-z0-9\-]+", parsed_text.lower())
    freq: Dict[str, int] = {}
    stop = {
        "the", "a", "an", "and", "or", "but", "to", "of", "in", "on", "for", "with", "as", "by",
        "is", "are", "was", "were", "be", "been", "this", "that", "it", "we", "you", "they",
    }
    for word in words:
        if len(word) < 4 or word in stop:
            continue
        freq[word] = freq.get(word, 0) + 1
    keywords = [w for w, _ in sorted(freq.items(), key=lambda item: item[1], reverse=True)[:12]]

    excerpt = parsed_text[:1200].strip() if parsed_text else ""
    return _normalize_reference_package(
        {
            "reference_summary": excerpt,
            "main_topics": keywords[:6],
            "core_concepts": keywords[:8] or ["Lecture Content"],
            "important_keywords": keywords,
            "learning_objectives": [],
            "expected_insights": [],
        },
        parsed_text,
    )


@retry(wait=wait_exponential(multiplier=2, min=2, max=10), stop=stop_after_attempt(3))
def condense_transcript(
    parsed_text: str,
    circuit_breaker: Optional[GroqCircuitBreaker] = None,
) -> Dict[str, Any]:
    """
    Stage 1: Convert raw transcript/course material into a stable reference package
    used for all student evaluations in the session.
    """
    if not parsed_text or not parsed_text.strip():
        return dict(_EMPTY_REFERENCE)

    if not _groq_enabled():
        print("[TRANSCRIPT_CONDENSE] Groq disabled; using heuristic reference package.")
        package = _heuristic_reference_package(parsed_text)
        package["condensation_fallback"] = True
        return package

    if circuit_breaker and circuit_breaker.is_open:
        print("[TRANSCRIPT_CONDENSE] Circuit open; using heuristic reference package.")
        package = _heuristic_reference_package(parsed_text)
        package["condensation_fallback"] = True
        return package

    try:
        llm = ChatGroq(
            model_name=os.environ.get("GROQ_MODEL", "llama-3.1-8b-instant"),
            temperature=0.1,
            max_tokens=int(os.environ.get("GROQ_CONDENSE_MAX_OUTPUT_TOKENS", "700")),
        )

        prompt = PromptTemplate.from_template(
            "You are an expert instructional designer. Read the lecture transcript below and "
            "produce a stable reference package for evaluating student summaries.\n"
            "Return ONLY valid raw JSON matching this structure EXACTLY:\n"
            f"{_CONDENSATION_SCHEMA}\n"
            "RULES:\n"
            "- reference_summary must be factual, comprehensive, and derived only from the transcript.\n"
            "- Do not invent topics, terms, or objectives absent from the transcript.\n"
            "- Keep lists concise (4-10 items each) and specific.\n"
            "- Do NOT wrap the JSON in markdown code fences.\n\n"
            "TRANSCRIPT:\n{transcript}\n"
        )

        max_chars = int(os.environ.get("GROQ_CONDENSE_MAX_CHARS", "10000"))
        safe_transcript = _prepare_transcript_for_condensation(parsed_text, max_chars=max_chars)
        chain = prompt | llm
        response = chain.invoke({"transcript": safe_transcript})
        content = str(getattr(response, "content", "")).replace("```json", "").replace("```", "").strip()
        payload = _safe_json_extract(content)
        package = _normalize_reference_package(payload, parsed_text)
        package["condensation_fallback"] = False
        print(
            f"[TRANSCRIPT_CONDENSE] OK | summary_len={len(package['reference_summary'])} "
            f"| concepts={len(package['core_concepts'])} | keywords={len(package['important_keywords'])}"
        )
        return package

    except Exception as exc:
        print(f"[TRANSCRIPT_CONDENSE] Failure: {exc}")
        if circuit_breaker and should_trip_circuit(exc):
            circuit_breaker.trip(str(exc))
        package = _heuristic_reference_package(parsed_text)
        package["condensation_fallback"] = True
        return package


def run_transcript_agent(parsed_text: str) -> Dict[str, Any]:
    """Backward-compatible alias for Stage 1 condensation."""
    return condense_transcript(parsed_text)
