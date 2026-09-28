from typing import Any

import pytest

from cirelay_strands_agent.investigation import (
    Evidence,
    Hypothesis,
    InvestigationAction,
    InvestigationLimits,
    InvestigationObservation,
    apply_observation,
    build_structured_diagnosis,
    guardrail_reason,
    mark_completed,
    mark_escalated,
    replace_hypotheses,
    start_investigation,
)


def test_investigation_starts_with_explicit_state() -> None:
    state = start_investigation(
        "Investigate the latest failed CI",
        "WaterMelonKnight/CIRelay",
    )

    assert state.phase == "resolving-run"
    assert state.run_id is None
    assert state.step_count == 0
    assert state.evidence == []
    assert state.hypotheses == []


def test_observation_resolves_run_and_deduplicates_evidence() -> None:
    state = start_investigation("Investigate CI", "WaterMelonKnight/CIRelay")
    action = InvestigationAction("list_ci_runs", {"limit": 5})
    evidence = Evidence(
        id="run:42",
        source="ci-run",
        message="run 42 concluded failure",
    )
    observation = InvestigationObservation(
        action="list_ci_runs",
        summary="resolved failed run 42",
        evidence=(evidence, evidence),
        resolved_run_id="42",
    )

    apply_observation(state, action, observation)

    assert state.run_id == "42"
    assert state.phase == "gathering-context"
    assert state.evidence == [evidence]
    assert state.history[0].evidence_added == 1
    assert state.history[0].made_progress is True
    assert state.no_progress_steps == 0


def test_no_progress_is_tracked_across_repeated_observations() -> None:
    state = start_investigation("Investigate CI", "WaterMelonKnight/CIRelay")
    action = InvestigationAction("search_job_logs", {"patterns": ["timeout"]})
    observation = InvestigationObservation(
        action="search_job_logs",
        summary="no matching lines",
    )

    apply_observation(state, action, observation)
    apply_observation(state, action, observation)

    assert state.phase == "investigating"
    assert state.step_count == 2
    assert state.no_progress_steps == 2
    assert (
        guardrail_reason(
            state,
            limits=InvestigationLimits(max_no_progress_steps=2),
        )
        == "no-progress-limit-reached"
    )


def test_repeated_action_guard_blocks_a_third_identical_action() -> None:
    state = start_investigation("Investigate CI", "WaterMelonKnight/CIRelay")
    action = InvestigationAction(
        "get_failure_context",
        {"repository": "WaterMelonKnight/CIRelay", "run_id": "42"},
    )
    observation = InvestigationObservation(
        action="get_failure_context",
        summary="same bounded context",
    )

    apply_observation(state, action, observation)
    state.no_progress_steps = 0
    apply_observation(state, action, observation)
    state.no_progress_steps = 0

    assert (
        guardrail_reason(
            state,
            next_action=action,
            limits=InvestigationLimits(
                max_steps=8,
                max_no_progress_steps=8,
                max_same_action=2,
            ),
        )
        == "repeated-action-limit-reached"
    )


def test_max_steps_is_a_hard_controller_guardrail() -> None:
    state = start_investigation("Investigate CI", "WaterMelonKnight/CIRelay")
    state.step_count = 8

    assert (
        guardrail_reason(state, limits=InvestigationLimits(max_steps=8))
        == "max-steps-reached"
    )


def test_hypotheses_remain_separate_from_observed_evidence() -> None:
    state = start_investigation("Investigate CI", "WaterMelonKnight/CIRelay")
    evidence = Evidence(
        id="failure:lint",
        source="failure-context",
        message="@typescript-eslint/no-unsafe-assignment",
        job_id="validate",
        line_number=281,
        category="generic-error",
    )
    apply_observation(
        state,
        InvestigationAction("get_failure_context"),
        InvestigationObservation(
            action="get_failure_context",
            summary="lint evidence found",
            evidence=(evidence,),
            resolved_run_id="42",
        ),
    )
    hypothesis = Hypothesis(
        id="hypothesis:lint",
        statement="The validate job failed because lint rejected an unsafe assignment.",
        status="supported",
        supporting_evidence_ids=(evidence.id,),
    )
    replace_hypotheses(state, [hypothesis])
    mark_completed(state, "evidence supports one bounded diagnosis")

    diagnosis = build_structured_diagnosis(
        state,
        "Lint failed on an unsafe assignment.",
        next_action="Inspect the reported assignment and rerun CI.",
    )

    assert diagnosis.status == "completed"
    assert diagnosis.observed_evidence == (evidence,)
    assert diagnosis.hypotheses == (hypothesis,)
    assert diagnosis.reason == "evidence supports one bounded diagnosis"


def test_escalated_diagnosis_preserves_reason() -> None:
    state = start_investigation("Investigate CI", "WaterMelonKnight/CIRelay")
    mark_escalated(state, "evidence remains ambiguous")

    diagnosis = build_structured_diagnosis(
        state,
        "The current evidence cannot distinguish two plausible causes.",
        next_action="Ask for a deeper log source or human review.",
    )

    assert diagnosis.status == "escalated"
    assert diagnosis.reason == "evidence remains ambiguous"


def test_terminal_state_rejects_more_observations() -> None:
    state = start_investigation("Investigate CI", "WaterMelonKnight/CIRelay")
    mark_completed(state, "done")

    with pytest.raises(
        ValueError,
        match="cannot apply observations to a terminal investigation",
    ):
        apply_observation(
            state,
            InvestigationAction("list_ci_runs"),
            InvestigationObservation(action="list_ci_runs", summary="late result"),
        )


def test_action_signature_is_stable_for_argument_order() -> None:
    first = InvestigationAction(
        "search_job_logs",
        {"job_id": "7", "patterns": ["panic", "timeout"]},
    )
    second = InvestigationAction(
        "search_job_logs",
        {"patterns": ["panic", "timeout"], "job_id": "7"},
    )

    assert first.signature() == second.signature()


def test_action_arguments_remain_json_shaped() -> None:
    action = InvestigationAction(
        "list_ci_runs",
        {"repository": "WaterMelonKnight/CIRelay", "limit": 5},
    )

    arguments: dict[str, Any] = action.arguments
    assert arguments["limit"] == 5
