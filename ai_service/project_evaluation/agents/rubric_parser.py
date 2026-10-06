import os
import json

from langchain_groq import ChatGroq
from langchain_core.prompts import PromptTemplate


def parse_rubric(rubric_text, project_goal):
    api_key = os.getenv("GROQ_API_KEY")

    if not api_key:
        raise RuntimeError("GROQ_API_KEY is not set")

    prompt = PromptTemplate.from_template("""
You are a project evaluation assistant.

Project goal:
{project_goal}

Rubric:
{rubric_text}

Convert the rubric into structured JSON.

Return ONLY valid JSON in this format:

{{
    "criteria": [
        {{
            "name": "criterion name",
            "description": "what is expected",
            "maxScore": 10,
            "requirements": ["requirement 1", "requirement 2"]
        }}
    ],
    "totalMaxScore": 100
}}
""")

    llm = ChatGroq(
        model=os.getenv("GROQ_MODEL", "openai/gpt-oss-20b"),
        temperature=0,
    )

    response = llm.invoke(
        prompt.format(
            project_goal=project_goal,
            rubric_text=rubric_text
        )
    )

    content = response.content

    try:
        return json.loads(content)
    except json.JSONDecodeError:
        raise ValueError("Groq returned invalid JSON")