import os
import asyncio
import httpx
from datetime import datetime
from typing import List

# Import our utilities and service layers
from summary_evaluation.utils.zip_handler import safe_extract_zip, get_submission_files, cleanup_temp_dir
from summary_evaluation.utils.vtt_parser import parse_transcript
from summary_evaluation.utils.html_cleaner import clean_html_submission, extract_identity_from_filename
from summary_evaluation.services.embedding_service import get_embedder, evaluate_semantic_score
from summary_evaluation.agents.transcript_agent import run_transcript_agent
from summary_evaluation.agents.feedback_agent import generate_feedback

# Optional text splitting strategy
try:
    from langchain_text_splitters import RecursiveCharacterTextSplitter
    text_splitter = RecursiveCharacterTextSplitter(chunk_size=800, chunk_overlap=150)
except ImportError:
    # Fallback if text_splitters isn't available
    text_splitter = None

async def broadcast_progress(webhook_url: str, payload: dict):
    """ Fire-and-forget webhook transmitter """
    async with httpx.AsyncClient() as client:
        try:
            print(f"DEBUG: Webhook Broadcast [{payload.get('status')}] -> {webhook_url}")
            resp = await client.post(webhook_url, json=payload, timeout=5.0)
            resp.raise_for_status()
        except Exception as e:
            # We don't crash the pipeline if Webhook fails
            print(f"ERROR: Webhook Notification failed to {webhook_url}. Details: {str(e)}")
            import traceback
            traceback.print_exc()

def log_event(session_id: str, stage: str, status: str, student_id: str = "N/A"):
    """ Structured logging metadata """
    timestamp = datetime.utcnow().isoformat()
    print(f"[{timestamp}] [Session: {session_id}] [Student: {student_id}] [Stage: {stage}] [Status: {status}]")

async def process_single_student(
    filepath: str, 
    transcript_vecs: List[List[float]], 
    concept_vecs: List[List[float]],
    core_concepts: List[str]
) -> dict:
    """ Evaluates one student. Failures here do not crash the batch. """
    try:
        print(f"DEBUG: Analyzing student submission -> {filepath}")
        # Extract identity based on the filename deterministic logic
        student_name, roll_number = extract_identity_from_filename(filepath)
        
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

        # Math Score (Deterministic)
        score, metrics = evaluate_semantic_score(student_text, transcript_vecs, concept_vecs)
        
        # LLM Feedback (Generative)
        feedback = generate_feedback(student_text, score, core_concepts)

        return {
            "success": True,
            "studentName": student_name,
            "rollNumber": roll_number,
            "summaryText": student_text[:5000],  # Save a snippet to DB
            "score": score,
            "feedback": feedback,
            "metrics": metrics
        }
    except Exception as e:
        log_event("N/A", "Student Eval", "FAILED", filepath)
        return {
            "success": False,
            "studentName": "Error",
            "rollNumber": "UNKNOWN",
            "errorMessage": str(e)
        }

async def run_evaluation_pipeline(session_id: str, transcript_path: str, zip_path: str, webhook_url: str):
    """
    The orchestrator. Handles zip slipping, transcript mapping, vector caching, 
    and multi-student concurrency scheduling.
    """
    temp_dir = os.path.join(os.path.dirname(zip_path), f"session_{session_id}")
    
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

        # 2. ANALYZING_TRANSCRIPT Phase
        await broadcast_progress(webhook_url, {"sessionId": session_id, "status": "ANALYZING_TRANSCRIPT", "progressPercent": 10, "totalStudents": total_students})
        
        parsed_transcript = parse_transcript(transcript_path)
        
        # Agent analyzes once.
        ground_truth = run_transcript_agent(parsed_transcript)
        core_concepts = ground_truth.get("core_concepts", [])
        
        # Concept Vectors Cache
        embedder = get_embedder()
        concept_vecs = embedder.embed_documents(core_concepts) if core_concepts else []
        
        # Chunk Transcript intelligently 
        if text_splitter:
            transcript_chunks = text_splitter.split_text(parsed_transcript)
        else:
            # Fallback simple string split
            transcript_chunks = [parsed_transcript[i:i+800] for i in range(0, len(parsed_transcript), 650)]
            
        # Transcript Vectors Cache
        transcript_vecs = embedder.embed_documents(transcript_chunks) if transcript_chunks else []

        # 3. EVALUATING Phase (Applying Concurrency Controls)
        await broadcast_progress(webhook_url, {"sessionId": session_id, "status": "EVALUATING", "progressPercent": 20})
        
        semaphore = asyncio.Semaphore(10) # 10 Concurrent LLM limits
        
        async def sem_task(idx, filepath):
            async with semaphore:
                # Calculate progress purely mathematically
                result = await process_single_student(filepath, transcript_vecs, concept_vecs, core_concepts)
                # Report this to node.js to bounce through websockets natively
                await broadcast_progress(webhook_url, {
                    "sessionId": session_id,
                    "status": "EVALUATING",
                    "processedStudents": idx + 1,
                    "progressPercent": int(20 + ((idx + 1) / total_students) * 75),
                    "latestResult": result
                })
                return result

        # Fire them into the asyncio pool
        tasks = [sem_task(i, filepath) for i, filepath in enumerate(submission_files)]
        await asyncio.gather(*tasks)

        # 4. COMPLETED Phase
        log_event(session_id, "Finalization", "COMPLETED")
        await broadcast_progress(webhook_url, {
            "sessionId": session_id, 
            "status": "COMPLETED", 
            "progressPercent": 100,
            "processedStudents": total_students
        })

    except Exception as e:
        log_event(session_id, "Pipeline Error", "FAILED")
        print(f"CRITICAL ERROR in Orchestrator Pipeline trace: {str(e)}")
        import traceback
        traceback.print_exc()
        await broadcast_progress(webhook_url, {
            "sessionId": session_id, 
            "status": "FAILED", 
            "errorInfo": {"stage": "Orchestrator Execution", "message": str(e)}
        })
    finally:
        # 5. Guaranteed disk cleanup for security
        cleanup_temp_dir(temp_dir)
