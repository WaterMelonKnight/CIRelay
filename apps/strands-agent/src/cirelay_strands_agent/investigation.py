"""Explicit state contract for the CIRelay CI investigation sub-agent.

This module deliberately contains no model or provider code. It defines the
state and transition guardrails that an outer agent loop can use while CIRelay
core remains deterministic and provider-neutral.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from enum import Enum


class InvestigationStatus(str, Enum):
    ACTIVE = "active"
    STOPPED = "stopped"
    ESCALATED = "escalated"


class ActionKind(str, Enum):
    LIST_RUNS = "list-runs"
    GET_FAILURE_CONTEXT = "get-failure-context"
    SEARCH_JOB_LOGS = "search-job-logs"
    STOP = "stop"
    ESCALATE = "escalate"


class HypothesisStatus(str, Enum):
    OPEN = "open"
    SUPPORTED = "supported"
    REJECTED = "rejected"


@dataclass(frozen=True)
class InvestigationEvidence:
    """One observed fact retained by the investigation state."""

    id: str
    source: str
    message: str
    kind: str | None = None
    job_id: str | None = None
    line_number: int | None = None
    category: str | None = None


@dataclass(frozen=True)
class Hypothesis:
    """A model-generated explanation that must point back to observed evidence."""

    id: str
    statement: str
    status: HypothesisStatus = HypothesisStatus.OPEN
    evidence_ids: tuple[str, ...] = ()


@dataclass(frozen=True)
class InvestigationDecision:
    """The next action selected by the semantic reasoning layer."""

    action: ActionKind
    reason: str
    job_id: str | None = None
    patterns: tuple[str, ...] = ()
    hypothesis: Hypothesis | None = None


@dataclass(frozen=True)
class InvestigationObservation:
    """Normalized result of one CIRelay tool call."""

    action: ActionKind
    summary: str
    resolved_run_id: str | None = None
    evidence: tuple[InvestigationEvidence, ...] = ()
    tool_error: str | None = None


@dataclass(frozen=True)
class InvestigationState:
    task: str
    repository: str
    status: InvestigationStatus = InvestigationStatus.ACTIVE
    run_id: str | None = None
    failure_context_loaded: bool = False
    evidence: tuple[InvestigationEvidence, ...] = ()
    hypotheses: tuple[Hypothesis, ...] = ()
    observations: tuple[InvestigationObservation, ...] = ()
    tool_calls: int = 0
    search_calls: int = 0
    max_tool_calls: int = 6
    max_search_calls: int = 2
    termination_reason: str | None = None


class InvestigationTransitionError(ValueError):
    """Raised when a decision violates the investigation contract."""


def initial_state(
    task: str,
    repository: str,
    *,
    max_tool_calls: int = 6,
    max_search_calls: int = 2,
) -> InvestigationState:
    if not task.strip():
        raise InvestigationTransitionError("task must not be empty")
    if (
        repository.count("/") != 1
        or repository.startswith("/")
        or repository.endswith("/")
    ):
        raise InvestigationTransitionError("repository must be in owner/name form")
    if max_tool_calls < 1:
        raise InvestigationTransitionError("max_tool_calls must be positive")
    if max_search_calls < 0:
        raise InvestigationTransitionError("max_search_calls must be non-negative")
    return InvestigationState(
        task=task,
        repository=repository,
        max_tool_calls=max_tool_calls,
        max_search_calls=max_search_calls,
    )


def required_action(state: InvestigationState) -> ActionKind | None:
    """Return only the next action that can be decided without semantic reasoning."""
    if state.status is not InvestigationStatus.ACTIVE:
        return None
    if state.run_id is None:
        return ActionKind.LIST_RUNS
    if not state.failure_context_loaded:
        return ActionKind.GET_FAILURE_CONTEXT
    return None


def validate_decision(
    state: InvestigationState, decision: InvestigationDecision
) -> None:
    if state.status is not InvestigationStatus.ACTIVE:
        raise InvestigationTransitionError("investigation is already terminal")

    required = required_action(state)
    if required is not None and decision.action is not required:
        raise InvestigationTransitionError(
            f"{required.value} is required before {decision.action.value}"
        )

    if decision.action in {
        ActionKind.LIST_RUNS,
        ActionKind.GET_FAILURE_CONTEXT,
        ActionKind.SEARCH_JOB_LOGS,
    } and state.tool_calls >= state.max_tool_calls:
        raise InvestigationTransitionError("tool-call budget is exhausted")

    if decision.action is ActionKind.SEARCH_JOB_LOGS:
        if not state.failure_context_loaded:
            raise InvestigationTransitionError(
                "failure context is required before targeted log search"
            )
        if state.search_calls >= state.max_search_calls:
            raise InvestigationTransitionError("targeted-search budget is exhausted")
        if not decision.job_id:
            raise InvestigationTransitionError("targeted search requires job_id")
        if not decision.patterns:
            raise InvestigationTransitionError("targeted search requires patterns")

    if decision.action is ActionKind.STOP:
        if not state.failure_context_loaded:
            raise InvestigationTransitionError(
                "cannot stop with a diagnosis before failure context is loaded"
            )
        if not state.evidence:
            raise InvestigationTransitionError(
                "cannot stop with a diagnosis without observed evidence"
            )


def record_observation(
    state: InvestigationState,
    decision: InvestigationDecision,
    observation: InvestigationObservation,
) -> InvestigationState:
    """Apply one successful or failed tool observation to state."""
    validate_decision(state, decision)
    if decision.action not in {
        ActionKind.LIST_RUNS,
        ActionKind.GET_FAILURE_CONTEXT,
        ActionKind.SEARCH_JOB_LOGS,
    }:
        raise InvestigationTransitionError(
            "stop/escalate decisions do not produce tool observations"
        )
    if observation.action is not decision.action:
        raise InvestigationTransitionError("observation action does not match decision")

    next_state = replace(
        state,
        tool_calls=state.tool_calls + 1,
        search_calls=(
            state.search_calls + 1
            if decision.action is ActionKind.SEARCH_JOB_LOGS
            else state.search_calls
        ),
        observations=(*state.observations, observation),
    )
    if observation.tool_error:
        return next_state

    if decision.action is ActionKind.LIST_RUNS:
        if not observation.resolved_run_id:
            raise InvestigationTransitionError(
                "list-runs observation must resolve one run_id"
            )
        next_state = replace(next_state, run_id=observation.resolved_run_id)
    elif decision.action is ActionKind.GET_FAILURE_CONTEXT:
        next_state = replace(next_state, failure_context_loaded=True)

    if observation.evidence:
        next_state = replace(
            next_state,
            evidence=_merge_evidence(next_state.evidence, observation.evidence),
        )
    return _record_hypothesis(next_state, decision.hypothesis)


def terminate(
    state: InvestigationState, decision: InvestigationDecision
) -> InvestigationState:
    """Apply an explicit stop or escalation decision."""
    validate_decision(state, decision)
    if decision.action not in {ActionKind.STOP, ActionKind.ESCALATE}:
        raise InvestigationTransitionError("termination requires stop or escalate")
    status = (
        InvestigationStatus.STOPPED
        if decision.action is ActionKind.STOP
        else InvestigationStatus.ESCALATED
    )
    return replace(
        _record_hypothesis(state, decision.hypothesis),
        status=status,
        termination_reason=decision.reason,
    )


def _merge_evidence(
    existing: tuple[InvestigationEvidence, ...],
    incoming: tuple[InvestigationEvidence, ...],
) -> tuple[InvestigationEvidence, ...]:
    by_id = {item.id: item for item in existing}
    for item in incoming:
        by_id.setdefault(item.id, item)
    return tuple(by_id.values())


def _record_hypothesis(
    state: InvestigationState, hypothesis: Hypothesis | None
) -> InvestigationState:
    if hypothesis is None:
        return state
    hypotheses = {item.id: item for item in state.hypotheses}
    hypotheses[hypothesis.id] = hypothesis
    return replace(state, hypotheses=tuple(hypotheses.values()))
