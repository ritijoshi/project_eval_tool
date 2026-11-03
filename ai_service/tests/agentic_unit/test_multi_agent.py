"""
Unit tests for Milestone 4 (Auditable Reasoning) and Milestone 5 (Multi-Agent Collaboration).
Tests specialist agent roles: Coordinator, Evidence Auditor, Critic Reviewer,
and Deterministic Finalizer.
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

from agentic_eval.agents import CriticAgent, EvidenceAuditorAgent
from agentic_eval.config import ConfigOverride
from agentic_eval.orchestrator import AgenticOrchestrator
from agentic_eval.schemas import AgentOutput, WorkflowType
from agentic_eval.state import RunContext
from eval_validation.review_policy import EvalStatus

STUDENT_TEXT = (
    "Dynamic programming caches sub-problem solutions to reduce redundant computation. "
    "Memoization stores results in a table for fast lookup."
)

VALID_CRITERIA = [
    {"name": "Clarity", "maxScore": 5.0},
    {"name": "Accuracy", "maxScore": 10.0},
]


class TestEvidenceAuditor:
    def test_auditor_agrees_when_evidence_matches(self):
        auditor = EvidenceAuditorAgent()
        eval_output = {
            "scoreBreakdown": {
                "Clarity": {"score": 4.5, "evidence": "Dynamic programming caches sub-problem solutions"},
                "Accuracy": {"score": 9.0, "evidence": "Memoization stores results in a table for fast lookup"},
            }
        }
        res = auditor.audit_submission_evidence(STUDENT_TEXT, eval_output, VALID_CRITERIA)
        assert res.role == "EvidenceAuditor"
        assert res.decision == "CONTINUE"
        assert len(res.flags) == 0
        assert "verified" in res.rationale.lower()

    def test_auditor_flags_review_when_evidence_is_fabricated(self):
        auditor = EvidenceAuditorAgent()
        eval_output = {
            "scoreBreakdown": {
                "Clarity": {"score": 4.5, "evidence": "Completely fabricated quote about neural networks"},
            }
        }
        res = auditor.audit_submission_evidence(STUDENT_TEXT, eval_output, VALID_CRITERIA)
        assert res.decision == "NEEDS_REVIEW"
        assert "UNVERIFIED_EVIDENCE" in res.flags
        assert len(res.findings) >= 1


class TestCriticReviewer:
    def test_critic_confirms_coherent_evaluation(self):
        critic = CriticAgent()
        eval_output = {
            "overallScore": 14.0,
            "maxScore": 15.0,
            "confidence": 0.90,
            "scoreBreakdown": {
                "Clarity": {"score": 4.5, "maxScore": 5.0, "reason": "Clear explanation of dynamic programming"},
                "Accuracy": {"score": 9.5, "maxScore": 10.0, "reason": "Technically accurate discussion of memoization"},
            }
        }
        res = critic.review_evaluation(STUDENT_TEXT, eval_output)
        assert res.role == "CriticReviewer"
        assert res.decision == "CONTINUE"
        assert len(res.flags) == 0

    def test_critic_flags_score_feedback_contradiction(self):
        critic = CriticAgent()
        eval_output = {
            "overallScore": 5.0,
            "maxScore": 15.0,
            "confidence": 0.85,
            "scoreBreakdown": {
                "Clarity": {
                    "score": 5.0,
                    "maxScore": 5.0,
                    # High score contradicted by negative feedback
                    "reason": "Completely missing explanation, incorrect and failed attempt.",
                },
            }
        }
        res = critic.review_evaluation(STUDENT_TEXT, eval_output)
        assert res.decision == "NEEDS_REVIEW"
        assert "CONTRADICTION_HIGH_SCORE_NEGATIVE_FEEDBACK" in res.flags

    def test_critic_flags_disagreement_with_auditor(self):
        critic = CriticAgent()
        eval_output = {
            "overallScore": 14.0,
            "maxScore": 15.0,
            "confidence": 0.90,
            "scoreBreakdown": {
                "Clarity": {"score": 4.5, "maxScore": 5.0, "reason": "Good"},
            }
        }
        auditor_flagged = AgentOutput(
            role="EvidenceAuditor",
            decision="NEEDS_REVIEW",
            rationale="Evidence not grounded",
            flags=["UNVERIFIED_EVIDENCE", "LOW_EVIDENCE_VERIFICATION_RATE"],
        )
        res = critic.review_evaluation(STUDENT_TEXT, eval_output, auditor_output=auditor_flagged)
        assert res.decision == "NEEDS_REVIEW"
        assert any("CRITIC_DISAGREEMENT" in f for f in res.flags)


class TestMultiAgentOrchestrationMode:
    @patch("assignment_evaluation.pipelines.orchestrator.ChatGroq")
    def test_multi_agent_collaboration_agreement_case(self, MockGroq):
        """Ordinary case: Evaluator + Auditor + Critic agree -> COMPLETED."""
        mock_resp = {
            "overallScore": 14.0,
            "criteria": [
                {"name": "Clarity", "score": 4.5, "maxScore": 5.0, "feedback": "Clear explanation of dynamic programming.", "evidence": "caches sub-problem solutions"},
                {"name": "Accuracy", "score": 9.5, "maxScore": 10.0, "feedback": "Accurate description of memoization.", "evidence": "Memoization stores results in a table"},
            ],
            "requiredConcepts": ["dynamic programming"],
            "strengths": ["Strong understanding"],
            "weakAreas": [],
            "mistakes": [],
            "missingConcepts": [],
            "missingKeyPoints": [],
            "conceptsCovered": ["dynamic programming"],
            "scoreExplanation": "Very good performance.",
            "feedback": "Well done.",
            "confidence": 0.95,
        }
        mock = MagicMock()
        mock.content = json.dumps(mock_resp)
        MockGroq.return_value.invoke.return_value = mock

        orchestrator = AgenticOrchestrator()
        rubric_pkg = {"criteria": VALID_CRITERIA, "rubricText": "Clarity 5, Accuracy 10"}

        with ConfigOverride(eval_enabled=True, mode=3, multi_agent_enabled=True):
            ctx = RunContext(workflow_type=WorkflowType.INDIVIDUAL_ASSIGNMENT)
            res = asyncio.run(orchestrator.evaluate_single_assignment(
                student_text=STUDENT_TEXT,
                rubric_package=rubric_pkg,
                student_name="Charlie",
                file_name="charlie.txt",
                context=ctx,
            ))

        assert res["success"] is True
        assert res["needsReview"] is False
        assert ctx.current_state == EvalStatus.COMPLETED
        # Check specialist agents telemetry
        specialists = res["agenticExecution"]["specialistAgents"]
        assert "evidenceAuditor" in specialists
        assert "criticReviewer" in specialists
        assert specialists["evidenceAuditor"]["decision"] == "CONTINUE"
        assert specialists["criticReviewer"]["decision"] == "CONTINUE"

    @patch("assignment_evaluation.pipelines.orchestrator.ChatGroq")
    def test_multi_agent_collaboration_disagreement_case(self, MockGroq):
        """Ambiguous/adversarial case: Contradictory critique -> routes to NEEDS_REVIEW."""
        mock_resp = {
            "overallScore": 14.0,
            "criteria": [
                # Contradictory feedback: perfect score but says completely failed
                {"name": "Clarity", "score": 5.0, "maxScore": 5.0, "feedback": "Completely failed, missing all details.", "evidence": "caches sub-problem solutions"},
                {"name": "Accuracy", "score": 9.0, "maxScore": 10.0, "feedback": "Good memoization.", "evidence": "Memoization stores results in a table"},
            ],
            "requiredConcepts": [],
            "strengths": [],
            "weakAreas": [],
            "mistakes": [],
            "missingConcepts": [],
            "missingKeyPoints": [],
            "conceptsCovered": [],
            "scoreExplanation": "Review required.",
            "feedback": "Needs professor review due to conflicting signals.",
            "confidence": 0.70,
        }
        mock = MagicMock()
        mock.content = json.dumps(mock_resp)
        MockGroq.return_value.invoke.return_value = mock

        orchestrator = AgenticOrchestrator()
        rubric_pkg = {"criteria": VALID_CRITERIA, "rubricText": "Clarity 5, Accuracy 10"}

        with ConfigOverride(eval_enabled=True, mode=3, multi_agent_enabled=True):
            ctx = RunContext(workflow_type=WorkflowType.INDIVIDUAL_ASSIGNMENT)
            res = asyncio.run(orchestrator.evaluate_single_assignment(
                student_text=STUDENT_TEXT,
                rubric_package=rubric_pkg,
                student_name="Eve",
                file_name="eve.txt",
                context=ctx,
            ))

        assert res["success"] is True
        # Critic must have caught contradiction and routed to review!
        assert res["needsReview"] is True
        assert ctx.current_state == EvalStatus.NEEDS_REVIEW
        specialists = res["agenticExecution"]["specialistAgents"]
        assert specialists["criticReviewer"]["decision"] == "NEEDS_REVIEW"
        assert any("CONTRADICTION" in f for f in res["reviewFlags"])

