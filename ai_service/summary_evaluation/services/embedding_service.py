import os
import numpy as np
from typing import List, Dict, Tuple, Optional
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


def _chunk_text(text: str, chunk_size: int = 400, overlap: int = 60) -> List[str]:
    if not text:
        return []
    chunks: List[str] = []
    step = max(1, chunk_size - overlap)
    for start in range(0, len(text), step):
        chunk = text[start : start + chunk_size].strip()
        if chunk:
            chunks.append(chunk)
    return chunks


def _coverage_thresholds() -> Tuple[float, float, float]:
    hit = float(os.environ.get("CONCEPT_COVERAGE_HIT_THRESHOLD", "0.48"))
    floor = float(os.environ.get("CONCEPT_COVERAGE_SOFT_FLOOR", "0.30"))
    ceil = float(os.environ.get("CONCEPT_COVERAGE_SOFT_CEIL", "0.70"))
    return hit, floor, ceil


def compute_concept_coverage_score(
    student_text: str,
    concept_vecs: List[List[float]],
    concept_labels: Optional[List[str]] = None,
    student_vec: Optional[List[float]] = None,
) -> Tuple[float, List[str], List[str]]:
    """
    Concept coverage with partial credit (0–1).

    - Compares each concept to the full summary AND to student chunks (best match).
    - Uses soft scoring so paraphrases below a strict cutoff still receive credit.
    """
    if not concept_vecs:
        return 0.0, [], []

    embedder = get_embedder()
    text = student_text.strip()
    if student_vec is None:
        student_vec = embedder.embed_query(text)

    chunks = _chunk_text(text) if len(text) > 450 else []
    chunk_vecs = embedder.embed_documents(chunks) if len(chunks) > 1 else []

    hit_threshold, soft_floor, soft_ceil = _coverage_thresholds()
    span = max(0.08, soft_ceil - soft_floor)

    soft_scores: List[float] = []
    hits: List[str] = []
    misses: List[str] = []

    for idx, concept_vec in enumerate(concept_vecs):
        similarities = [cosine_similarity(student_vec, concept_vec)]
        for chunk_vec in chunk_vecs:
            similarities.append(cosine_similarity(chunk_vec, concept_vec))
        best_sim = max(similarities)

        partial = max(0.0, min(1.0, (best_sim - soft_floor) / span))
        soft_scores.append(partial)

        label = ""
        if concept_labels and idx < len(concept_labels):
            label = str(concept_labels[idx]).strip()
        is_hit = best_sim >= hit_threshold or partial >= 0.5
        if label:
            if is_hit:
                hits.append(label)
            else:
                misses.append(label)

    coverage = sum(soft_scores) / len(soft_scores)
    return coverage, hits, misses


def evaluate_semantic_score(
    student_text: str,
    reference_vecs: List[List[float]],
    concept_vecs: List[List[float]],
    *,
    transcript_vecs: List[List[float]] = None,
) -> Tuple[float, Dict[str, float]]:
    """
    Deterministically scores a student summary based on 3 distinct metrics without invoking an LLM.

    1. Semantic Similarity (50%): Cosine similarity of the student text against the
       AI-generated reference summary (not the raw transcript).

    2. Concept Coverage (30%): Pre-embedded concept/objective vectors vs student text.

    3. Completeness (20%): Length modifier heuristic.
    """
    if not student_text.strip():
        return 0.0, {"similarity": 0.0, "coverage": 0.0, "completeness": 0.0}

    embedder = get_embedder()

    # --- 1. Semantic Similarity (reference summary first; legacy transcript_vecs optional) ---
    student_vec = embedder.embed_query(student_text)

    similarity_sources = reference_vecs or transcript_vecs or []
    max_sim = (
        max(cosine_similarity(student_vec, ref_vec) for ref_vec in similarity_sources)
        if similarity_sources
        else 0.0
    )
    normalized_sim = max(0.0, min(1.0, max_sim))


    # --- 2. Concept Coverage (soft + chunk-aware) ---
    coverage_score, _, _ = compute_concept_coverage_score(
        student_text,
        concept_vecs,
        student_vec=student_vec,
    )


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
