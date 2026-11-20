from decimal import Decimal, Inexact, ROUND_UP, localcontext
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from src.api.evidence_routes import CalculationInput, run_calculation
from src.domain.deterministic_calculations import (
    AggregationOperation as A, CalculationOperation as C,
    Quantity, aggregate, calculate, convert_unit,
)


def quantity(value, evidence='source'):
    return Quantity(Decimal(value), 'kg', (evidence,))


def test_large_values_round_inside_a_sufficient_decimal_context():
    result = calculate(C.ADD, quantity('1e30'), quantity('1'), precision=18)
    assert result.value == Decimal('1000000000000000000000000000001.000000000000000000')
    assert aggregate(A.SUM, (quantity('1e30'), quantity('1')), precision=18).output == result.value


def test_results_do_not_depend_on_ambient_rounding_or_precision():
    with localcontext() as context:
        context.prec = 3
        context.rounding = ROUND_UP
        context.traps[Inexact] = True
        context.Emax = 10
        assert calculate(C.ADD, quantity('1.005'), quantity('0'), precision=2).value == Decimal('1.00')
        assert aggregate(A.AVERAGE, (quantity('1.005'),), precision=2).output == Decimal('1.00')
        assert convert_unit(quantity('1.005'), target_unit='g', factor=Decimal('1'), conversion_evidence_id='conversion', precision=2).value == Decimal('1.00')


@pytest.mark.parametrize('value', ['NaN', 'Infinity', '1e129', '1e-129', '0e-10000000', '1.' + '2' * 129])
def test_numeric_inputs_are_finite_and_bounded(value):
    with pytest.raises(ValueError):
        quantity(value)


@pytest.mark.parametrize('precision', [-1, 19, True, 1.5])
def test_conversion_validates_precision_before_quantization(precision):
    with pytest.raises(ValueError):
        convert_unit(quantity('1'), target_unit='g', factor=Decimal('1000'), conversion_evidence_id='conversion', precision=precision)


@pytest.mark.parametrize('weight', ['NaN', 'Infinity', '-1', '1e129'])
def test_weighted_average_rejects_invalid_weights_without_decimal_crashes(weight):
    with pytest.raises(ValueError):
        aggregate(A.WEIGHTED_AVERAGE, (quantity('1'),), weights=(Decimal(weight),))


def test_weighted_expression_preserves_reproducible_weights():
    result = aggregate(A.WEIGHTED_AVERAGE, (quantity('10', 'left'), quantity('20', 'right')), weights=(Decimal('1'), Decimal('3')))
    assert result.output == Decimal('17.5')
    assert 'weights=1,3' in result.expression
    assert result.evidence_ids == ('left', 'right')


def test_unknown_operations_never_silently_become_percent_change_or_statistics():
    with pytest.raises(ValueError):
        calculate('UNKNOWN', quantity('1'), quantity('2'))
    with pytest.raises(ValueError):
        aggregate('UNKNOWN', (quantity('1'),))


@pytest.mark.parametrize('evidence', [(), ('',), (' ',), ('x' * 129,)])
def test_empty_or_oversized_evidence_references_are_not_accepted(evidence):
    with pytest.raises(ValueError):
        Quantity(Decimal('1'), 'kg', evidence)


@pytest.mark.asyncio
async def test_undefined_api_arithmetic_is_422_not_a_server_failure():
    payload = CalculationInput(operation='DIVIDE', left={'value':'1','unit':'kg','evidence_ids':['left']}, right={'value':'0','unit':'kg','evidence_ids':['right']})
    with pytest.raises(HTTPException) as caught:
        await run_calculation(payload, SimpleNamespace())
    assert caught.value.status_code == 422


@pytest.mark.asyncio
async def test_local_calculation_does_not_claim_authorized_or_persisted_evidence():
    payload = CalculationInput(operation='ADD', left={'value':'1','unit':'kg','evidence_ids':['left']}, right={'value':'2','unit':'kg','evidence_ids':['right']})
    result = await run_calculation(payload, SimpleNamespace())
    assert result['value'] == '3.000000'
    assert result['input_evidence_state'] == 'CALLER_ASSERTED_NOT_VERIFIED'
    assert result['persistence_state'] == 'NOT_PERSISTED'
