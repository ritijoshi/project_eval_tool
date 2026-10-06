import asyncio
import inspect
from pathlib import Path

from project_evaluation.agents.evidence_engine import build_evidence
from project_evaluation.agents.github_analyzer import analyze_github_repo
from project_evaluation.agents.project_evaluator import (
    evaluate_project as generate_project_evaluation,
)
from project_evaluation.agents.rubric_parser import parse_rubric
from project_evaluation.agents.weekly_doc_parser import (
    parse_weekly_report,
    parse_weekly_report_text,
)
from project_evaluation.utils.github_client import get_repo_data


async def evaluate_project(project, progress_callback=None):
    """Run the complete evaluation pipeline for one project.

    Required input keys are ``project_goal``, ``github_url``, and ``rubric``.
    Rubric may be a parsed dictionary or raw text. An optional weekly report
    can be supplied as a parsed dictionary, a file path, or ``weekly_report_text``.
    """
    project_id = None
    stage = "starting"

    async def report_progress(progress, current_stage, status="running", error=None):
        if progress_callback is None:
            return
        event = {
            "projectId": project_id,
            "progress": progress,
            "stage": current_stage,
            "status": status,
        }
        if error is not None:
            event["error"] = error
        try:
            callback_result = progress_callback(event)
            if inspect.isawaitable(callback_result):
                await callback_result
        except Exception:
            pass

    try:
        if not isinstance(project, dict):
            raise TypeError("Each project input must be a dictionary")
        project_id = project.get("project_id", project.get("student_id"))

        project_goal = project.get("project_goal", project.get("projectGoal", ""))
        github_url = project.get("github_url", project.get("githubUrl", ""))
        rubric_input = project.get("rubric", project.get("rubric_text"))
        if not rubric_input:
            rubric_input = project.get("rubricText")
        if not github_url:
            raise ValueError("github_url is required")
        if not rubric_input:
            raise ValueError("rubric or rubric_text is required")

        await report_progress(5, "starting")

        stage = "rubric_parsing"
        if isinstance(rubric_input, dict):
            rubric = rubric_input
            if not rubric.get("criteria"):
                raise ValueError("Structured rubric must contain criteria")
        elif isinstance(rubric_input, str):
            rubric = await asyncio.to_thread(
                parse_rubric,
                rubric_input,
                project_goal,
            )
        else:
            raise TypeError("rubric must be structured data or text")
        await report_progress(20, stage)

        stage = "github_analysis"
        repo_data = await asyncio.to_thread(
            get_repo_data,
            github_url,
            rubric=rubric,
        )
        github_analysis = await asyncio.to_thread(
            analyze_github_repo,
            repo_data,
            rubric,
        )
        await report_progress(45, stage)

        stage = "weekly_report_parsing"
        weekly_report = await _parse_weekly_input(project)
        await report_progress(60, stage)

        stage = "evidence_consolidation"
        consolidated_evidence = build_evidence(
            repo_data,
            github_analysis,
            rubric,
            weekly_report,
        )
        await report_progress(75, stage)

        stage = "project_evaluation"
        evaluation = await asyncio.to_thread(
            generate_project_evaluation,
            project_goal,
            rubric,
            consolidated_evidence,
        )
        await report_progress(95, stage)

        result = {
            **evaluation,
            "success": True,
            "projectId": project_id,
            "rubric": rubric,
            "githubAnalysis": github_analysis,
            "weeklyReport": weekly_report,
            "evidence": consolidated_evidence,
        }
        await report_progress(100, "completed", status="completed")
        return result
    except Exception as exc:
        await report_progress(
            100,
            "failed",
            status="failed",
            error=str(exc),
        )
        return {
            "success": False,
            "projectId": project_id,
            "failedStage": stage,
            "error": str(exc),
        }


async def evaluate_projects(
    projects,
    max_concurrency=3,
    progress_callback=None,
):
    """Evaluate several projects concurrently, preserving input order."""
    if max_concurrency < 1:
        raise ValueError("max_concurrency must be at least 1")

    semaphore = asyncio.Semaphore(max_concurrency)

    async def evaluate_limited(project):
        async with semaphore:
            return await evaluate_project(project, progress_callback)

    return await asyncio.gather(
        *(evaluate_limited(project) for project in projects)
    )


async def _parse_weekly_input(project):
    report_path = project.get("weekly_report_path")
    if report_path:
        return await asyncio.to_thread(parse_weekly_report, report_path)

    report_text = project.get("weekly_report_text")
    if report_text is not None:
        return await asyncio.to_thread(parse_weekly_report_text, report_text)

    report = project.get("weekly_report")
    if isinstance(report, dict):
        return report
    if isinstance(report, str):
        path = Path(report)
        if "\n" not in report and path.is_file():
            return await asyncio.to_thread(parse_weekly_report, report)
        return await asyncio.to_thread(parse_weekly_report_text, report)
    if report is not None:
        raise TypeError("weekly_report must be parsed data, text, or a file path")
    return None