from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from src.api.evidence_routes import ObligationReviewInput, capabilities, mcp_operations, review_obligation


def review_input():
    return ObligationReviewInput(obligation_id='synthetic-obligation', authority='Synthetic instrument', jurisdiction='Test only', actor='Test operator', action='Review evidence', source_version_id='caller-asserted-version', locator='Provision 1', reviewer_id='forged-reviewer', decision='approve')


@pytest.mark.asyncio
async def test_reviewer_identity_is_server_bound_not_client_asserted():
    result = await review_obligation(review_input(), SimpleNamespace(user=SimpleNamespace(id='authenticated-reviewer')))
    assert result['reviewer_id'] == 'authenticated-reviewer'
    assert result['persistence_state'] == 'NOT_PERSISTED'
    assert result['input_evidence_state'] == 'CALLER_ASSERTED_NOT_VERIFIED'


@pytest.mark.asyncio
async def test_review_helper_denies_absent_authentication_context():
    with pytest.raises(HTTPException) as caught:
        await review_obligation(review_input(), None)
    assert caught.value.status_code == 403


@pytest.mark.asyncio
async def test_local_contracts_are_not_advertised_as_executable_complete_products():
    result = await capabilities(SimpleNamespace())
    assert result['execution_state'] == 'LOCAL_HELPERS_ONLY'
    assert result['production_verified'] is False
    assert 'FOUNDATION_READY' not in result['products'].values()
    discovery = await mcp_operations(SimpleNamespace())
    assert discovery['executable'] is False
    assert discovery['execution_state'] == 'DECLARATIONS_ONLY'
