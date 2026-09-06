"""The deliberately small CIRelay tool surface exposed to Strands."""

from __future__ import annotations

from typing import Any

from strands import tool

from .bridge import CiRelayClient


def _repository(value: str) -> dict[str, str]:
    owner, separator, name = value.partition("/")
    if not separator or not owner or not name or "/" in name:
        raise ValueError("repository must be in owner/name form")
    return {"owner": owner, "name": name}


def create_tools(client: CiRelayClient) -> list[Any]:
    """Create only the bounded tools required by the investigation workflow."""

    @tool
    def list_ci_runs(repository: str, limit: int = 5) -> Any:
        """Resolve recent failed CI runs. Use this first when runId is unknown."""
        return client.call(
            "list_ci_runs",
            {
                "repository": _repository(repository),
                "conclusion": "failure",
                "latest": True,
                "limit": max(1, min(limit, 10)),
            },
        )

    @tool
    def get_failure_context(repository: str, run_id: str) -> Any:
        """Get primary, structured, bounded failure evidence for a known run."""
        return client.call(
            "get_failure_context",
            {"repository": _repository(repository), "runId": run_id},
        )

    return [list_ci_runs, get_failure_context]
