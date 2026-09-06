"""Focused Strands Agent construction."""

from __future__ import annotations

import os
from typing import Any

from strands import Agent

from .bridge import CiRelayClient, NodeCiRelayBridge
from .tools import create_tools

SYSTEM_PROMPT = """You are a CI investigation agent powered by CIRelay.
Answer only developer-oriented CI investigation questions. Resolve the relevant run
with list_ci_runs, then use get_failure_context as the primary diagnostic tool. If a
runId is known, pass that runId alone with the repository. Do not request full raw
logs. Stop when structured evidence is sufficient. Your concise answer must label
Observed evidence separately from Agent inference and finish with the next action.
"""


def create_agent(client: CiRelayClient | None = None, model: Any = None) -> Agent:
    """Build the single-purpose agent; dependencies are injectable for tests."""
    selected_model = model or os.getenv(
        "STRANDS_MODEL_ID", "us.amazon.nova-pro-v1:0"
    )
    return Agent(
        model=selected_model,
        system_prompt=SYSTEM_PROMPT,
        tools=create_tools(client or NodeCiRelayBridge()),
    )
