"""
Unit tests for Milestone 3: Structured Planner, Policy Validation, Bounded Autonomy,
Safe Branching, and Orchestrator Coordination.
"""

import asyncio
import json
import os
import sys
from unittest.mock import MagicMock, patch
import pytest

AI_SERVICE_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if AI_SERVICE_ROOT not in sys.path:
    sys.path.insert(0, AI_SERVICE_ROOT)

from agentic_eval.config import ConfigOverride
from agentic_eval.orchestrator import AgenticOrchestrator
from agentic_eval.planner import PlanPolicyValidator, PlanPolicyViolationError, Planner
from agentic_eval.schemas import (
    ExecutionPlan,
    PlanStep,
    StepStatus,
    WorkflowType,
)
from agentic_eval.state import RunContext
from agentic_eval.tool_registry import default_tool_registry
from eval_validation.review_policy import EvalStatus

VALID_CRITERIA = [
    {"name": "Clarity", "maxScore": 5.0, "description": ""},
    {"name": "Technical Accuracy", "maxScore": 10.0, "description": ""},
]

VALID_STUDENT_TEXT = (
    "Dynamic programming caches sub-problem solutions to reduce redundant computation. "
    "Memoization stores results in a table for fast lookup."
)

VALID_LLM_OUTPUT = {
    "overallScore": 14.0,
    "criteria": [
        {"name": "Clarity", "score": 4.5, "maxScore": 5.0, "feedback": "Clear phrasing.", "evidence": "caches sub-problem solutions"},
        {"name": "Technical Accuracy", "score": 9.5, "maxScore": 10.0, "feedback": "Accurate concepts.", "evidence": "Memoization stores results in a table"},
    ],
    "requiredConcepts": ["dynamic programming"],
    "strengths": ["Clear"],
    "weakAreas": [],
    "mistakes": [],
    "missingConcepts": [],
    "missingKeyPoints": [],
    "conceptsCovered": ["dynamic programming"],
    "scoreExplanation": "Very good.",
    "feedback": "Strong work.",
    "confidence": 0.95,
}


def _make_mock_llm_response(payload_dict):
    mock = MagicMock()
    mock.content = json.dumps(payload_dict)
    return mock


class TestPlanPolicyValidator:
    def test_valid_individual_plan_passes(self):
        planner = Planner(default_tool_registry)
        plan = planner.build_plan(WorkflowType.INDIVIDUAL_ASSIGNMENT, mode=1)
        valid, errors = PlanPolicyValidator.validate_plan(plan, default_tool_registry)
        assert valid is True
        assert errors == []

    def test_valid_batch_plan_has_archive_validation_first(self):
        planner = Planner(default_tool_registry)
        plan = planner.build_plan(WorkflowType.BATCH_ASSIGNMENT, mode=1)
        valid, errors = PlanPolicyValidator.validate_plan(plan, default_tool_registry)
        assert valid is True
        tools = [s.tool for s in plan.steps]
        assert tools.index("validate_zip_archive") < tools.index("extract_submission_text")

    def test_plan_with_inverted_zip_order_is_rejected(self):
        plan = ExecutionPlan(
            plan_id="p1",
            workflow=WorkflowType.BATCH_ASSIGNMENT,
            mode=1,
            steps=[
                PlanStep("s1", "extract_submission_text", "extracting first without checking zip"),
                PlanStep("s2", "validate_zip_archive", "validating late"),
            ],
        )
        valid, errors = PlanPolicyValidator.validate_plan(plan, default_tool_registry)
        assert valid is False
        assert any("precede" in e for e in errors)

    def test_plan_with_unregistered_tool_is_rejected(self):
        plan = ExecutionPlan(
            plan_id="p2",
            workflow=WorkflowType.INDIVIDUAL_ASSIGNMENT,
            mode=1,
            steps=[
                PlanStep("s1", "malicious_unregistered_tool", "exploit"),
            ],
        )
        valid, errors = PlanPolicyValidator.validate_plan(plan, default_tool_registry)
        assert valid is False
        assert any("unregistered" in e for e in errors)


