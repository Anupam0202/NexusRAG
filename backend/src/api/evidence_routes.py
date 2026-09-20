"""Authenticated deterministic APIs shared by the Evidence Intelligence products."""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from src.api.auth import WorkspaceContext, WorkspaceRole, require_enterprise_workspace_role
from src.api.dependencies import verify_api_key
from src.domain.deterministic_calculations import (
    CalculationOperation,
    Quantity,
    calculate,
)
from src.domain.evidence_mcp import OPERATIONS
from src.domain.evidence_quality import Citation, assess_claim
from src.domain.obligations import Obligation, review
from src.domain.product_passport import (
    PassportClaim,
    PassportClaimStatus,
    ProductPassport,
)
from src.domain.research_planner import MODE_LIMITS, ResearchMode, ResearchPlan
from src.domain.setup_center import CHECK_IDS
from src.domain.standards_mapping import mapping_report

router = APIRouter(
    prefix="/evidence",
    tags=["evidence-os"],
    dependencies=[Depends(verify_api_key)],
)
VIEWER = require_enterprise_workspace_role(
    WorkspaceRole.OWNER,
    WorkspaceRole.ADMIN,
    WorkspaceRole.EDITOR,
    WorkspaceRole.VIEWER,
)
EDITOR = require_enterprise_workspace_role(
    WorkspaceRole.OWNER,
    WorkspaceRole.ADMIN,
    WorkspaceRole.EDITOR,
)


class CitationInput(BaseModel):
    source_version_id: str = Field(min_length=1, max_length=128)
    locator: str = Field(min_length=1, max_length=512)
    content_hash: str = Field(pattern=r"^[0-9a-fA-F]{64}$")
    captured_at: datetime
    supports: bool = True


class ClaimAssessmentInput(BaseModel):
    claim_id: str = Field(min_length=1, max_length=128)
    text: str = Field(min_length=1, max_length=10_000)
    confidence: float = Field(ge=0, le=1)
    citations: list[CitationInput] = Field(default_factory=list, max_length=50)
    inferred: bool = False
    source_available: bool = True
    stale_after_days: int | None = Field(default=None, ge=1, le=3650)


class QuantityInput(BaseModel):
    value: Decimal
    unit: str = Field(min_length=1, max_length=64)
    evidence_ids: list[str] = Field(min_length=1, max_length=100)


class CalculationInput(BaseModel):
    operation: CalculationOperation
    left: QuantityInput
    right: QuantityInput
    precision: int = Field(default=6, ge=0, le=18)


class ObligationReviewInput(BaseModel):
    obligation_id: str = Field(min_length=1, max_length=128)
    authority: str = Field(min_length=1, max_length=256)
    jurisdiction: str = Field(min_length=1, max_length=128)
    actor: str = Field(min_length=1, max_length=512)
    action: str = Field(min_length=1, max_length=4000)
    source_version_id: str = Field(min_length=1, max_length=128)
    locator: str = Field(min_length=1, max_length=512)
    reviewer_id: str = Field(min_length=1, max_length=128)
    decision: Literal["approve", "reject"]


class PassportClaimInput(BaseModel):
    property_name: str = Field(min_length=1, max_length=128)
    value: str = Field(min_length=1, max_length=4000)
    status: PassportClaimStatus
    evidence_ids: list[str] = Field(default_factory=list, max_length=100)
    observed_at: datetime


class PassportExportInput(BaseModel):
    passport_id: str = Field(min_length=1, max_length=128)
    product_name: str = Field(min_length=1, max_length=256)
    product_version: str = Field(min_length=1, max_length=128)
    supplier: str = Field(min_length=1, max_length=256)
    claims: list[PassportClaimInput] = Field(max_length=200)


class ResearchPlanInput(BaseModel):
    plan_id: str = Field(min_length=1, max_length=128)
    mode: ResearchMode
    question: str = Field(min_length=1, max_length=10_000)
    subquestions: list[str] = Field(default_factory=list, max_length=12)
    private_source_ids: list[str] = Field(default_factory=list, max_length=60)
    public_provider_ids: list[str] = Field(default_factory=list, max_length=60)
    date_from: date | None = None
    date_to: date | None = None
    jurisdiction: str | None = Field(default=None, max_length=128)
    entity_scope: list[str] = Field(default_factory=list, max_length=100)
    rights_constraints: list[str] = Field(default_factory=list, max_length=100)
    expected_calculations: list[str] = Field(default_factory=list, max_length=50)
    completion_criteria: list[str] = Field(min_length=1, max_length=50)


@router.get("/capabilities")
async def capabilities(
    workspace: WorkspaceContext | None = Depends(VIEWER),
) -> dict:
    return {
        "profile": "ZERO_COST_LOW_TRAFFIC",
        "workspace_bound": workspace is not None,
        "paid_fallback": False,
        "products": {
            "evidence_workbench": "FOUNDATION_READY",
            "terms_quota_radar": "FOUNDATION_READY",
            "obligation_compiler": "FOUNDATION_READY",
            "procurement_graph": "PROVIDER_REVIEW",
            "counterparty_graph": "FOUNDATION_READY",
            "product_passport": "FOUNDATION_READY",
            "scientific_workbench": "CONNECTORS_PENDING",
            "open_source_assurance": "PROVIDER_REVIEW",
            "public_risk": "PROVIDER_REVIEW",
            "evidence_api_mcp": "CONTRACT_READY",
        },
    }


