from project_evaluation.agents.evidence_engine import build_evidence


def test_build_evidence_maps_weekly_claims_and_preserves_health_calculation():
    repo_data = {"name": "student-project", "languages": {"Python": 100}}
    github_analysis = {
        "requirementMapping": [
            {
                "criterion": "Prediction API",
                "requirement": "Provide an API for predictions",
                "status": "COMPLETE",
                "evidence": "api.py contains a prediction endpoint",
            },
            {
                "criterion": "Automated testing",
                "requirement": "Write tests for the application",
                "status": "PARTIAL",
                "evidence": "One incomplete test file is present",
            },
            {
                "criterion": "Authentication",
                "requirement": "Implement user authentication",
                "status": "MISSING",
                "evidence": "",
            },
        ],
        "testsPresent": True,
        "documentationPresent": True,
    }
    weekly_report = {
        "workCompleted": [
            "Completed the prediction API",
            "Implemented automated testing",
            "Implemented authentication",
        ],
        "problemsFaced": ["PostgreSQL connection issues"],
        "plannedWork": ["Improve database integration"],
        "currentStatus": "API completed; tests are incomplete",
        "rawText": "Student's original report",
    }

    result = build_evidence(repo_data, github_analysis, {}, weekly_report)
    claims = result["weeklyClaimMapping"]

    assert [claim["status"] for claim in claims] == [
        "SUPPORTED",
        "PARTIAL",
        "UNSUPPORTED",
    ]
    assert claims[0]["githubEvidence"] == "api.py contains a prediction endpoint"
    assert "not misconduct findings" in claims[2]["reviewNote"]
    assert result["weeklyReport"] == weekly_report
    assert result["coverage"] == 50.0
    assert result["healthStatus"] == "BEHIND"


def test_build_evidence_without_weekly_report_keeps_empty_claim_mapping():
    result = build_evidence(
        {"name": "student-project"},
        {"requirementMapping": []},
        {},
    )

    assert result["weeklyReport"] is None
    assert result["weeklyClaimMapping"] == []
    assert result["coverage"] == 0
    assert result["healthStatus"] == "AT_RISK"