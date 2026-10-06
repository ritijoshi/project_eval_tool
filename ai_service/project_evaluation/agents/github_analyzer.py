import os
import json

from langchain_groq import ChatGroq
from langchain_core.prompts import PromptTemplate


def analyze_github_repo(repo_data, rubric):
    if not os.getenv("GROQ_API_KEY"):
        raise RuntimeError("GROQ_API_KEY is not set")

    llm = ChatGroq(
    model=os.getenv("GROQ_MODEL", "openai/gpt-oss-20b"),
    temperature=0,
    max_tokens=1000,
    reasoning_effort="low",
    model_kwargs={
        "response_format": {"type": "json_object"}
    }
    )

    all_results = []

    for criterion in rubric.get("criteria", []):

        criterion_name = criterion.get("name", "")
        requirements = criterion.get("requirements", [])

        prompt = PromptTemplate.from_template("""
You are a strict software project evaluator.

Evaluate ONLY this criterion.

Criterion:
{criterion}

Requirements:
{requirements}

Repository evidence:
{repo_data}

Rules:
- Evaluate every requirement.
- COMPLETE only with clear evidence.
- PARTIAL when implementation is incomplete.
- MISSING when there is no evidence.
- Do not assume something exists just because of a filename.
- Keep evidence and reason SHORT.

Return ONLY valid JSON.
Do not return an empty response.
Do not include markdown fences.
Do not include reasoning outside the JSON.

{{
    "criterion": "{criterion_name}",
    "requirements": [
        {{
            "requirement": "requirement text",
            "status": "COMPLETE",
            "evidence": "short specific evidence",
            "reason": "short reason"
        }}
    ]
}}
""")

        response = llm.invoke(
            prompt.format(
                criterion=criterion_name,
                requirements=json.dumps(requirements),
                repo_data=json.dumps(repo_data, default=str),
                criterion_name=criterion_name
            )
        )

        content = response.content.strip()

        try:
            result = json.loads(content)
        except json.JSONDecodeError:
            raise ValueError(
                f"Groq returned invalid JSON for criterion "
                f"'{criterion_name}':\n{content}"
            )

        for item in result.get("requirements", []):
            all_results.append({
                "criterion": criterion_name,
                "requirement": item.get("requirement"),
                "status": item.get("status"),
                "evidence": item.get("evidence"),
                "reason": item.get("reason")
            })

    return {
        "requirementMapping": all_results,
        "techStack": [
            lang for lang in repo_data.get("languages", {}).keys()
            if lang.lower() not in {"url", "string", "unknown", "none"}
        ],
        "testsPresent": repo_data.get("has_tests", False),
        "documentationPresent": bool(repo_data.get("readme")),
        "overallRepositoryQuality": "MEDIUM"
    }
        