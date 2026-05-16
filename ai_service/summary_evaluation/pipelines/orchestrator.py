import os
import asyncio
import httpx
from datetime import datetime
from typing import List, Dict, Any

# Import our utilities and service layers
from summary_evaluation.utils.zip_handler import safe_extract_zip, get_submission_files, cleanup_temp_dir
from summary_evaluation.utils.vtt_parser import parse_transcript
from summary_evaluation.utils.html_cleaner import clean_html_submission, extract_identity_from_filename
from summary_evaluation.services.embedding_service import get_embedder, evaluate_semantic_score
from summary_evaluation.services.groq_circuit import GroqCircuitBreaker
from summary_evaluation.agents.transcript_agent import condense_transcript
from summary_evaluation.agents.feedback_agent import generate_feedback
from summary_evaluation.agents.ai_evaluator import evaluate_summary_with_ai, format_qualitative_feedback, fallback_evaluation

# Optional text splitting strategy for reference summary chunks
try:
    from langchain_text_splitters import RecursiveCharacterTextSplitter
    reference_splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=80)
except ImportError:
    reference_splitter = None

WEBHOOK_SEMAPHORE = asyncio.Semaphore(3)

async def broadcast_progress(webhook_url: str, payload: dict):
    """Fire-and-forget webhook transmitter with retry/backoff for transient failures."""
    max_attempts = 4
    timeout_seconds = 20.0
    backoff_seconds = 0.8

    async with WEBHOOK_SEMAPHORE:
        async with httpx.AsyncClient() as client:
            for attempt in range(1, max_attempts + 1):
                try:
                    print(f"DEBUG: Webhook Broadcast [{payload.get('status')}] -> {webhook_url} (attempt {attempt}/{max_attempts})")
                    resp = await client.post(webhook_url, json=payload, timeout=timeout_seconds)
                    resp.raise_for_status()
                    return
                except Exception as e:
                    if attempt == max_attempts:
                        print(f"ERROR: Webhook Notification failed to {webhook_url}. Details: {str(e)}")
                        import traceback
                        traceback.print_exc()
                    else:
                        await asyncio.sleep(backoff_seconds * attempt)

def log_event(session_id: str, stage: str, status: str, student_id: str = "N/A"):
    """ Structured logging metadata """
    timestamp = datetime.utcnow().isoformat()
    print(f"[{timestamp}] [Session: {session_id}] [Student: {student_id}] [Stage: {stage}] [Status: {status}]")


def _chunk_reference_summary(reference_summary: str) -> List[str]:
    if not reference_summary.strip():
        return []
    if reference_splitter:
        return reference_splitter.split_text(reference_summary)
    return [reference_summary[i:i + 500] for i in range(0, len(reference_summary), 420)]


def _concept_targets(reference_package: Dict[str, Any]) -> List[str]:
    """Merge concepts, objectives, and topics for coverage embedding (capped)."""
    max_items = max(4, int(os.environ.get("CONCEPT_COVERAGE_MAX_ITEMS", "12")))
    seen = set()
    targets: List[str] = []
    for key in ("core_concepts", "learning_objectives", "main_topics", "expected_insights"):
        for item in reference_package.get(key, []) or []:
            if len(targets) >= max_items:
                return targets
            label = str(item).strip()
            if not label:
                continue
            lowered = label.lower()
            if lowered in seen:
                continue
            seen.add(lowered)
            targets.append(label)
    return targets


async def process_single_student(
    filepath: str,
    reference_vecs: List[List[float]],
    reference_chunks: List[str],
    concept_vecs: List[List[float]],
    reference_package: Dict[str, Any],
    circuit_breaker: GroqCircuitBreaker,
) -> dict:
    """Evaluates one student. Failures here do not crash the batch."""
    core_concepts = reference_package.get("core_concepts", [])
    try:
        print(f"DEBUG: Analyzing student submission -> {filepath}")
        student_name, roll_number = extract_identity_from_filename(filepath)
        if roll_number == "UNKNOWN" or not student_name:
            print(f"WARNING: Could not parse student identity from path: {filepath}")

        lower_path = filepath.lower()
        if lower_path.endswith('.pdf') or lower_path.endswith('.docx'):
            try:
                from main import extract_text_from_file
                student_text = extract_text_from_file(filepath, os.path.basename(filepath))
            except Exception as e:
                print(f"ERROR: Failed to import/execute pdf-docx extractor for {filepath}: {e}")
                student_text = ""
        else:
            with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                raw_html = f.read()
            cleaned_data = clean_html_submission(raw_html)
            student_text = cleaned_data["text"]

        if not student_text or not student_text.strip():
            raise Exception(f"No extractable text found in {os.path.basename(filepath)}. It may be corrupt or purely image-based.")

        # Stage 2 — deterministic metrics vs reference summary (not raw transcript)
        score, metrics = evaluate_semantic_score(student_text, reference_vecs, concept_vecs)

        reference_summary = str(reference_package.get("reference_summary", "")).strip()
        if not reference_summary:
            print("WARNING: Reference summary is empty; evaluation will rely on fallback heuristics.")

        # Stage 2 — Groq evaluation vs reference package + deterministic signals
        try:
            ai_evaluation = evaluate_summary_with_ai(
                student_summary=student_text,
                reference_package=reference_package,
                core_concepts=core_concepts,
                deterministic_metrics=metrics,
                reference_vecs=reference_vecs,
                reference_chunks=reference_chunks,
                circuit_breaker=circuit_breaker,
            )
        except Exception as e:
            print(f"ERROR: AI evaluation failed for {filepath}: {e}")
            ai_evaluation = fallback_evaluation(student_text, metrics, core_concepts)

        if not ai_evaluation or not ai_evaluation.get("metrics"):
            ai_evaluation = fallback_evaluation(student_text, metrics, core_concepts)

        final_score = ai_evaluation.get("overallScore")
        if final_score is None:
            final_score = score

        feedback = format_qualitative_feedback(ai_evaluation)
        if not feedback and not circuit_breaker.is_open:
            feedback = generate_feedback(student_text, final_score, core_concepts)
        if not feedback:
            feedback = format_qualitative_feedback(
                fallback_evaluation(student_text, metrics, core_concepts)
            )

        return {
            "success": True,
            "studentName": student_name,
            "rollNumber": roll_number,
            "rollNo": roll_number,
            "summaryText": student_text[:5000],
            "score": final_score,
            "feedback": feedback,
            "metrics": metrics,
            "aiEvaluation": ai_evaluation,
        }
    except Exception as e:
        log_event("N/A", "Student Eval", "FAILED", filepath)
        return {
            "success": False,
            "studentName": "Error",
            "rollNumber": "UNKNOWN",
            "rollNo": "UNKNOWN",
            "errorMessage": str(e),
        }


