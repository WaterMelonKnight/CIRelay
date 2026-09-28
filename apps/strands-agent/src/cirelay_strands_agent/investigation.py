"""Explicit state and guardrails for CIRelay CI investigation loops.

This module is intentionally model- and provider-neutral. It owns durable
investigation state transitions; a planner decides the next action and an executor
turns CIRelay tool results into observations.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Literal

InvestigationPhase = Literal[
    "resolving-run",
    "gathering-context",
    "investigating",
    "completed",
    "escalated",
]
ActionKind = Literal[
    "list_ci_runs",
    "get_failure_context",
    "search_job_logs",
    "stop",
    "escalate",
]
EvidenceSource = Literal["ci-run", "failure-context", "log-search"]
HypothesisStatus = Literal["open", "supported", "rejected"]
DiagnosisStatus = Literal["completed", "escalated"]


@dataclass(frozen=True)
class Evidence:
    """One normalized observed fact retained by the investigation state."""

    id: str
    source: EvidenceSource
    message: str
    job_id: str | None = None
    line_number: int | None = None
    category: str | None = None


@dataclass(frozen=True)
class Hypothesis:
    """An agent interpretation kept separate from observed evidence."""

    id: str
    statement: str
    status: HypothesisStatus = "open"
    supporting_evidence_ids: tuple[str, ...] = ()
    contradicting_evidence_ids: tuple[str, ...] = ()


@dataclass(frozen=True)
class InvestigationAction:
    """A bounded action requested by the planner."""

    kind: ActionKind
    arguments: dict[str, Any] = field(default_factory=dict)
    rationale: str = ""

    def signature(self) -> str:
        """Stable signature used to detect an unproductive repeated action."""

        return json.dumps(
            {"kind": self.kind, "arguments": self.arguments},
            sort_keys=True,
            separators=(",", ":"),
            default=str,
        )


@dataclass(frozen=True)
class InvestigationObservation:
    """Normalized result of one CIRelay action."""

    action: ActionKind
    summary: str
    evidence: tuple[Evidence, ...] = ()
    resolved_run_id: str | None = None


@dataclass(frozen=True)
class ActionRecord:
    """Audit record for one action/observation transition."""

    kind: ActionKind
    signature: str
    summary: str
    evidence_added: int
    made_progress: bool


@dataclass
class InvestigationState:
    """Mutable state owned by the investigation controller, not by the model."""

    task: str
    repository: str
    phase: InvestigationPhase = "resolving-run"
    run_id: str | None = None
    evidence: list[Evidence] = field(default_factory=list)
    hypotheses: list[Hypothesis] = field(default_factory=list)
    history: list[ActionRecord] = field(default_factory=list)
    step_count: int = 0
    no_progress_steps: int = 0
    stop_reason: str | None = None
    escalation_reason: str | None = None


@dataclass(frozen=True)
class InvestigationLimits:
    """Hard loop limits independent from planner/model behavior."""

    max_steps: int = 8
    max_no_progress_steps: int = 2
    max_same_action: int = 2


@dataclass(frozen=True)
class StructuredDiagnosis:
    """Terminal output contract for a CI investigation."""

    status: DiagnosisStatus
    task: str
    repository: str
    run_id: str | None
    summary: str
    observed_evidence: tuple[Evidence, ...]
    hypotheses: tuple[Hypothesis, ...]
    reason: str
    next_action: str | None = None


def start_investigation(task: str, repository: str) -> InvestigationState:
    if not task.strip():
        raise ValueError("task must not be empty")
    if "/" not in repository:
        raise ValueError("repository must be in owner/name form")
    return InvestigationState(task=task, repository=repository)


def apply_observation(
    state: InvestigationState,
    action: InvestigationAction,
    observation: InvestigationObservation,
) -> None:
    """Apply one tool observation and update progress bookkeeping."""

    if state.phase in {"completed", "escalated"}:
        raise ValueError("cannot apply observations to a terminal investigation")
    if action.kind != observation.action:
        raise ValueError("observation action does not match requested action")

    previous_run_id = state.run_id
    existing_ids = {item.id for item in state.evidence}
    added = 0
    for item in observation.evidence:
        if item.id in existing_ids:
            continue
        state.evidence.append(item)
        existing_ids.add(item.id)
        added += 1

    if observation.resolved_run_id is not None:
        state.run_id = observation.resolved_run_id

    made_progress = added > 0 or state.run_id != previous_run_id
    state.no_progress_steps = 0 if made_progress else state.no_progress_steps + 1
    state.step_count += 1
    state.history.append(
        ActionRecord(
            kind=action.kind,
            signature=action.signature(),
            summary=observation.summary,
            evidence_added=added,
            made_progress=made_progress,
        )
    )

    if action.kind == "list_ci_runs":
        state.phase = "gathering-context" if state.run_id else "resolving-run"
    elif action.kind in {"get_failure_context", "search_job_logs"}:
        state.phase = "investigating"


def replace_hypotheses(
    state: InvestigationState, hypotheses: list[Hypothesis]
) -> None:
    if state.phase in {"completed", "escalated"}:
        raise ValueError("cannot update hypotheses on a terminal investigation")
    state.hypotheses = list(hypotheses)


def mark_completed(state: InvestigationState, reason: str) -> None:
    if not reason.strip():
        raise ValueError("completion reason must not be empty")
    state.phase = "completed"
    state.stop_reason = reason
    state.escalation_reason = None


def mark_escalated(state: InvestigationState, reason: str) -> None:
    if not reason.strip():
        raise ValueError("escalation reason must not be empty")
    state.phase = "escalated"
    state.escalation_reason = reason
    state.stop_reason = None


def guardrail_reason(
    state: InvestigationState,
    next_action: InvestigationAction | None = None,
    limits: InvestigationLimits = InvestigationLimits(),
) -> str | None:
    """Return the deterministic reason the controller must stop/escalate."""

    if state.phase == "completed":
        return state.stop_reason or "investigation-completed"
    if state.phase == "escalated":
        return state.escalation_reason or "investigation-escalated"
    if state.step_count >= limits.max_steps:
        return "max-steps-reached"
    if state.no_progress_steps >= limits.max_no_progress_steps:
        return "no-progress-limit-reached"
    if next_action is None:
        return None

    signature = next_action.signature()
    consecutive = 0
    for item in reversed(state.history):
        if item.signature != signature:
            break
        consecutive += 1
    if consecutive >= limits.max_same_action:
        return "repeated-action-limit-reached"
    return None


def build_structured_diagnosis(
    state: InvestigationState,
    summary: str,
    next_action: str | None = None,
) -> StructuredDiagnosis:
    """Build a terminal diagnosis without collapsing evidence into inference."""

    if state.phase not in {"completed", "escalated"}:
        raise ValueError("structured diagnosis requires a terminal investigation")
    reason = (
        state.stop_reason
        if state.phase == "completed"
        else state.escalation_reason
    )
    status: DiagnosisStatus = (
        "completed" if state.phase == "completed" else "escalated"
    )
    return StructuredDiagnosis(
        status=status,
        task=state.task,
        repository=state.repository,
        run_id=state.run_id,
        summary=summary,
        observed_evidence=tuple(state.evidence),
        hypotheses=tuple(state.hypotheses),
        reason=reason or "unspecified",
        next_action=next_action,
    )
