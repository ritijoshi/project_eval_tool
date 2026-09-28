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


class SingleAssignEvalRequest(BaseModel):
    submissionId: str
    studentText: str = ""
    assignmentType: str = "text"
    rubricPackage: dict = {}
    webhookUrl: str = ""


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
        )
    )

    return {"status": "accepted", "message": "Background assignment evaluation job started successfully"}


@router.post("/single-assignment")
async def trigger_single_assignment_eval(req: SingleAssignEvalRequest):
    try:
        from assignment_evaluation.pipelines.orchestrator import evaluate_single_submission_with_llm
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not initialize single assignment evaluator: {exc}")

    result = await evaluate_single_submission_with_llm(
        student_text=req.studentText,
        rubric_package=req.rubricPackage,
        assignment_type=req.assignmentType,
        student_name=req.submissionId,
        file_name=req.submissionId,
    )

    return {"success": True, "result": result}
