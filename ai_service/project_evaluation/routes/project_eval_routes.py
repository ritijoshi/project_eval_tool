from typing import Dict, List, Optional, Union

from fastapi import APIRouter
from pydantic import BaseModel, Field

from project_evaluation.pipelines.orchestrator import (
    evaluate_project,
    evaluate_projects,
)


router = APIRouter(prefix="/project-eval", tags=["project-evaluation"])


class ProjectEvalRequest(BaseModel):
    projectGoal: str = ""
    rubric: Union[str, Dict[str, object]]
    githubUrl: str
    weeklyReport: Optional[Union[str, Dict[str, object]]] = None
    weeklyReportPath: Optional[str] = None
    projectId: Optional[str] = None

    def to_project_input(self):
        project = {
            "project_goal": self.projectGoal,
            "rubric": self.rubric,
            "github_url": self.githubUrl,
            "project_id": self.projectId,
        }
        if self.weeklyReportPath:
            project["weekly_report_path"] = self.weeklyReportPath
        elif isinstance(self.weeklyReport, dict):
            project["weekly_report"] = self.weeklyReport
        elif isinstance(self.weeklyReport, str) and self.weeklyReport.strip():
            project["weekly_report_text"] = self.weeklyReport
        return project


class ProjectEvalBatchRequest(BaseModel):
    projects: List[ProjectEvalRequest] = Field(..., min_items=1)
    maxConcurrency: int = Field(default=3, ge=1)


@router.post("/single")
async def evaluate_single_project(request: ProjectEvalRequest):
    return await evaluate_project(request.to_project_input())


@router.post("/batch")
async def evaluate_project_batch(request: ProjectEvalBatchRequest):
    projects = [project.to_project_input() for project in request.projects]
    return {
        "results": await evaluate_projects(
            projects,
            max_concurrency=request.maxConcurrency,
        )
    }


@router.get("/health")
async def project_eval_health():
    return {"status": "ok"}