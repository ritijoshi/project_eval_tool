import asyncio
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/eval", tags=["evaluation"])

class BatchEvalRequest(BaseModel):
    sessionId: str
    transcriptPath: str
    uploadZipPath: str
    webhookUrl: str

@router.post("/batch-summary")
async def trigger_batch_evaluation(req: BatchEvalRequest):
    """
    Receives the Node.js fire-and-forget payload containing paths.
    Delegates the processing to the pipeline orchestrator asynchronously.
    """
    if not req.transcriptPath or not req.uploadZipPath:
        raise HTTPException(status_code=400, detail="Missing required paths configuration")
    
    # Dynamic import to avoid circular dependency in modular architecture
    try:
        from summary_evaluation.pipelines.orchestrator import run_evaluation_pipeline
    except Exception as exc:
        print(f"ERROR: Failed to import orchestrator: {exc}")
        raise HTTPException(status_code=500, detail="Could not start evaluation pipeline")

    print(
        "DEBUG: Queued batch evaluation",
        f"session={req.sessionId}",
        f"webhook={req.webhookUrl}"
    )

    asyncio.create_task(
        run_evaluation_pipeline(
            session_id=req.sessionId,
            transcript_path=req.transcriptPath,
            zip_path=req.uploadZipPath,
            webhook_url=req.webhookUrl
        )
    )

    return {"status": "accepted", "message": "Background evaluation job started successfully"}
