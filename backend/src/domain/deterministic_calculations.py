"""Auditable decimal calculations; generated prose never performs arithmetic."""
from __future__ import annotations

from dataclasses import dataclass
from decimal import (
    ROUND_HALF_EVEN,
    Context,
    Decimal,
    DecimalException,
    DivisionByZero,
    InvalidOperation,
    Overflow,
    localcontext,
)
from enum import StrEnum
from statistics import median


MAX_VALUES = 10_000
WORK_PRECISION = 512


def _precision(value: int) -> None:
    if type(value) is not int or not 0 <= value <= 18:
        raise ValueError("precision must be between 0 and 18")


def _decimal(value: Decimal) -> None:
    if not isinstance(value, Decimal) or not value.is_finite():
        raise ValueError("Numeric inputs must be finite decimals")
    if (
        len(value.as_tuple().digits) > 128
        or abs(value.as_tuple().exponent) > 128
        or abs(value.adjusted()) > 128
    ):
        raise ValueError("Numeric input exceeds the bounded calculation range")


def _work_context() -> Context:
    return Context(
        prec=WORK_PRECISION, rounding=ROUND_HALF_EVEN, Emin=-999999, Emax=999999,
        traps=[DivisionByZero, InvalidOperation, Overflow],
    )


def _round(value: Decimal, precision: int) -> Decimal:
    _precision(precision)
    try:
        with localcontext(_work_context()):
            return value.quantize(Decimal(1).scaleb(-precision))
    except DecimalException as error:
        raise ValueError("Calculation cannot be represented at the selected precision") from error


class CalculationOperation(StrEnum):
    ADD = "ADD"
    SUBTRACT = "SUBTRACT"
    MULTIPLY = "MULTIPLY"
    DIVIDE = "DIVIDE"
    PERCENT_CHANGE = "PERCENT_CHANGE"
    RATIO = "RATIO"
    DIFFERENCE = "DIFFERENCE"


class AggregationOperation(StrEnum):
    SUM = "SUM"
    COUNT = "COUNT"
    AVERAGE = "AVERAGE"
    MEDIAN = "MEDIAN"
    MINIMUM = "MINIMUM"
    MAXIMUM = "MAXIMUM"
    WEIGHTED_AVERAGE = "WEIGHTED_AVERAGE"
    RANK = "RANK"
    DESCRIPTIVE_STATISTICS = "DESCRIPTIVE_STATISTICS"


@dataclass(frozen=True, slots=True)
class Quantity:
    value: Decimal
    unit: str
    evidence_ids: tuple[str, ...]

    def __post_init__(self) -> None:
        _decimal(self.value)
        if not isinstance(self.unit, str) or len(self.unit) > 64 or not self.unit.strip():
            raise ValueError("Unit is required")
        if not self.evidence_ids or len(self.evidence_ids) > 100 or any(not isinstance(item, str) or not item.strip() or len(item) > 128 for item in self.evidence_ids):
            raise ValueError("Calculated inputs require bounded evidence references")


@dataclass(frozen=True, slots=True)
class CalculationResult:
    operation: CalculationOperation
    value: Decimal
    unit: str
    formula: str
    evidence_ids: tuple[str, ...]
    precision: int


@dataclass(frozen=True, slots=True)
class AggregateResult:
    operation: AggregationOperation
    output: Decimal | tuple[tuple[str, str], ...]
    unit: str
    expression: str
    evidence_ids: tuple[str, ...]
    missing_value_treatment: str
    precision: int


def calculate(
    operation: CalculationOperation,
    left: Quantity,
    right: Quantity,
    *,
    precision: int = 6,
) -> CalculationResult:
    _precision(precision)
    if not isinstance(operation, CalculationOperation):
        raise ValueError("Unsupported calculation operation")
    if operation in {
        CalculationOperation.ADD,
        CalculationOperation.SUBTRACT,
        CalculationOperation.PERCENT_CHANGE,
        CalculationOperation.DIFFERENCE,
    } and left.unit != right.unit:
        raise ValueError("Units are incompatible")
    try:
        with localcontext(_work_context()):
            if operation is CalculationOperation.ADD:
                value, unit, symbol = left.value + right.value, left.unit, "+"
            elif operation in {
                CalculationOperation.SUBTRACT,
                CalculationOperation.DIFFERENCE,
            }:
                value, unit, symbol = left.value - right.value, left.unit, "-"
            elif operation is CalculationOperation.MULTIPLY:
                value, unit, symbol = left.value * right.value, f"{left.unit}*{right.unit}", "*"
            elif operation in {
                CalculationOperation.DIVIDE,
                CalculationOperation.RATIO,
            }:
                value, unit, symbol = left.value / right.value, f"{left.unit}/{right.unit}", "/"
            else:
                value = ((right.value - left.value) / left.value) * Decimal("100")
                unit, symbol = "%", "percent_change"
    except DecimalException as error:
        raise ValueError("Calculation is undefined") from error
    rounded = _round(value, precision)
    evidence = tuple(dict.fromkeys((*left.evidence_ids, *right.evidence_ids)))
    formula = (
        f"(({right.value}-{left.value})/{left.value})*100"
        if operation is CalculationOperation.PERCENT_CHANGE
        else f"{left.value}{symbol}{right.value}"
    )
    return CalculationResult(operation, rounded, unit, formula, evidence, precision)


