from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/eval", tags=["evaluation"])

class BatchEvalRequest(BaseModel):
    sessionId: str
    transcriptPath: str
    uploadZipPath: str
    webhookUrl: str

@router.post("/batch-summary")
async def trigger_batch_evaluation(req: BatchEvalRequest, bg_tasks: BackgroundTasks):
    """
    Receives the Node.js fire-and-forget payload containing paths.
    Delegates the processing to the pipeline orchestrator asynchronously.
    """
    if not req.transcriptPath or not req.uploadZipPath:
        raise HTTPException(status_code=400, detail="Missing required paths configuration")
    
    # Dynamic import to avoid circular dependency in modular architecture
    # The orchestrator will be built in the next step
    try:
        from summary_evaluation.pipelines.orchestrator import run_evaluation_pipeline
        
        # Dispatch to background task. 
        # This allows FastAPI to return 202 Accepted instantly to Node.js
        bg_tasks.add_task(
            run_evaluation_pipeline,
            session_id=req.sessionId,
            transcript_path=req.transcriptPath,
            zip_path=req.uploadZipPath,
            webhook_url=req.webhookUrl
        )
        
        return {"status": "accepted", "message": "Background evaluation job started successfully"}
        
    except ImportError:
        # Temporary safeguard until the orchestrator is implemented in the next step
        return {"status": "pending_implementation", "message": "Orchestrator not yet built"}
