"""Deterministic subprocess bridge to the existing TypeScript handlers."""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any, Protocol


class CiRelayClient(Protocol):
    def call(self, operation: str, arguments: dict[str, Any]) -> Any: ...


class NodeCiRelayBridge:
    """Invoke the narrow Node bridge once per CIRelay operation."""

    def __init__(self, command: list[str] | None = None) -> None:
        default = Path(__file__).parents[3] / "dist" / "main.js"
        self.command = command or ["node", str(default)]

    def call(self, operation: str, arguments: dict[str, Any]) -> Any:
        completed = subprocess.run(
            self.command,
            input=json.dumps({"operation": operation, "arguments": arguments}),
            text=True,
            capture_output=True,
            check=True,
            env=os.environ.copy(),
        )
        return json.loads(completed.stdout)
