import pytest

from cirelay_strands_agent.investigation import (
    ActionKind,
    Hypothesis,
    HypothesisStatus,
    InvestigationDecision,
    InvestigationEvidence,
    InvestigationObservation,
    InvestigationStatus,
    InvestigationTransitionError,
    initial_state,
    record_observation,
    required_action,
    terminate,
    validate_decision,
)


def decision(action: ActionKind, **kwargs: object) -> InvestigationDecision:
    return InvestigationDecision(action=action, reason="test", **kwargs)


def test_state_requires_run_resolution_then_failure_context() -> None:
    state = initial_state("Investigate failed CI", "WaterMelonKnight/CIRelay")
    assert required_action(state) is ActionKind.LIST_RUNS

    list_decision = decision(ActionKind.LIST_RUNS)
    state = record_observation(
        state,
        list_decision,
        InvestigationObservation(
            action=ActionKind.LIST_RUNS,
            summary="resolved latest failed run",
            resolved_run_id="42",
        ),
    )
    assert state.run_id == "42"
    assert required_action(state) is ActionKind.GET_FAILURE_CONTEXT

    context_decision = decision(ActionKind.GET_FAILURE_CONTEXT)
    state = record_observation(
        state,
        context_decision,
        InvestigationObservation(
            action=ActionKind.GET_FAILURE_CONTEXT,
            summary="lint failed",
            evidence=(
                InvestigationEvidence(
                    id="fc:job-1:281",
                    source="failure-context",
                    message="no-unsafe-assignment",
                    kind="error-line",
                    job_id="job-1",
                    line_number=281,
                    category="generic-error",
                ),
            ),
        ),
    )
    assert state.failure_context_loaded is True
    assert required_action(state) is None
    assert state.evidence[0].source == "failure-context"


def test_targeted_search_requires_context_job_and_patterns() -> None:
    state = initial_state("Investigate failed CI", "acme/app")
    with pytest.raises(InvestigationTransitionError, match="list-runs"):
        validate_decision(
            state,
            decision(
                ActionKind.SEARCH_JOB_LOGS,
                job_id="job-1",
                patterns=("postgres",),
            ),
        )

    state = record_observation(
        state,
        decision(ActionKind.LIST_RUNS),
        InvestigationObservation(
            action=ActionKind.LIST_RUNS,
            summary="run",
            resolved_run_id="7",
        ),
    )
    state = record_observation(
        state,
        decision(ActionKind.GET_FAILURE_CONTEXT),
        InvestigationObservation(
            action=ActionKind.GET_FAILURE_CONTEXT,
            summary="context",
            evidence=(
                InvestigationEvidence(
                    id="fc:1", source="failure-context", message="connection failed"
                ),
            ),
        ),
    )

    with pytest.raises(InvestigationTransitionError, match="job_id"):
        validate_decision(
            state, decision(ActionKind.SEARCH_JOB_LOGS, patterns=("x",))
        )
    with pytest.raises(InvestigationTransitionError, match="patterns"):
        validate_decision(
            state, decision(ActionKind.SEARCH_JOB_LOGS, job_id="job-1")
        )


def test_search_observation_updates_hypothesis_and_evidence() -> None:
    state = initial_state("Investigate failed CI", "acme/app")
    state = record_observation(
        state,
        decision(ActionKind.LIST_RUNS),
        InvestigationObservation(
            action=ActionKind.LIST_RUNS,
            summary="run",
            resolved_run_id="7",
        ),
    )
    state = record_observation(
        state,
        decision(ActionKind.GET_FAILURE_CONTEXT),
        InvestigationObservation(
            action=ActionKind.GET_FAILURE_CONTEXT,
            summary="context",
            evidence=(
                InvestigationEvidence(
                    id="fc:1",
                    source="failure-context",
                    message="BeanCreationException",
                ),
            ),
        ),
    )
    hypothesis = Hypothesis(
        id="h1",
        statement="database connectivity caused bean creation to fail",
        status=HypothesisStatus.SUPPORTED,
        evidence_ids=("fc:1", "search:1"),
    )
    search_decision = InvestigationDecision(
        action=ActionKind.SEARCH_JOB_LOGS,
        reason="verify the concrete connection error",
        job_id="job-1",
        patterns=("connection refused", "jdbc:"),
        hypothesis=hypothesis,
    )
    state = record_observation(
        state,
        search_decision,
        InvestigationObservation(
            action=ActionKind.SEARCH_JOB_LOGS,
            summary="found connection refusal",
            evidence=(
                InvestigationEvidence(
                    id="search:1",
                    source="log-search",
                    message="Connection refused",
                    job_id="job-1",
                    line_number=144,
                ),
            ),
        ),
    )
    assert state.search_calls == 1
    assert [item.id for item in state.evidence] == ["fc:1", "search:1"]
    assert state.hypotheses == (hypothesis,)


def test_stop_requires_observed_evidence_and_is_terminal() -> None:
    state = initial_state("Investigate failed CI", "acme/app")
    state = record_observation(
        state,
        decision(ActionKind.LIST_RUNS),
        InvestigationObservation(
            action=ActionKind.LIST_RUNS,
            summary="run",
            resolved_run_id="7",
        ),
    )
    state = record_observation(
        state,
        decision(ActionKind.GET_FAILURE_CONTEXT),
        InvestigationObservation(
            action=ActionKind.GET_FAILURE_CONTEXT,
            summary="context",
            evidence=(
                InvestigationEvidence(
                    id="fc:1", source="failure-context", message="lint failed"
                ),
            ),
        ),
    )
    state = terminate(state, decision(ActionKind.STOP))
    assert state.status is InvestigationStatus.STOPPED
    with pytest.raises(InvestigationTransitionError, match="terminal"):
        validate_decision(state, decision(ActionKind.ESCALATE))


def test_budgets_force_stop_or_escalation_instead_of_unbounded_tools() -> None:
    state = initial_state(
        "Investigate failed CI", "acme/app", max_tool_calls=2, max_search_calls=0
    )
    state = record_observation(
        state,
        decision(ActionKind.LIST_RUNS),
        InvestigationObservation(
            action=ActionKind.LIST_RUNS,
            summary="run",
            resolved_run_id="7",
        ),
    )
    state = record_observation(
        state,
        decision(ActionKind.GET_FAILURE_CONTEXT),
        InvestigationObservation(
            action=ActionKind.GET_FAILURE_CONTEXT,
            summary="context",
            evidence=(
                InvestigationEvidence(
                    id="fc:1",
                    source="failure-context",
                    message="ambiguous failure",
                ),
            ),
        ),
    )
    with pytest.raises(InvestigationTransitionError, match="tool-call budget"):
        validate_decision(
            state,
            InvestigationDecision(
                action=ActionKind.SEARCH_JOB_LOGS,
                reason="search",
                job_id="job-1",
                patterns=("error",),
            ),
        )
    escalated = terminate(state, decision(ActionKind.ESCALATE))
    assert escalated.status is InvestigationStatus.ESCALATED
