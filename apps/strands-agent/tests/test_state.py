import pytest

from cirelay_strands_agent.state import (
    DiagnosisConfidence,
    EvidenceItem,
    Hypothesis,
    HypothesisStatus,
    InvestigationAction,
    InvestigationActionKind,
    InvestigationPhase,
    InvestigationStep,
    StateTransitionError,
    StructuredDiagnosis,
    TerminationReason,
    add_evidence,
    complete_investigation,
    create_investigation,
    escalate_investigation,
    record_step,
    select_run,
    set_open_questions,
    upsert_hypothesis,
)


def test_investigation_progresses_through_explicit_state() -> None:
    state = create_investigation(
        "Investigate the latest failed CI",
        "WaterMelonKnight/CIRelay",
        max_steps=4,
    )
    assert state.phase is InvestigationPhase.RESOLVE_RUN

    state = record_step(
        state,
        InvestigationStep(
            action=InvestigationAction(
                kind=InvestigationActionKind.LIST_RUNS,
                rationale="run id is unknown",
            ),
            observation="resolved failed run 42",
        ),
    )
    state = select_run(state, "42")
    state = add_evidence(
        state,
        EvidenceItem(
            id="e1",
            source="failure-context",
            message="lint failed with no-unsafe-assignment",
            job_id="123",
            line_number=281,
            category="generic-error",
        ),
    )
    state = upsert_hypothesis(
        state,
        Hypothesis(
            id="h1",
            statement="the validate job failed in lint",
            status=HypothesisStatus.SUPPORTED,
            supporting_evidence_ids=("e1",),
        ),
    )

    diagnosis = StructuredDiagnosis(
        summary="The validate job failed during lint.",
        observed_evidence_ids=("e1",),
        inference="The CI failure is a lint/static-analysis failure.",
        next_action="Inspect the unsafe assignment at the reported location.",
        confidence=DiagnosisConfidence.HIGH,
    )
    state = complete_investigation(state, diagnosis)

    assert state.phase is InvestigationPhase.COMPLETE
    assert state.termination is not None
    assert state.termination.reason is TerminationReason.SUFFICIENT_EVIDENCE
    assert state.diagnosis == diagnosis
    assert not state.can_continue


def test_evidence_and_hypotheses_upsert_by_stable_id() -> None:
    state = create_investigation("Investigate CI", "owner/repo")
    state = add_evidence(
        state,
        EvidenceItem(id="e1", source="failure-context", message="first"),
    )
    state = add_evidence(
        state,
        EvidenceItem(id="e1", source="log-search", message="refined"),
    )
    state = upsert_hypothesis(
        state,
        Hypothesis(id="h1", statement="first hypothesis"),
    )
    state = upsert_hypothesis(
        state,
        Hypothesis(
            id="h1",
            statement="refined hypothesis",
            status=HypothesisStatus.SUPPORTED,
            supporting_evidence_ids=("e1",),
        ),
    )

    assert state.evidence == (
        EvidenceItem(id="e1", source="log-search", message="refined"),
    )
    assert state.hypotheses[0].statement == "refined hypothesis"
    assert state.hypotheses[0].status is HypothesisStatus.SUPPORTED


def test_completion_requires_supported_evidence_and_no_blocking_questions() -> None:
    state = create_investigation("Investigate CI", "owner/repo")
    diagnosis = StructuredDiagnosis(
        summary="summary",
        observed_evidence_ids=("e1",),
        inference="inference",
        next_action="next",
        confidence=DiagnosisConfidence.MEDIUM,
    )

    with pytest.raises(StateTransitionError, match="observed evidence"):
        complete_investigation(state, diagnosis)

    state = add_evidence(
        state,
        EvidenceItem(id="e1", source="failure-context", message="failure"),
    )
    with pytest.raises(StateTransitionError, match="supported hypothesis"):
        complete_investigation(state, diagnosis)

    state = upsert_hypothesis(
        state,
        Hypothesis(
            id="h1",
            statement="candidate cause",
            status=HypothesisStatus.SUPPORTED,
            supporting_evidence_ids=("e1",),
        ),
    )
    state = set_open_questions(state, ("Which dependency failed?",))
    with pytest.raises(StateTransitionError, match="blocking questions"):
        complete_investigation(state, diagnosis)


def test_step_budget_is_explicit_and_bounded() -> None:
    state = create_investigation("Investigate CI", "owner/repo", max_steps=1)
    state = record_step(
        state,
        InvestigationStep(
            action=InvestigationAction(
                kind=InvestigationActionKind.GET_FAILURE_CONTEXT,
                rationale="collect primary evidence",
                run_id="42",
            ),
            observation="context returned",
        ),
    )

    assert state.step_count == 1
    assert state.remaining_steps == 0
    assert not state.can_continue
    with pytest.raises(StateTransitionError, match="budget"):
        record_step(
            state,
            InvestigationStep(
                action=InvestigationAction(
                    kind=InvestigationActionKind.SEARCH_JOB_LOGS,
                    rationale="need more evidence",
                    job_id="123",
                    patterns=("error",),
                ),
                observation="search returned",
            ),
        )


def test_escalation_is_terminal_and_distinct_from_success() -> None:
    state = create_investigation("Investigate CI", "owner/repo")
    state = escalate_investigation(
        state,
        TerminationReason.AMBIGUOUS_EVIDENCE,
        "two causes remain plausible after targeted search",
    )

    assert state.phase is InvestigationPhase.ESCALATED
    assert state.termination is not None
    assert state.termination.reason is TerminationReason.AMBIGUOUS_EVIDENCE
    with pytest.raises(StateTransitionError, match="already terminated"):
        select_run(state, "42")