@router.get("/mcp/operations")
async def mcp_operations(
    _workspace: WorkspaceContext | None = Depends(VIEWER),
) -> dict:
    return {
        "authentication_required": True,
        "workspace_binding_required": True,
        "unrestricted_bulk_export": False,
        "autonomous_destructive_tools": False,
        "operations": [
            {
                "name": item.name,
                "capability": item.capability.value,
                "max_results": item.max_results,
                "deadline_ms": item.deadline_ms,
                "rate_limit_per_minute": item.rate_limit_per_minute,
                "idempotent": item.idempotent,
                "rights_action": item.rights_action,
                "audit_event": item.audit_event,
            }
            for item in OPERATIONS
        ],
    }


@router.get("/standards")
async def standards(
    _workspace: WorkspaceContext | None = Depends(VIEWER),
) -> dict:
    return mapping_report()


@router.get("/setup/checks")
async def setup_checks(
    _workspace: WorkspaceContext | None = Depends(VIEWER),
) -> dict:
    return {
        "check_ids": CHECK_IDS,
        "live_state_source": "deployment inventory and provider health",
        "unknown_state": "REVIEW_REQUIRED",
        "paid_fallback": False,
    }


@router.post("/research/plans")
async def create_research_plan(
    payload: ResearchPlanInput,
    workspace: WorkspaceContext | None = Depends(EDITOR),
) -> dict:
    if workspace is None:
        raise ValueError("Enterprise workspace context is required")
    plan = ResearchPlan(
        payload.plan_id,
        workspace.workspace_id,
        payload.mode,
        payload.question,
        tuple(payload.subquestions),
        tuple(payload.private_source_ids),
        tuple(payload.public_provider_ids),
        payload.date_from,
        payload.date_to,
        payload.jurisdiction,
        tuple(payload.entity_scope),
        tuple(payload.rights_constraints),
        tuple(payload.expected_calculations),
        tuple(payload.completion_criteria),
    )
    limits = MODE_LIMITS[plan.mode]
    return {
        "plan_id": plan.plan_id,
        "workspace_id": plan.workspace_id,
        "mode": plan.mode.value,
        "limits": {
            "max_subquestions": limits.max_subquestions,
            "max_sources": limits.max_sources,
            "max_query_variants": limits.max_variants,
            "max_runtime_seconds": limits.max_runtime_seconds,
            "requires_review": limits.requires_review,
        },
        "state": "PLANNED",
    }


@router.post("/claims/assess")
async def assess_evidence_claim(
    payload: ClaimAssessmentInput,
    _workspace: WorkspaceContext | None = Depends(VIEWER),
) -> dict:
    claim = assess_claim(
        claim_id=payload.claim_id,
        text=payload.text,
        confidence=payload.confidence,
        citations=(
            Citation(
                item.source_version_id,
                item.locator,
                item.content_hash,
                item.captured_at,
                item.supports,
            )
            for item in payload.citations
        ),
        inferred=payload.inferred,
        source_available=payload.source_available,
        stale_after_days=payload.stale_after_days,
    )
    return {
        "claim_id": claim.claim_id,
        "status": claim.status.value,
        "confidence": claim.confidence,
        "citation_count": len(claim.citations),
    }


@router.post("/calculations")
async def run_calculation(
    payload: CalculationInput,
    _workspace: WorkspaceContext | None = Depends(VIEWER),
) -> dict:
    result = calculate(
        payload.operation,
        Quantity(payload.left.value, payload.left.unit, tuple(payload.left.evidence_ids)),
        Quantity(payload.right.value, payload.right.unit, tuple(payload.right.evidence_ids)),
        precision=payload.precision,
    )
    return {
        "operation": result.operation.value,
        "value": str(result.value),
        "unit": result.unit,
        "formula": result.formula,
        "evidence_ids": result.evidence_ids,
        "precision": result.precision,
    }


@router.post("/obligations/review")
async def review_obligation(
    payload: ObligationReviewInput,
    _workspace: WorkspaceContext | None = Depends(EDITOR),
) -> dict:
    candidate = Obligation(
        payload.obligation_id,
        payload.authority,
        payload.jurisdiction,
        payload.actor,
        payload.action,
        payload.source_version_id,
        payload.locator,
    )
    result = review(
        candidate,
        reviewer_id=payload.reviewer_id,
        approve=payload.decision == "approve",
    )
    return {
        "obligation_id": result.obligation_id,
        "state": result.state.value,
        "reviewer_id": result.reviewer_id,
    }


@router.post("/passports/export")
async def export_passport(
    payload: PassportExportInput,
    _workspace: WorkspaceContext | None = Depends(EDITOR),
) -> dict:
    passport = ProductPassport(
        payload.passport_id,
        payload.product_name,
        payload.product_version,
        payload.supplier,
        tuple(
            PassportClaim(
                item.property_name,
                item.value,
                item.status,
                tuple(item.evidence_ids),
                item.observed_at,
            )
            for item in payload.claims
        ),
    )
    return {
        "format": "application/ld+json",
        "receipt_sha256": passport.canonical_receipt(),
        "document": passport.export_jsonld(),
    }