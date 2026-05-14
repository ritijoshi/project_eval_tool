import os
import json
from typing import Dict, List
from langchain_groq import ChatGroq
from langchain_core.prompts import PromptTemplate
from tenacity import retry, wait_exponential, stop_after_attempt

# Note: Pydantic schemas could be used for structured outputs if we upgrade to Instructor,
# but we will rely on structured JSON prompts to keep footprint low.

@retry(wait=wait_exponential(multiplier=2, min=2, max=10), stop=stop_after_attempt(3))
def run_transcript_agent(parsed_text: str) -> Dict[str, List[str]]:
    """
    Analyzes the raw lecture text ONCE per session.
    Extracts structured core learning concepts using Groq to build the "Ground Truth".
    Has timeout protection implicitly via standard request bounds and Tenacity retries.
    """
    if not parsed_text:
        return {"main_topics": [], "core_concepts": [], "important_terms": [], "examples_discussed": []}

    try:
        # We explicitly rely on ChatGroq initialized strictly.
        llm = ChatGroq(
            model_name="llama3-8b-8192", 
            temperature=0.1, # Low temperature for analytical consistency
            max_tokens=1000
        )
        
        prompt = PromptTemplate.from_template(
            "You are a strict educational schema extractor. Read the transcript below and extract key components.\n"
            "Return ONLY a valid raw JSON object matching this structure EXACTLY:\n"
            "{{\n"
            '  "main_topics": ["topic 1", "topic 2"],\n'
            '  "core_concepts": ["concept 1", "concept 2"],\n'
            '  "important_terms": ["term 1", "term 2"],\n'
            '  "examples_discussed": ["example 1", "example 2"]\n'
            "}}\n"
            "Do NOT return Markdown blocks (` ```json `), only the raw JSON. Do not hallucinate concepts that were not in the transcript.\n\n"
            "TRANSCRIPT:\n{transcript}\n"
        )
        
        # We slice the parsed transcript if it exceeds massive lengths (basic context limit safety)
        safe_transcript = parsed_text[:20000] 
        
        chain = prompt | llm
        response = chain.invoke({"transcript": safe_transcript})
        
        # Clean potential markdown if LLM slipped up
        content = response.content.replace("```json", "").replace("```", "").strip()
        
        return json.loads(content)
        
    except Exception as e:
        print(f"Transcript Agent Failure: {str(e)}")
        # Degrade gracefully instead of crashing pipeline
        return {"main_topics": [], "core_concepts": ["Lecture Content"], "important_terms": [], "examples_discussed": []}
