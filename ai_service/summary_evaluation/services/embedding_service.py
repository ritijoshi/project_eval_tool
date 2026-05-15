import numpy as np
from typing import List, Dict, Tuple
from langchain_huggingface import HuggingFaceEmbeddings

# Initialize the embedding model globally for the service to avoid reloading it
_embeddings_model = None

def get_embedder() -> HuggingFaceEmbeddings:
    global _embeddings_model
    if _embeddings_model is None:
        # Utilizing standard Sentence Transformers as requested
        _embeddings_model = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")
    return _embeddings_model

def cosine_similarity(v1: List[float], v2: List[float]) -> float:
    dot_product = np.dot(v1, v2)
    norm_v1 = np.linalg.norm(v1)
    norm_v2 = np.linalg.norm(v2)
    if norm_v1 == 0 or norm_v2 == 0:
        return 0.0
    return float(dot_product / (norm_v1 * norm_v2))

def evaluate_semantic_score(
    student_text: str, 
    transcript_vecs: List[List[float]],
    concept_vecs: List[List[float]]
) -> Tuple[float, Dict[str, float]]:
    """
    Deterministically scores a student summary based on 3 distinct metrics without invoking an LLM.
    
    1. Semantic Similarity (50%): Uses embedder to find the cosine similarity of the student 
       text against the best-matching chunk of the lecture transcript. 
       
    2. Concept Coverage (30%): Uses pre-embedded concept_vecs. 
       Checks how many cross a threshold (e.g. 0.65) against the student's text.
       
    3. Completeness (20%): Length modifier heuristic.
    """
    if not student_text.strip():
        return 0.0, {"similarity": 0.0, "coverage": 0.0, "completeness": 0.0}

    embedder = get_embedder()

    # --- 1. Semantic Similarity ---
    # Only embed the unique student text per invocation!
    student_vec = embedder.embed_query(student_text)
    
    max_sim = max([cosine_similarity(student_vec, t_vec) for t_vec in transcript_vecs]) if transcript_vecs else 0.0
    normalized_sim = max(0.0, min(1.0, max_sim))


    # --- 2. Concept Coverage ---
    coverage_score = 0.0
    if concept_vecs:
        hits = 0
        threshold = 0.65 
        for c_vec in concept_vecs:
            if cosine_similarity(student_vec, c_vec) >= threshold:
                hits += 1
        coverage_score = hits / len(concept_vecs)


    # --- 3. Completeness ---
    word_count = len(student_text.split())
    completeness_score = 0.0
    if 100 <= word_count <= 800:
        completeness_score = 1.0
    elif word_count < 100:
        completeness_score = max(0.0, word_count / 100.0)
    else:
        completeness_score = max(0.0, 1.0 - ((word_count - 800) / 1000.0))


    # --- Final Weighted Score ---
    weighted_score = (normalized_sim * 5.0) + (coverage_score * 3.0) + (completeness_score * 2.0)
    final_score = round(max(0.0, min(10.0, weighted_score)), 1)
    
    metrics = {
        "similarity": normalized_sim,
        "coverage": coverage_score,
        "completeness": completeness_score,
        "relevance": normalized_sim,
        "clarity": completeness_score,
        "keywordCoverage": coverage_score,
        "plagiarismSimilarity": None
    }
    
    return final_score, metrics
