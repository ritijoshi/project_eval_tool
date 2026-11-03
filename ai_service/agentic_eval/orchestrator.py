"""
Agentic Evaluation Orchestrator.
Coordinates the bounded execution of evaluation plans, allowlisted tools,
specialist critic reviews, state transitions, and deterministic final scoring.
Seamlessly falls back to the known-good baseline when agentic mode is disabled.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List, Optional

from agentic_eval.config import get_config
from agentic_eval.planner import Planner
from agentic_eval.schemas import (
    ActorType,
    ExecutionPlan,
    StepStatus,
    WorkflowType,
)
from agentic_eval.state import BudgetExceededError, RunContext
from agentic_eval.tool_registry import ToolRegistry, default_tool_registry
from agentic_eval.traces import trace_manager
from eval_validation.review_policy import EvalStatus

logger = logging.getLogger("agentic_eval.orchestrator")


class AgenticOrchestrator:
    """Bounded, observable coordinator for agentic evaluations."""

    def __init__(
        self,
        registry: ToolRegistry = default_tool_registry,
        planner: Optional[Planner] = None,
    ):
        self.registry = registry
        self.planner = planner or Planner(registry)

    async def evaluate_single_assignment(
        self,
        student_text: str,
        rubric_package: Dict[str, Any],
        assignment_type: str = "text",
        student_name: str = "Student",
        file_name: str = "submission.txt",
        context: Optional[RunContext] = None,
    ) -> Dict[str, Any]:
        """
        Evaluates a single assignment submission.
        If AGENTIC_EVAL_ENABLED=false, delegates directly to baseline evaluator.
        """
        cfg = get_config()
        if not cfg.eval_enabled:
            # Baseline fast-path (Zero overhead, zero regression)
            from assignment_evaluation.pipelines.orchestrator import evaluate_single_submission_with_llm
            return await evaluate_single_submission_with_llm(
                student_text=student_text,
                rubric_package=rubric_package,
                assignment_type=assignment_type,
                student_name=student_name,
                file_name=file_name,
            )

        # ─── Agentic Execution Path ──────────────────────────────────────────
        ctx = context or RunContext(
            workflow_type=WorkflowType.INDIVIDUAL_ASSIGNMENT,
            submission_id=f"{student_name}_{file_name}",
        )
        ctx.model_name = cfg.budgets.max_plan_steps  # metadata

        plan = self.planner.build_plan(
            workflow=WorkflowType.INDIVIDUAL_ASSIGNMENT,
            mode=cfg.mode,
        )
        ctx.plan = plan

        ctx.record_audit_event(
            action="PLAN_CREATED",
            rationale=f"Created structured plan with {len(plan.steps)} steps in Mode {cfg.mode}",
            actor_type=ActorType.DETERMINISTIC,
            next_step="VALIDATING",
        )

        try:
            # 1. State: RECEIVED -> VALIDATING
            ctx.transition_to(EvalStatus.VALIDATING, "Beginning input and rubric validation")

            # Step 1: validate_rubric
            raw_criteria = rubric_package.get("criteria", [])
            rubric_res = await self.registry.invoke("validate_rubric", {"criteria": raw_criteria}, ctx)
            if not rubric_res.get("valid"):
                raise ValueError(f"Rubric validation failed: {'; '.join(rubric_res.get('errors', []))}")
            ctx.rubric_snapshot_id = rubric_res.get("snapshotId")
            ctx.completed_steps.append("validate_rubric")

            # Step 2: validate_submission_input
            input_res = await self.registry.invoke(
                "validate_submission_input",
                {"student_text": student_text, "file_name": file_name},
                ctx
            )
            ctx.completed_steps.append("validate_submission_input")

            # Evaluate branch condition for input
            branch = self.planner.evaluate_branch_condition(plan.steps[1], input_res, ctx)
            if branch == "FAIL:EMPTY_SUBMISSION":
                raise ValueError(f"No extractable student answer found for {file_name}")

            # 2. State: VALIDATING -> EVALUATING
            ctx.transition_to(EvalStatus.EVALUATING, "Invoking rubric evaluation")

            # Step 3: evaluate_against_rubric
            eval_res = await self.registry.invoke(
                "evaluate_against_rubric",
                {
                    "student_text": student_text,
                    "rubric_package": rubric_package,
                    "assignment_type": assignment_type,
                    "student_name": student_name,
                    "file_name": file_name,
                },
                ctx
            )
            ctx.completed_steps.append("evaluate_against_rubric")

            # 3. State: EVALUATING -> VALIDATING_RESULT
            ctx.transition_to(EvalStatus.VALIDATING_RESULT, "Checking output criteria and evidence verification")

            # Step 4: verify_evidence_spans
            cited_spans: List[str] = []
            breakdown = eval_res.get("scoreBreakdown", {})
            for crit_name, crit_data in breakdown.items():
                if isinstance(crit_data, dict) and crit_data.get("evidence"):
                    cited_spans.append(crit_data["evidence"])

            evidence_res = await self.registry.invoke(
                "verify_evidence_spans",
                {"student_text": student_text, "cited_spans": cited_spans},
                ctx
            )
            ctx.completed_steps.append("verify_evidence_spans")
            self.planner.evaluate_branch_condition(plan.steps[3], evidence_res, ctx)
            if not evidence_res.get("verificationAvailable", False):
                ctx.add_review_flag("MISSING_EVIDENCE_CITATIONS")

            # ─── Multi-Agent Specialist Collaboration (Mode 3 / selective Mode 2) ─
            specialist_results: Dict[str, Any] = {}
            if cfg.mode >= 3 or cfg.multi_agent_enabled or (cfg.mode >= 2 and cfg.critic_enabled):
                from agentic_eval.agents import CriticAgent, EvidenceAuditorAgent

                auditor = EvidenceAuditorAgent()
                auditor_out = auditor.audit_submission_evidence(student_text, eval_res, raw_criteria)
                specialist_results["evidenceAuditor"] = auditor_out.to_dict()

                ctx.record_audit_event(
                    action="SPECIALIST_AGENT:EvidenceAuditor",
                    rationale=auditor_out.rationale,
                    actor_type=ActorType.DETERMINISTIC,
                    evidence_references=[s["span"] for s in auditor_out.evidence_spans if isinstance(s, dict)],
                    outcome=auditor_out.decision,
                )
                if auditor_out.decision == "NEEDS_REVIEW":
                    for flg in auditor_out.flags:
                        ctx.add_review_flag(flg)

                critic = CriticAgent()
                critic_out = critic.review_evaluation(student_text, eval_res, auditor_out, raw_criteria)
                specialist_results["criticReviewer"] = critic_out.to_dict()

                ctx.record_audit_event(
                    action="SPECIALIST_AGENT:CriticReviewer",
                    rationale=critic_out.rationale,
                    actor_type=ActorType.DETERMINISTIC,
                    outcome=critic_out.decision,
                )
                if critic_out.decision == "NEEDS_REVIEW":
                    for flg in critic_out.flags:
                        ctx.add_review_flag(flg)

            # Step 5: calculate_final_score (Deterministic application-side calculation)
            criteria_scores_list = [
                {
                    "name": name,
                    "score": data.get("score", 0.0),
                    "maxScore": data.get("maxScore", 0.0),
                    "reason": data.get("reason", ""),
                    "evidence": data.get("evidence", ""),
                }
                for name, data in breakdown.items()
                if isinstance(data, dict)
            ]
            score_res = await self.registry.invoke(
                "calculate_final_score",
                {"criteria_scores": criteria_scores_list},
                ctx
            )
            ctx.completed_steps.append("calculate_final_score")

            # Step 6: run_quality_checks
            quality_res = await self.registry.invoke(
                "run_quality_checks",
                {
                    "output_payload": eval_res,
                    "criteria": raw_criteria,
                    "confidence": eval_res.get("confidence"),
                    "injection_detected": input_res.get("injectionDetected", False),
                    "extraction_short": input_res.get("isShort", False),
                },
                ctx
            )
            ctx.completed_steps.append("run_quality_checks")
            self.planner.evaluate_branch_condition(plan.steps[-1], quality_res, ctx)

            # 4. Final State Decision
            needs_review = quality_res.get("needsReview", False) or bool(ctx.review_flags)
            score_valid = (
                isinstance(score_res.get("totalScore"), (int, float))
                and isinstance(score_res.get("maxScore"), (int, float))
                and score_res["maxScore"] > 0
                and bool(score_res.get("breakdown"))
            )
            if not score_valid:
                ctx.add_review_flag("MISSING_FINAL_SCORE")
                needs_review = True
            final_status = EvalStatus.NEEDS_REVIEW if needs_review else EvalStatus.COMPLETED
            ctx.transition_to(final_status, "Final checks complete", ActorType.DETERMINISTIC)

            # Update evidence verified flags in breakdown
            verified_map = {item["span"]: True for item in evidence_res.get("verified", [])}
            final_breakdown = score_res.get("breakdown", {})
            for name, entry in final_breakdown.items():
                ev = entry.get("evidence", "")
                entry["evidenceVerified"] = verified_map.get(ev, False) if ev else None

            final_payload = {
                "score": score_res["totalScore"],
                "overallScore": score_res["totalScore"],
                "maxScore": score_res["maxScore"],
                "gradeLabel": score_res["gradeLabel"],
                "confidence": eval_res.get("confidence"),
                "scoreBreakdown": final_breakdown,
                "requiredConcepts": eval_res.get("requiredConcepts", []),
                "strengths": eval_res.get("strengths", []),
                "weakAreas": eval_res.get("weakAreas", []),
                "mistakes": eval_res.get("mistakes", []),
                "missingConcepts": eval_res.get("missingConcepts", []),
                "missingKeyPoints": eval_res.get("missingKeyPoints", []),
                "conceptsCovered": eval_res.get("conceptsCovered", []),
                "scoreExplanation": eval_res.get("scoreExplanation", ""),
                "overallFeedback": eval_res.get("overallFeedback", ""),
                "submissionType": assignment_type or "text",
                "success": True,
                "needsReview": needs_review,
                "reviewFlags": ctx.review_flags,
                "injectionDetected": input_res.get("injectionDetected", False),
                "retryCount": 0,
                # Agentic telemetry additions
                "agenticExecution": {
                    "mode": cfg.mode,
                    "runId": ctx.run_id,
                    "planId": plan.plan_id,
"planSteps": [
                        {
                            **step.to_dict(),
                            "status": (
                                "COMPLETED"
                                if step.tool in ctx.completed_steps
                                else "FAILED"
                            ),
                        }
                        for step in plan.steps
                    ],
                    "toolInvocations": [call.to_dict() for call in ctx.tool_invocations],
                    "toolCallCount": len(ctx.tool_invocations),
                    "elapsedSeconds": round(ctx.elapsed_seconds(), 2),
                    "evidenceVerificationRate": evidence_res.get("verificationRate"),
                    "evidenceVerificationAvailable": evidence_res.get("verificationAvailable", False),
                    "verifiedEvidenceCount": evidence_res.get("verifiedCount", 0),
                    "unverifiedEvidenceCount": evidence_res.get("unverifiedCount", 0),
                    "specialistAgents": specialist_results,
                },
            }

            ctx.final_result = final_payload
            for evt in ctx.audit_events:
                trace_manager.record_event(evt)

            return final_payload

        except Exception as exc:
            logger.error(f"Agentic evaluation failed for run {ctx.run_id}: {exc}")
            if ctx.current_state != EvalStatus.FAILED:
                try:
                    ctx.transition_to(EvalStatus.FAILED, f"Failed: {exc}", ActorType.DETERMINISTIC)
                except Exception:
                    pass
            for evt in ctx.audit_events:
                trace_manager.record_event(evt)
            raise

    async def evaluate_single_summary(
        self,
        student_summary: str,
        reference_package: Dict[str, Any],
        core_concepts: Optional[List[str]] = None,
        deterministic_metrics: Optional[Dict[str, float]] = None,
        context: Optional[RunContext] = None,
    ) -> Dict[str, Any]:
        """
        Evaluates an individual summary submission.
        If AGENTIC_EVAL_ENABLED=false, delegates directly to baseline summary evaluator.
        """
        cfg = get_config()
        if not cfg.eval_enabled:
            from summary_evaluation.agents.ai_evaluator import evaluate_summary_with_ai
            return evaluate_summary_with_ai(
                student_summary=student_summary,
                reference_package=reference_package,
                core_concepts=core_concepts or reference_package.get("core_concepts", []),
                deterministic_metrics=deterministic_metrics or {},
            )

        # ─── Agentic Summary Execution Path ───────────────────────────────────
        ctx = context or RunContext(
            workflow_type=WorkflowType.INDIVIDUAL_SUMMARY,
            submission_id="summary_submission",
        )

        plan = self.planner.build_plan(
            workflow=WorkflowType.INDIVIDUAL_SUMMARY,
            mode=cfg.mode,
        )
        ctx.plan = plan

        ctx.record_audit_event(
            action="PLAN_CREATED",
            rationale=f"Created summary plan with {len(plan.steps)} steps in Mode {cfg.mode}",
            actor_type=ActorType.DETERMINISTIC,
            next_step="VALIDATING",
        )

        try:
            # 1. State: RECEIVED -> VALIDATING
            ctx.transition_to(EvalStatus.VALIDATING, "Validating summary input text")

            input_res = await self.registry.invoke(
                "validate_submission_input",
                {"student_text": student_summary, "file_name": "summary.txt"},
                ctx
            )
            ctx.completed_steps.append("validate_submission_input")

            # 2. State: VALIDATING -> EVALUATING
            ctx.transition_to(EvalStatus.EVALUATING, "Running summary AI evaluator")

            from summary_evaluation.agents.ai_evaluator import evaluate_summary_with_ai
            eval_res = await asyncio.to_thread(
                evaluate_summary_with_ai,
                student_summary=student_summary,
                reference_package=reference_package,
                core_concepts=core_concepts or reference_package.get("core_concepts", []),
                deterministic_metrics=deterministic_metrics or {},
            )
            ctx.completed_steps.append("evaluate_against_rubric")

            # 3. State: EVALUATING -> VALIDATING_RESULT
            ctx.transition_to(EvalStatus.VALIDATING_RESULT, "Checking summary output quality and review policy")

            needs_review = eval_res.get("needsReview", False) or input_res.get("injectionDetected", False)
            if input_res.get("injectionDetected"):
                ctx.add_review_flag("INJECTION_DETECTED")
            if eval_res.get("reviewFlags"):
                for rf in eval_res.get("reviewFlags"):
                    ctx.add_review_flag(rf)

            final_status = EvalStatus.NEEDS_REVIEW if needs_review else EvalStatus.COMPLETED
            ctx.transition_to(final_status, "Summary evaluation checks complete", ActorType.DETERMINISTIC)

            eval_res["agenticExecution"] = {
                "mode": cfg.mode,
                "runId": ctx.run_id,
                "planId": plan.plan_id,
                "toolCallCount": len(ctx.tool_invocations),
                "elapsedSeconds": round(ctx.elapsed_seconds(), 2),
            }
            eval_res["needsReview"] = needs_review
            eval_res["reviewFlags"] = ctx.review_flags

            ctx.final_result = eval_res
            for evt in ctx.audit_events:
                trace_manager.record_event(evt)

            return eval_res

        except Exception as exc:
            logger.error(f"Agentic summary evaluation failed for run {ctx.run_id}: {exc}")
            if ctx.current_state != EvalStatus.FAILED:
                try:
                    ctx.transition_to(EvalStatus.FAILED, f"Failed: {exc}", ActorType.DETERMINISTIC)
                except Exception:
                    pass
            for evt in ctx.audit_events:
                trace_manager.record_event(evt)
            raise


# Global orchestrator instance
default_orchestrator = AgenticOrchestrator()
