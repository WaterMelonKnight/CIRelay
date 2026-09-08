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

BEDROCK_MODEL_ID = "us.amazon.nova-pro-v1:0"
OPENAI_MODEL_ID = "gpt-4o-mini"


def _configured_model() -> Any:
    provider = os.getenv("STRANDS_MODEL_PROVIDER", "bedrock")
    model_id = os.getenv("STRANDS_MODEL_ID")

    if provider == "bedrock":
        return model_id or BEDROCK_MODEL_ID
    if provider == "openai":
        from strands.models.openai import OpenAIModel

        return OpenAIModel(model_id=model_id or OPENAI_MODEL_ID)
    raise ValueError(
        "unsupported STRANDS_MODEL_PROVIDER "
        f"{provider!r}; expected 'bedrock' or 'openai'"
    )


def create_agent(client: CiRelayClient | None = None, model: Any = None) -> Agent:
    """Build the single-purpose agent; dependencies are injectable for tests."""
    selected_model = model if model is not None else _configured_model()
    return Agent(
        model=selected_model,
        system_prompt=SYSTEM_PROMPT,
        tools=create_tools(client or NodeCiRelayBridge()),
    )
