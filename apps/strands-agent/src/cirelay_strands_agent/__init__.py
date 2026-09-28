"""CIRelay's Strands-based CI investigation agent."""

from .agent import SYSTEM_PROMPT, create_agent
from .state import (
    DiagnosisConfidence,
    EvidenceItem,
    Hypothesis,
    HypothesisStatus,
    InvestigationAction,
    InvestigationActionKind,
    InvestigationPhase,
    InvestigationState,
    StructuredDiagnosis,
    TerminationReason,
    create_investigation,
)

__all__ = [
    "SYSTEM_PROMPT",
    "DiagnosisConfidence",
    "EvidenceItem",
    "Hypothesis",
    "HypothesisStatus",
    "InvestigationAction",
    "InvestigationActionKind",
    "InvestigationPhase",
    "InvestigationState",
    "StructuredDiagnosis",
    "TerminationReason",
    "create_agent",
    "create_investigation",
]