class TestSafeBranching:
    def test_branch_on_zip_security_failure(self):
        planner = Planner(default_tool_registry)
        ctx = RunContext(workflow_type=WorkflowType.BATCH_ASSIGNMENT)
        step = PlanStep("s1", "validate_zip_archive", "check zip")
        res = {"valid": False, "errors": ["Zip-slip detected"]}
        branch = planner.evaluate_branch_condition(step, res, ctx)
        assert branch == "FAIL:ZIP_SECURITY_REJECTED"

    def test_branch_on_empty_submission(self):
        planner = Planner(default_tool_registry)
        ctx = RunContext(workflow_type=WorkflowType.INDIVIDUAL_ASSIGNMENT)
        step = PlanStep("s1", "validate_submission_input", "check input")
        res = {"valid": False, "isEmpty": True}
        branch = planner.evaluate_branch_condition(step, res, ctx)
        assert branch == "FAIL:EMPTY_SUBMISSION"

    def test_branch_on_injection_flags_review(self):
        planner = Planner(default_tool_registry)
        ctx = RunContext(workflow_type=WorkflowType.INDIVIDUAL_ASSIGNMENT)
        step = PlanStep("s1", "validate_submission_input", "check input")
        res = {"valid": True, "isEmpty": False, "injectionDetected": True}
        branch = planner.evaluate_branch_condition(step, res, ctx)
        assert branch is None
        assert "INJECTION_DETECTED" in ctx.review_flags


class TestAgenticOrchestratorExecution:
    @patch("assignment_evaluation.pipelines.orchestrator.ChatGroq")
    def test_orchestrator_baseline_fallback_when_disabled(self, MockGroq):
        MockGroq.return_value.invoke.return_value = _make_mock_llm_response(VALID_LLM_OUTPUT)
        orchestrator = AgenticOrchestrator()
        rubric_pkg = {"criteria": VALID_CRITERIA, "rubricText": "Clarity 5, Accuracy 10"}

        with ConfigOverride(eval_enabled=False):
            res = asyncio.run(orchestrator.evaluate_single_assignment(
                student_text=VALID_STUDENT_TEXT,
                rubric_package=rubric_pkg,
                student_name="Alice",
                file_name="alice.txt",
            ))

        assert res["success"] is True
        assert res["score"] == pytest.approx(14.0, abs=0.01)
        assert "agenticExecution" not in res  # Clean baseline response

    @patch("assignment_evaluation.pipelines.orchestrator.ChatGroq")
    def test_orchestrator_agentic_flow_when_enabled(self, MockGroq):
        MockGroq.return_value.invoke.return_value = _make_mock_llm_response(VALID_LLM_OUTPUT)
        orchestrator = AgenticOrchestrator()
        rubric_pkg = {"criteria": VALID_CRITERIA, "rubricText": "Clarity 5, Accuracy 10"}

        with ConfigOverride(eval_enabled=True, mode=2):
            ctx = RunContext(workflow_type=WorkflowType.INDIVIDUAL_ASSIGNMENT)
            res = asyncio.run(orchestrator.evaluate_single_assignment(
                student_text=VALID_STUDENT_TEXT,
                rubric_package=rubric_pkg,
                student_name="Bob",
                file_name="bob.txt",
                context=ctx,
            ))

        assert res["success"] is True
        assert res["score"] == pytest.approx(14.0, abs=0.01)
        assert res["maxScore"] == 15.0
        assert "agenticExecution" in res
        assert res["agenticExecution"]["mode"] == 2
        assert ctx.current_state == EvalStatus.COMPLETED
        assert len(ctx.completed_steps) >= 5

    @patch("assignment_evaluation.pipelines.orchestrator.ChatGroq")
    def test_orchestrator_valid_score_without_evidence_requires_review(self, MockGroq):
        MockGroq.return_value.invoke.return_value = _make_mock_llm_response({
            **VALID_LLM_OUTPUT,
            "criteria": [
                {key: value for key, value in item.items() if key != "evidence"}
                for item in VALID_LLM_OUTPUT["criteria"]
            ],
        })
        orchestrator = AgenticOrchestrator()
        rubric_pkg = {"criteria": VALID_CRITERIA, "rubricText": "Clarity 5, Accuracy 10"}

        with ConfigOverride(eval_enabled=True, mode=2):
            ctx = RunContext(workflow_type=WorkflowType.INDIVIDUAL_ASSIGNMENT)
            result = asyncio.run(orchestrator.evaluate_single_assignment(
                student_text=VALID_STUDENT_TEXT,
                rubric_package=rubric_pkg,
                context=ctx,
            ))

        assert result["overallScore"] == pytest.approx(14.0)
        assert result["needsReview"] is True
        assert "MISSING_EVIDENCE_CITATIONS" in result["reviewFlags"]
        assert ctx.current_state == EvalStatus.NEEDS_REVIEW
