import asyncio
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/eval", tags=["assignment-evaluation"])


class BatchAssignEvalRequest(BaseModel):
    sessionId: str
    rubricPath: str
    submissionsZipPath: str
    assignmentType: str = "text"
    assignmentQuestion: str = ""
    modelAnswer: str = ""
    webhookUrl: str
    agenticMode: int = 0


class SingleAssignEvalRequest(BaseModel):
    submissionId: str
    studentText: str = ""
    assignmentType: str = "text"
    rubricPackage: dict = {}
    webhookUrl: str = ""
    agenticMode: int = 0


@router.post("/batch-assignment")
async def trigger_batch_assignment_eval(req: BatchAssignEvalRequest):
    if not req.rubricPath or not req.submissionsZipPath:
        raise HTTPException(status_code=400, detail="Missing required assignment evaluation paths")

    try:
        from assignment_evaluation.pipelines.orchestrator import run_assignment_eval_pipeline
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not start assignment evaluation pipeline: {exc}")

    asyncio.create_task(
        run_assignment_eval_pipeline(
            session_id=req.sessionId,
            rubric_path=req.rubricPath,
            zip_path=req.submissionsZipPath,
            assignment_type=req.assignmentType,
            webhook_url=req.webhookUrl,
            assignment_question=req.assignmentQuestion,
            model_answer=req.modelAnswer,
            agentic_mode=req.agenticMode,
        )
    )

    return {"status": "accepted", "message": "Background assignment evaluation job started successfully"}


@router.post("/single-assignment")
async def trigger_single_assignment_eval(req: SingleAssignEvalRequest):
    try:
        from agentic_eval.orchestrator import default_orchestrator
        from agentic_eval.config import ConfigOverride

        eval_enabled = req.agenticMode > 0
        with ConfigOverride(eval_enabled=eval_enabled, mode=req.agenticMode):
            result = await default_orchestrator.evaluate_single_assignment(
                student_text=req.studentText,
                rubric_package=req.rubricPackage,
                assignment_type=req.assignmentType,
                student_name=req.submissionId,
                file_name=req.submissionId,
            )

        return {"success": True, "result": result}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not execute single assignment evaluator: {exc}")
