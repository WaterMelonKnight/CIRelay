"""Small local Strands stand-in so unit tests never initialize a real model."""

import sys
from types import ModuleType
from typing import Any


class FakeAgent:
    def __init__(self, **kwargs: Any) -> None:
        self.model = kwargs["model"]
        self.system_prompt = kwargs["system_prompt"]
        self.tool_registry = {item.__name__: item for item in kwargs["tools"]}


def tool(function: Any) -> Any:
    return function


class FakeOpenAIModel:
    def __init__(self, **kwargs: Any) -> None:
        self.config = kwargs


fake_strands = ModuleType("strands")
fake_strands.Agent = FakeAgent  # type: ignore[attr-defined]
fake_strands.tool = tool  # type: ignore[attr-defined]
fake_models = ModuleType("strands.models")
fake_openai = ModuleType("strands.models.openai")
fake_openai.OpenAIModel = FakeOpenAIModel  # type: ignore[attr-defined]
sys.modules["strands"] = fake_strands
sys.modules["strands.models"] = fake_models
sys.modules["strands.models.openai"] = fake_openai
