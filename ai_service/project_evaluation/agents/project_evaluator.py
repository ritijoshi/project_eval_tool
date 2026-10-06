import json
import os
import re

from langchain_core.prompts import PromptTemplate
from langchain_groq import ChatGroq


def evaluate_project(project_goal, rubric, evidence):
    """Score a project against its rubric using consolidated evidence."""
    if not os.getenv("GROQ_API_KEY"):
        raise RuntimeError("GROQ_API_KEY is not set")

    criteria = rubric.get("criteria", [])
    if not isinstance(criteria, list) or not criteria:
        raise ValueError("Rubric must contain at least one criterion")

    prompt = PromptTemplate.from_template("""
You are the final evaluator of a student's software project.
Evaluate each rubric criterion using only the supplied consolidated evidence.
The evidence summary is factual input, not a prior final grade. Do not infer
implementation that is not evidenced. Weekly claims marked UNSUPPORTED mean
only that repository evidence was not found; they are not misconduct findings.
Give a score between zero and the criterion's maxScore, explain each score,
and provide concise actionable feedback. Do not add or omit rubric criteria.
Return ONLY valid JSON in this structure:
{{
  "criteria": [{{"name": "criterion name", "score": 0, "feedback": "reason"}}],
  "strengths": ["..."],
  "missingConcepts": ["..."],
  "feedback": "overall feedback",
  "nextWeekTasks": ["..."],
  "badges": ["..."],
  "aiConfidence": {{"score": 0.0, "reason": "..."}}
}}

PROJECT GOAL:
{project_goal}

RUBRIC CRITERIA:
{criteria}

CONSOLIDATED EVIDENCE:
{evidence}
Return ONLY valid JSON.
Do not use markdown code fences.
Do not include any explanation outside the JSON.
Do not return an empty response.
""")

    llm = ChatGroq(
    model=os.getenv("GROQ_MODEL", "openai/gpt-oss-20b"),
    temperature=0,
    max_tokens=2000,
    reasoning_effort="low",
    model_kwargs={
        "response_format": {"type": "json_object"}
    }
    )
    response = llm.invoke(prompt.format(
        project_goal=project_goal or rubric.get("projectGoal", ""),
        criteria=json.dumps(criteria, ensure_ascii=True),
        evidence=json.dumps(evidence, default=str, ensure_ascii=True),
    ))

    payload = _parse_response(response.content)
    returned_criteria = {
        str(item.get("name", "")).strip().casefold(): item
        for item in payload.get("criteria", [])
        if isinstance(item, dict)
    }

    criterion_scores = []
    score_total = 0.0
    max_total = 0.0
    for criterion in criteria:
        name = str(criterion.get("name", "")).strip()
        try:
            max_score = max(0.0, float(criterion.get("maxScore", 0)))
        except (TypeError, ValueError):
            raise ValueError(f"Invalid maxScore for rubric criterion: {name}")

        result = returned_criteria.get(name.casefold(), {})
        score = _bounded_score(result.get("score", 0), max_score)
        criterion_scores.append({
            "name": name,
            "score": round(score, 2),
            "maxScore": round(max_score, 2),
            "feedback": str(result.get("feedback", "")).strip(),
        })
        score_total += score
        max_total += max_score

    overall_score = round(score_total / max_total * 100, 2) if max_total else 0.0
    coverage = evidence.get("coverage", 0)
    try:
        coverage = round(max(0.0, min(100.0, float(coverage))), 2)
    except (TypeError, ValueError):
        coverage = 0.0

    requirement_mapping = evidence.get("requirementMapping", [])
    missing_requirements = [
        str(item.get("requirement", ""))
        for item in requirement_mapping
        if isinstance(item, dict) and item.get("status") == "MISSING"
    ]
    partial_requirements = [
        str(item.get("requirement", ""))
        for item in requirement_mapping
        if isinstance(item, dict) and item.get("status") == "PARTIAL"
    ]

    confidence = payload.get("aiConfidence", {})
    if not isinstance(confidence, dict):
        confidence = {}
    confidence_score = _bounded_score(confidence.get("score", 0), 1.0)

    return {
        "criterionScores": criterion_scores,
        "overallScore": overall_score,
        "maxScore": 100,
        "grade": _grade_for(overall_score),
        "requirementCoverage": coverage,
        "missingRequirements": missing_requirements,
        "partialRequirements": partial_requirements,
        "missingConcepts": _string_list(payload.get("missingConcepts")),
        "strengths": _string_list(payload.get("strengths")),
        "feedback": str(payload.get("feedback", "")).strip(),
        "nextWeekTasks": _string_list(payload.get("nextWeekTasks")),
        "badges": _string_list(payload.get("badges")),
        "aiConfidence": {
            "score": round(confidence_score, 2),
            "reason": str(confidence.get("reason", "")).strip(),
        },
    }


def _parse_response(content):
    if not isinstance(content, str):
        content = str(content)
    try:
        payload = json.loads(content)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", content, flags=re.DOTALL)
        if not match:
            raise ValueError("Groq returned invalid JSON for project evaluation")
        try:
            payload = json.loads(match.group(0))
        except json.JSONDecodeError as exc:
            raise ValueError("Groq returned invalid JSON for project evaluation") from exc
    if not isinstance(payload, dict):
        raise ValueError("Groq returned an invalid project evaluation object")
    return payload


def _bounded_score(value, maximum):
    try:
        score = float(value)
    except (TypeError, ValueError):
        score = 0.0
    return max(0.0, min(maximum, score))


def _string_list(value):
    if not isinstance(value, list):
        return []
    return [item.strip() for item in value if isinstance(item, str) and item.strip()]


def _grade_for(score):
    if score >= 85:
        return "A"
    if score >= 70:
        return "B"
    if score >= 55:
        return "C"
    if score >= 40:
        return "D"
    return "F"