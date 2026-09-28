"""State model for the bounded CIRelay CI investigation sub-agent."""

from __future__ import annotations

from dataclasses import dataclass, replace
from enum import StrEnum
from typing import Literal

EvidenceSource = Literal[
    "run-resolution",
    "failure-context",
    "log-search",
    "raw-log",
]


class InvestigationPhase(StrEnum):
    RESOLVE_RUN = "resolve-run"
    COLLECT_EVIDENCE = "collect-evidence"
    TEST_HYPOTHESIS = "test-hypothesis"
    COMPLETE = "complete"
    ESCALATED = "escalated"


class InvestigationActionKind(StrEnum):
    LIST_RUNS = "list-ci-runs"
    GET_FAILURE_CONTEXT = "get-failure-context"
    SEARCH_JOB_LOGS = "search-job-logs"
    STOP = "stop"
    ESCALATE = "escalate"


class HypothesisStatus(StrEnum):
    ACTIVE = "active"
    SUPPORTED = "supported"
    REFUTED = "refuted"


class DiagnosisConfidence(StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class TerminationReason(StrEnum):
    SUFFICIENT_EVIDENCE = "sufficient-evidence"
    MAX_STEPS = "max-steps"
    NO_FAILED_RUN = "no-failed-run"
    TOOL_ERROR = "tool-error"
    AMBIGUOUS_EVIDENCE = "ambiguous-evidence"
    UNSUPPORTED_CAPABILITY = "unsupported-capability"


class StateTransitionError(ValueError):
    """Raised when a state transition would violate investigation invariants."""


@dataclass(frozen=True)
class EvidenceItem:
    id: str
    source: EvidenceSource
    message: str
    job_id: str | None = None
    line_number: int | None = None
    category: str | None = None


@dataclass(frozen=True)
class Hypothesis:
    id: str
    statement: str
    status: HypothesisStatus = HypothesisStatus.ACTIVE
    supporting_evidence_ids: tuple[str, ...] = ()
    contradicting_evidence_ids: tuple[str, ...] = ()


@dataclass(frozen=True)
class InvestigationAction:
    kind: InvestigationActionKind
    rationale: str
    run_id: str | None = None
    job_id: str | None = None
    patterns: tuple[str, ...] = ()


@dataclass(frozen=True)
class InvestigationStep:
    action: InvestigationAction
    observation: str
    evidence_ids: tuple[str, ...] = ()


@dataclass(frozen=True)
class StructuredDiagnosis:
    summary: str
    observed_evidence_ids: tuple[str, ...]
    inference: str
    next_action: str
    confidence: DiagnosisConfidence
    limitations: tuple[str, ...] = ()


@dataclass(frozen=True)
class InvestigationTermination:
    reason: TerminationReason
    detail: str


@dataclass(frozen=True)
class InvestigationState:
    task: str
    repository: str
    phase: InvestigationPhase = InvestigationPhase.RESOLVE_RUN
    max_steps: int = 6
    run_id: str | None = None
    evidence: tuple[EvidenceItem, ...] = ()
    hypotheses: tuple[Hypothesis, ...] = ()
    open_questions: tuple[str, ...] = ()
    steps: tuple[InvestigationStep, ...] = ()
    termination: InvestigationTermination | None = None
    diagnosis: StructuredDiagnosis | None = None

    @property
    def step_count(self) -> int:
        return len(self.steps)

    @property
    def remaining_steps(self) -> int:
        return max(0, self.max_steps - self.step_count)

    @property
    def can_continue(self) -> bool:
        return self.termination is None and self.step_count < self.max_steps


def create_investigation(
    task: str,
    repository: str,
    *,
    max_steps: int = 6,
) -> InvestigationState:
    if not task.strip():
        raise StateTransitionError("task must not be empty")
    owner, separator, name = repository.partition("/")
    if not separator or not owner or not name or "/" in name:
        raise StateTransitionError("repository must be in owner/name form")
    if max_steps < 1:
        raise StateTransitionError("max_steps must be at least 1")
    return InvestigationState(task=task, repository=repository, max_steps=max_steps)


def select_run(state: InvestigationState, run_id: str) -> InvestigationState:
    _require_active(state)
    if not run_id:
        raise StateTransitionError("run_id must not be empty")
    return replace(
        state,
        run_id=run_id,
        phase=InvestigationPhase.COLLECT_EVIDENCE,
    )


def add_evidence(
    state: InvestigationState,
    *items: EvidenceItem,
) -> InvestigationState:
    _require_active(state)
    existing = {item.id: item for item in state.evidence}
    order = [item.id for item in state.evidence]
    for item in items:
        if not item.id:
            raise StateTransitionError("evidence id must not be empty")
        if item.id not in existing:
            order.append(item.id)
        existing[item.id] = item
    return replace(
        state,
        evidence=tuple(existing[item_id] for item_id in order),
        phase=InvestigationPhase.TEST_HYPOTHESIS,
    )


def upsert_hypothesis(
    state: InvestigationState,
    hypothesis: Hypothesis,
) -> InvestigationState:
    _require_active(state)
    if not hypothesis.id:
        raise StateTransitionError("hypothesis id must not be empty")
    by_id = {item.id: item for item in state.hypotheses}
    order = [item.id for item in state.hypotheses]
    if hypothesis.id not in by_id:
        order.append(hypothesis.id)
    by_id[hypothesis.id] = hypothesis
    return replace(
        state,
        hypotheses=tuple(by_id[item_id] for item_id in order),
        phase=InvestigationPhase.TEST_HYPOTHESIS,
    )


def set_open_questions(
    state: InvestigationState,
    questions: tuple[str, ...],
) -> InvestigationState:
    _require_active(state)
    return replace(state, open_questions=questions)


def record_step(
    state: InvestigationState,
    step: InvestigationStep,
) -> InvestigationState:
    _require_active(state)
    if state.step_count >= state.max_steps:
        raise StateTransitionError("investigation step budget is exhausted")
    return replace(state, steps=(*state.steps, step))


def complete_investigation(
    state: InvestigationState,
    diagnosis: StructuredDiagnosis,
) -> InvestigationState:
    _require_active(state)
    evidence_ids = {item.id for item in state.evidence}
    if not state.evidence:
        raise StateTransitionError("cannot complete without observed evidence")
    if not any(
        item.status is HypothesisStatus.SUPPORTED for item in state.hypotheses
    ):
        raise StateTransitionError("cannot complete without a supported hypothesis")
    if state.open_questions:
        raise StateTransitionError("cannot complete while blocking questions remain")
    if not diagnosis.observed_evidence_ids:
        raise StateTransitionError("diagnosis must cite observed evidence")
    unknown = set(diagnosis.observed_evidence_ids) - evidence_ids
    if unknown:
        raise StateTransitionError(
            "diagnosis references unknown evidence ids: " + ", ".join(sorted(unknown))
        )
    return replace(
        state,
        phase=InvestigationPhase.COMPLETE,
        termination=InvestigationTermination(
            reason=TerminationReason.SUFFICIENT_EVIDENCE,
            detail="structured diagnosis is supported by recorded evidence",
        ),
        diagnosis=diagnosis,
    )


def escalate_investigation(
    state: InvestigationState,
    reason: TerminationReason,
    detail: str,
) -> InvestigationState:
    _require_active(state)
    if reason is TerminationReason.SUFFICIENT_EVIDENCE:
        raise StateTransitionError(
            "use complete_investigation for successful completion"
        )
    return replace(
        state,
        phase=InvestigationPhase.ESCALATED,
        termination=InvestigationTermination(reason=reason, detail=detail),
    )


def _require_active(state: InvestigationState) -> None:
    if state.termination is not None:
        raise StateTransitionError("investigation is already terminated")
