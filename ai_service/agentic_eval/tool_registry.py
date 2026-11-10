"""
Allowlisted Tool Registry for the Agentic Evaluation Engine.
Provides typed schemas, least-privilege workflow permissions, loop detection,
execution timeouts, structured auditing, and budget tracking.
Arbitrary code execution and unregistered tools are strictly prohibited.
"""

from __future__ import annotations

import asyncio
import inspect
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Set

from agentic_eval.schemas import (
    ActorType,
    AuditEvent,
    ToolCallRecord,
    WorkflowType,
)
from agentic_eval.state import BudgetExceededError, RunContext
from agentic_eval.traces import sanitize_payload


class ToolNotFoundError(ValueError):
    """Raised when an agent attempts to invoke an unregistered tool."""
    pass


class ToolPermissionError(PermissionError):
    """Raised when a tool is not permitted for the active evaluation workflow."""
    pass


class ToolExecutionError(RuntimeError):
    """Raised when a tool fails during execution."""
    pass


class LoopDetectedError(RuntimeError):
    """Raised when repeated identical tool calls are detected."""
    pass


@dataclass
class ToolDefinition:
    name: str
    description: str
    allowed_workflows: Set[WorkflowType]
    handler: Callable[..., Any]
    timeout_seconds: float = 30.0
    is_idempotent: bool = True
    input_fields: Dict[str, str] = field(default_factory=dict)
    output_fields: Dict[str, str] = field(default_factory=dict)


class ToolRegistry:
    """Safe, allowlisted registry of permitted tools."""

    def __init__(self):
        self._tools: Dict[str, ToolDefinition] = {}

    def register(self, tool_def: ToolDefinition) -> None:
        self._tools[tool_def.name] = tool_def

    def get(self, name: str) -> Optional[ToolDefinition]:
        return self._tools.get(name)

    def list_tools(self, workflow: Optional[WorkflowType] = None) -> List[Dict[str, Any]]:
        tools = []
        for tool in self._tools.values():
            if workflow is None or workflow in tool.allowed_workflows:
                tools.append({
                    "name": tool.name,
                    "description": tool.description,
                    "allowedWorkflows": [w.value for w in tool.allowed_workflows],
                    "inputFields": tool.input_fields,
                    "outputFields": tool.output_fields,
                    "timeoutSeconds": tool.timeout_seconds,
                })
        return tools

    def _detect_loop(self, context: RunContext, tool_name: str, args: Dict[str, Any], max_repeats: int = 3) -> None:
        """Detect consecutive or repeated identical tool invocations."""
        recent_same = 0
        for record in reversed(context.tool_invocations):
            if record.tool_name == tool_name and record.sanitized_arguments == sanitize_payload(args):
                recent_same += 1
            else:
                break
        if recent_same >= max_repeats:
            raise LoopDetectedError(
                f"Loop detected: tool '{tool_name}' invoked {recent_same + 1} consecutive times with identical arguments."
            )

    async def invoke(
        self,
        tool_name: str,
        args: Dict[str, Any],
        context: RunContext,
    ) -> Any:
        """
        Safely invoke a registered tool within an explicit RunContext.
        Enforces:
          1. Registration allowlist
          2. Workflow permission
          3. Budget limits (steps, calls, elapsed time)
          4. Loop detection
          5. Execution timeout
          6. Sanitized telemetry & audit event logging
        """
        tool = self.get(tool_name)
        if not tool:
            context.record_audit_event(
                action="UNREGISTERED_TOOL_REJECTED",
                rationale=f"Tool '{tool_name}' is not in the allowlist registry",
                actor_type=ActorType.DETERMINISTIC,
                outcome="REJECTED",
            )
            raise ToolNotFoundError(f"Tool '{tool_name}' is not permitted or registered.")

        if context.workflow_type not in tool.allowed_workflows:
            context.record_audit_event(
                action="TOOL_PERMISSION_DENIED",
                rationale=f"Tool '{tool_name}' is not allowed for workflow '{context.workflow_type.value}'",
                actor_type=ActorType.DETERMINISTIC,
                outcome="REJECTED",
            )
            raise ToolPermissionError(
                f"Tool '{tool_name}' is not permitted for workflow '{context.workflow_type.value}'"
            )

        # Budget check
        context.check_budget_limits()

        # Loop check
        self._detect_loop(context, tool_name, args)

        sanitized_args = sanitize_payload(args)
        start_time = time.monotonic()
        call_id = f"tc_{len(context.tool_invocations) + 1}_{int(start_time * 1000)}"

        try:
            # Execute with timeout
            if inspect.iscoroutinefunction(tool.handler):
                result = await asyncio.wait_for(tool.handler(**args), timeout=tool.timeout_seconds)
            else:
                result = await asyncio.wait_for(
                    asyncio.to_thread(tool.handler, **args),
                    timeout=tool.timeout_seconds
                )

            duration_ms = (time.monotonic() - start_time) * 1000
            sanitized_output = sanitize_payload(result)

            record = ToolCallRecord(
                tool_call_id=call_id,
                tool_name=tool_name,
                sanitized_arguments=sanitized_args,
                output=sanitized_output,
                duration_ms=duration_ms,
                success=True,
                error=None,
            )
            context.record_tool_call(record)

            context.record_audit_event(
                action=f"TOOL_INVOCATION:{tool_name}",
                rationale=f"Successfully executed tool {tool_name} in {duration_ms:.1f}ms",
                actor_type=ActorType.DETERMINISTIC,
                outcome="SUCCESS",
            )

            return result

        except Exception as exc:
            duration_ms = (time.monotonic() - start_time) * 1000
            err_msg = str(exc).strip()
            if not err_msg:
                err_msg = f"{type(exc).__name__}: Request timed out or terminated without an error description"

            record = ToolCallRecord(
                tool_call_id=call_id,
                tool_name=tool_name,
                sanitized_arguments=sanitized_args,
                output=None,
                duration_ms=duration_ms,
                success=False,
                error=err_msg,
            )
            context.record_tool_call(record)

            context.record_audit_event(
                action=f"TOOL_FAILURE:{tool_name}",
                rationale=f"Tool {tool_name} failed: {err_msg}",
                actor_type=ActorType.DETERMINISTIC,
                outcome="FAILED",
            )
            raise ToolExecutionError(f"Tool '{tool_name}' failed: {err_msg}") from exc


# Global registry instance
default_tool_registry = ToolRegistry()

# Ensure tools are registered
def _ensure_registered():
    try:
        import agentic_eval.tools.eval_tools  # noqa: F401
    except ImportError:
        pass

_ensure_registered()