async def run_evaluation_pipeline(session_id: str, transcript_path: str, zip_path: str, webhook_url: str):
    """
    Two-stage evaluation orchestrator:
      Stage 1 — Groq transcript condensation into a reference package (once per session)
      Stage 2 — Per-student evaluation vs reference summary + deterministic metrics
    """
    temp_dir = os.path.join(os.path.dirname(zip_path), f"session_{session_id}")
    circuit_breaker = GroqCircuitBreaker(session_id=session_id)

    try:
        log_event(session_id, "Init", "STARTING")

        # 1. EXTRACTING Phase
        print(f"DEBUG: Starting extraction of {zip_path} into {temp_dir}")
        await broadcast_progress(webhook_url, {"sessionId": session_id, "status": "EXTRACTING", "progressPercent": 5})
        safe_extract_zip(zip_path, temp_dir)
        submission_files = get_submission_files(temp_dir)
        total_students = len(submission_files)

        print(f"DEBUG: Found {total_students} submissions in ZIP.")
        if total_students == 0:
            raise Exception("No valid .html, .txt, .pdf, or .docx submissions found inside the ZIP.")

        # 2. Stage 1 — CONDENSING_TRANSCRIPT (reference package generation)
        await broadcast_progress(
            webhook_url,
            {
                "sessionId": session_id,
                "status": "ANALYZING_TRANSCRIPT",
                "progressPercent": 10,
                "totalStudents": total_students,
                "stage": "CONDENSING_TRANSCRIPT",
            },
        )

        parsed_transcript = parse_transcript(transcript_path)
        reference_package = condense_transcript(parsed_transcript, circuit_breaker=circuit_breaker)
        core_concepts = reference_package.get("core_concepts", [])
        reference_summary = str(reference_package.get("reference_summary", "")).strip()

        print(
            f"[Session {session_id}] Stage 1 complete | reference_len={len(reference_summary)} "
            f"| concepts={len(core_concepts)} | fallback={reference_package.get('condensation_fallback', False)}"
        )

        embedder = get_embedder()
        concept_targets = _concept_targets(reference_package)
        concept_vecs = embedder.embed_documents(concept_targets) if concept_targets else []
        if concept_targets:
            print(f"[Session {session_id}] Coverage targets: {len(concept_targets)} concepts")

        reference_chunks = _chunk_reference_summary(reference_summary)
        reference_vecs = embedder.embed_documents(reference_chunks) if reference_chunks else []

        # 3. Stage 2 — EVALUATING students against reference package
        await broadcast_progress(
            webhook_url,
            {
                "sessionId": session_id,
                "status": "EVALUATING",
                "progressPercent": 20,
                "stage": "STUDENT_EVALUATION",
            },
        )

        eval_concurrency = max(1, int(os.environ.get("GROQ_EVAL_CONCURRENCY", "3")))
        print(f"[Session {session_id}] Student eval concurrency={eval_concurrency}")
        semaphore = asyncio.Semaphore(eval_concurrency)

        async def sem_task(idx, filepath):
            async with semaphore:
                result = await process_single_student(
                    filepath,
                    reference_vecs,
                    reference_chunks,
                    concept_vecs,
                    reference_package,
                    circuit_breaker,
                )
                await broadcast_progress(webhook_url, {
                    "sessionId": session_id,
                    "status": "EVALUATING",
                    "processedStudents": idx + 1,
                    "progressPercent": int(20 + ((idx + 1) / total_students) * 75),
                    "latestResult": result,
                })
                return result

        tasks = [sem_task(i, filepath) for i, filepath in enumerate(submission_files)]
        results = await asyncio.gather(*tasks)

        # 4. COMPLETED Phase
        log_event(session_id, "Finalization", "COMPLETED")
        await broadcast_progress(webhook_url, {
            "sessionId": session_id,
            "status": "COMPLETED",
            "progressPercent": 100,
            "processedStudents": total_students,
            "results": results,
            "referencePackage": {
                "referenceSummaryPreview": reference_summary[:500],
                "coreConcepts": core_concepts[:12],
                "condensationFallback": reference_package.get("condensation_fallback", False),
            },
            "groqCircuit": circuit_breaker.status(),
        })

    except Exception as e:
        log_event(session_id, "Pipeline Error", "FAILED")
        print(f"CRITICAL ERROR in Orchestrator Pipeline trace: {str(e)}")
        import traceback
        traceback.print_exc()
        await broadcast_progress(webhook_url, {
            "sessionId": session_id,
            "status": "FAILED",
            "errorInfo": {"stage": "Orchestrator Execution", "message": str(e)},
        })
    finally:
        cleanup_temp_dir(temp_dir)
