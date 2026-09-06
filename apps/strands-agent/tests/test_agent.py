import os
import subprocess
from pathlib import Path
from typing import Any

from cirelay_strands_agent import create_agent
from cirelay_strands_agent.bridge import NodeCiRelayBridge
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


def test_default_bridge_path_points_to_built_entrypoint() -> None:
    bridge = NodeCiRelayBridge()
    app_root = Path(__file__).parents[1]
    assert bridge.command == ["node", str(app_root / "dist" / "main.js")]


def test_built_bridge_entrypoint_starts_without_network() -> None:
    bridge = NodeCiRelayBridge()
    entrypoint = Path(bridge.command[1])
    assert entrypoint.is_file(), "run `pnpm build` before the Python tests"

    environment = os.environ.copy()
    environment.pop("GITHUB_TOKEN", None)
    completed = subprocess.run(
        bridge.command,
        input="{}",
        text=True,
        capture_output=True,
        env=environment,
        check=False,
    )

    assert completed.returncode != 0
    assert "GITHUB_TOKEN is required" in completed.stderr
