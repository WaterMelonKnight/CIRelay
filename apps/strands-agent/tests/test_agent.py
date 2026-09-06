from typing import Any

from cirelay_strands_agent import create_agent
from cirelay_strands_agent.tools import create_tools


class FakeClient:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def call(self, operation: str, arguments: dict[str, Any]) -> Any:
        self.calls.append((operation, arguments))
        if operation == "list_ci_runs":
            return [{"id": "42", "conclusion": "failure"}]
        return {"run": {"id": "42"}, "evidence": [{"message": "failed"}]}


def test_list_runs_maps_and_bounds_inputs() -> None:
    client = FakeClient()
    list_runs = create_tools(client)[0]
    assert list_runs("WaterMelonKnight/CIRelay", 100)[0]["id"] == "42"
    assert client.calls == [
        (
            "list_ci_runs",
            {
                "repository": {"owner": "WaterMelonKnight", "name": "CIRelay"},
                "conclusion": "failure",
                "latest": True,
                "limit": 10,
            },
        )
    ]


def test_failure_context_returns_structured_evidence() -> None:
    client = FakeClient()
    context = create_tools(client)[1]("WaterMelonKnight/CIRelay", "42")
    assert context["evidence"] == [{"message": "failed"}]
    assert client.calls[0][1] == {
        "repository": {"owner": "WaterMelonKnight", "name": "CIRelay"},
        "runId": "42",
    }


def test_agent_registers_only_intended_tools() -> None:
    agent = create_agent(FakeClient(), model="test-model")
    assert set(agent.tool_registry) == {"list_ci_runs", "get_failure_context"}
    assert "raw" not in " ".join(agent.tool_registry)
    assert "shell" not in " ".join(agent.tool_registry)
