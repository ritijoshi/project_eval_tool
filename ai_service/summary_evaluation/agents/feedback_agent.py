from langchain_groq import ChatGroq
from langchain_core.prompts import PromptTemplate
from tenacity import retry, wait_exponential, stop_after_attempt

def _fallback_feedback(score: float, core_concepts: list) -> str:
    concept_hint = ", ".join(core_concepts[:2]) if core_concepts else "the lecture's key concepts"
    if score >= 8:
        return (
            f"Summary aligns with several core ideas, but it should explicitly connect {concept_hint}. "
            "Improve structure by grouping related points into clearer paragraphs."
        )
    return (
        f"Summary misses important ideas like {concept_hint}. "
        "Expand coverage and add specific examples from the lecture to improve clarity."
    )

@retry(wait=wait_exponential(multiplier=2, min=2, max=10), stop=stop_after_attempt(3))
def generate_feedback(student_summary: str, score: float, core_concepts: list) -> str:
    """
    Invokes Groq LLM under strict guardrails to generate a short qualitative remark.
    It receives the deterministic math score (e.g. 8.2) to inform its tone without calculating it.
    """
    if not student_summary.strip():
        return "Submission was empty. Please ensure valid HTML/Text was submitted."

    llm = ChatGroq(
        model_name="llama3-8b-8192", 
        temperature=0.3, # Slight variance to prevent identical feedback
        max_tokens=150
    )
    
    prompt = PromptTemplate.from_template(
        "You are evaluating a student's lecture summary. The student mathematically achieved a score of {score}/10 based on structure and semantic overlap.\n"
        "Your task is to write EXACTLY TWO sentences of direct feedback.\n\n"
        "STRICT GUARDRAILS:\n"
        "1. MAXIMUM 2 sentences.\n"
        "2. NO generic praise (Do not say 'Good job' or 'Great summary').\n"
        "3. Focus ONLY on matching their text against the lecture's core concepts: {concepts}\n"
        "4. Be direct and academic. Point out one thing covered well, and one thing missed if the score is < 10.\n"
        "5. DO NOT hallucinate concepts not taught.\n\n"
        "STUDENT SUBMISSION:\n{summary}\n\n"
        "FEEDBACK STRING:"
    )
    
    try:
        chain = prompt | llm
        response = chain.invoke({
            "score": score,
            "concepts": ", ".join(core_concepts[:5]), # Provide top 5 concepts to keep context tight
            "summary": student_summary[:1500] # Safe crop
        })
        
        feedback = response.content.strip()
        
        # Enforce the 2 sentence rule physically just in case LLM wanders
        sentences = [s.strip() for s in feedback.replace('!', '.').replace('?', '.').split('.') if s.strip()]
        return ". ".join(sentences[:2]) + "."
        
    except Exception as e:
        print(f"Feedback Agent Failure: {str(e)}")
        return _fallback_feedback(score, core_concepts)
