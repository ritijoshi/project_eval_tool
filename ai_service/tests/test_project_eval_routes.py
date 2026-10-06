import asyncio

from project_evaluation.routes import project_eval_routes


def test_single_route_maps_backend_request_to_orchestrator(monkeypatch):
    received = {}

    async def fake_evaluate_project(project):
        received.update(project)
        return {"success": True, "overallScore": 80}

    monkeypatch.setattr(project_eval_routes, "evaluate_project", fake_evaluate_project)
    request = project_eval_routes.ProjectEvalRequest(
        projectGoal="Build an ML prediction system",
        rubric="API: 20 points",
        githubUrl="https://github.com/student/project",
        weeklyReport="Completed prediction endpoint",
        projectId="student-1",
    )

    result = asyncio.run(project_eval_routes.evaluate_single_project(request))

    assert result == {"success": True, "overallScore": 80}
    assert received == {
        "project_goal": "Build an ML prediction system",
        "rubric": "API: 20 points",
        "github_url": "https://github.com/student/project",
        "project_id": "student-1",
        "weekly_report_text": "Completed prediction endpoint",
    }


def test_batch_route_passes_projects_and_concurrency(monkeypatch):
    received = {}

    async def fake_evaluate_projects(projects, max_concurrency):
        received["projects"] = projects
        received["max_concurrency"] = max_concurrency
        return [{"success": True}]

    monkeypatch.setattr(project_eval_routes, "evaluate_projects", fake_evaluate_projects)
    project = project_eval_routes.ProjectEvalRequest(
        rubric={"criteria": [{"name": "API", "maxScore": 10}]},
        githubUrl="https://github.com/student/project",
    )
    request = project_eval_routes.ProjectEvalBatchRequest(
        projects=[project],
        maxConcurrency=2,
    )

    result = asyncio.run(project_eval_routes.evaluate_project_batch(request))

    assert result == {"results": [{"success": True}]}
    assert received["max_concurrency"] == 2
    assert received["projects"][0]["rubric"] == {
        "criteria": [{"name": "API", "maxScore": 10}]
    }


def test_project_eval_health_returns_ok():
    assert asyncio.run(project_eval_routes.project_eval_health()) == {"status": "ok"}