import asyncio
import threading
import time

from project_evaluation.pipelines import orchestrator


def _install_fake_workers(monkeypatch):
    monkeypatch.setattr(
        orchestrator,
        "get_repo_data",
        lambda github_url, rubric=None: {"name": github_url, "languages": {"Python": 100}},
    )
    monkeypatch.setattr(
        orchestrator,
        "analyze_github_repo",
        lambda repo_data, rubric: {
            "requirementMapping": [{
                "criterion": "API",
                "requirement": "Provide an API",
                "status": "COMPLETE",
                "evidence": "api.py implements an endpoint",
            }]
        },
    )
    monkeypatch.setattr(
        orchestrator,
        "generate_project_evaluation",
        lambda project_goal, rubric, evidence: {
            "overallScore": 90,
            "grade": "A",
        },
    )


def test_evaluate_project_runs_pipeline_and_reports_progress(monkeypatch):
    _install_fake_workers(monkeypatch)
    events = []
    project = {
        "project_id": "student-1",
        "project_goal": "Build a prediction API",
        "github_url": "https://github.com/example/repo",
        "rubric": {"criteria": [{"name": "API", "maxScore": 10}]},
        "weekly_report": {
            "workCompleted": ["Implemented API"],
            "problemsFaced": [],
            "plannedWork": [],
            "currentStatus": "API completed",
            "rawText": "Implemented API",
        },
    }

    result = asyncio.run(orchestrator.evaluate_project(project, events.append))

    assert result["success"] is True
    assert result["overallScore"] == 90
    assert result["evidence"]["weeklyClaimMapping"][0]["status"] == "SUPPORTED"
    assert [event["progress"] for event in events] == [5, 20, 45, 60, 75, 95, 100]
    assert events[-1]["status"] == "completed"


def test_batch_isolates_failures_and_obeys_concurrency_limit(monkeypatch):
    active = 0
    peak_active = 0
    lock = threading.Lock()

    def fake_get_repo_data(github_url, rubric=None):
        nonlocal active, peak_active
        with lock:
            active += 1
            peak_active = max(peak_active, active)
        time.sleep(0.02)
        with lock:
            active -= 1
        if github_url.endswith("/bad"):
            raise RuntimeError("GitHub unavailable")
        return {"name": github_url, "languages": {}}

    monkeypatch.setattr(orchestrator, "get_repo_data", fake_get_repo_data)
    monkeypatch.setattr(orchestrator, "analyze_github_repo", lambda repo, rubric: {"requirementMapping": []})
    monkeypatch.setattr(orchestrator, "generate_project_evaluation", lambda goal, rubric, evidence: {"overallScore": 50})
    projects = [
        {"project_id": name, "project_goal": "Goal", "github_url": f"https://github.com/x/{name}", "rubric": {"criteria": [{"name": "API", "maxScore": 10}]}}
        for name in ("one", "bad", "three")
    ]
    projects.append(None)

    results = asyncio.run(orchestrator.evaluate_projects(projects, max_concurrency=1))

    assert [result["success"] for result in results] == [True, False, True, False]
    assert results[1]["failedStage"] == "github_analysis"
    assert peak_active == 1


def test_evaluate_projects_rejects_nonpositive_concurrency():
    try:
        asyncio.run(orchestrator.evaluate_projects([], max_concurrency=0))
    except ValueError as exc:
        assert "at least 1" in str(exc)
    else:
        raise AssertionError("Expected max_concurrency validation")