def aggregate(
    operation: AggregationOperation,
    values: tuple[Quantity, ...],
    *,
    weights: tuple[Decimal, ...] = (),
    precision: int = 6,
    missing_value_treatment: str = "REJECT",
) -> AggregateResult:
    """Execute auditable aggregate calculations over evidence-backed values."""
    if not values or len(values) > MAX_VALUES:
        raise ValueError("A bounded non-empty value set is required")
    if not isinstance(operation, AggregationOperation):
        raise ValueError("Unsupported aggregation operation")
    _precision(precision)
    if missing_value_treatment not in {"REJECT", "EXCLUDE"}:
        raise ValueError("Unsupported missing-value treatment")
    units = {item.unit for item in values}
    if len(units) != 1:
        raise ValueError("Units are incompatible")
    numbers = tuple(item.value for item in values)
    quantum = Decimal(f"1e-{precision}")
    with localcontext(_work_context()):
        if operation is AggregationOperation.SUM:
            output: Decimal | tuple[tuple[str, str], ...] = sum(numbers, Decimal(0))
        elif operation is AggregationOperation.COUNT:
            output = Decimal(len(numbers))
        elif operation is AggregationOperation.AVERAGE:
            output = sum(numbers, Decimal(0)) / Decimal(len(numbers))
        elif operation is AggregationOperation.MEDIAN:
            output = Decimal(median(numbers))
        elif operation is AggregationOperation.MINIMUM:
            output = min(numbers)
        elif operation is AggregationOperation.MAXIMUM:
            output = max(numbers)
        elif operation is AggregationOperation.WEIGHTED_AVERAGE:
            for weight in weights:
                _decimal(weight)
            if len(weights) != len(numbers) or any(weight < 0 for weight in weights):
                raise ValueError("Non-negative weights must align with values")
            denominator = sum(weights, Decimal(0))
            if denominator == 0:
                raise ValueError("Weights must sum above zero")
            output = sum((value * weight for value, weight in zip(numbers, weights)), Decimal(0)) / denominator
        elif operation is AggregationOperation.RANK:
            ranked = sorted(enumerate(numbers), key=lambda pair: (-pair[1], pair[0]))
            output = tuple((str(index), str(value)) for index, value in ranked)
        else:
            mean = sum(numbers, Decimal(0)) / Decimal(len(numbers))
            output = (
                ("count", str(len(numbers))),
                ("minimum", str(min(numbers).quantize(quantum))),
                ("maximum", str(max(numbers).quantize(quantum))),
                ("average", str(mean.quantize(quantum))),
                ("median", str(Decimal(median(numbers)).quantize(quantum))),
            )
    if isinstance(output, Decimal):
        output = _round(output, precision)
    evidence = tuple(
        dict.fromkeys(evidence_id for value in values for evidence_id in value.evidence_ids)
    )
    return AggregateResult(
        operation,
        output,
        "" if operation is AggregationOperation.COUNT else values[0].unit,
        f"{operation.value.lower()}({','.join(str(number) for number in numbers)}"
        + (f";weights={','.join(str(weight) for weight in weights)}" if operation is AggregationOperation.WEIGHTED_AVERAGE else "") + ")",
        evidence,
        missing_value_treatment,
        precision,
    )


def convert_unit(
    value: Quantity,
    *,
    target_unit: str,
    factor: Decimal,
    conversion_evidence_id: str,
    precision: int = 6,
) -> CalculationResult:
    """Convert a unit only with an explicit evidence-backed conversion factor."""
    _precision(precision)
    _decimal(factor)
    if factor <= 0:
        raise ValueError("Conversion factor must be positive and finite")
    if not isinstance(target_unit, str) or not target_unit.strip() or len(target_unit) > 64 or not isinstance(conversion_evidence_id, str) or not conversion_evidence_id.strip() or len(conversion_evidence_id) > 128:
        raise ValueError("Target unit and conversion evidence are required")
    with localcontext(_work_context()):
        result = _round(value.value * factor, precision)
    evidence = tuple(dict.fromkeys((*value.evidence_ids, conversion_evidence_id)))
    return CalculationResult(
        CalculationOperation.MULTIPLY,
        result,
        target_unit,
        f"{value.value}*{factor}",
        evidence,
        precision,
    )