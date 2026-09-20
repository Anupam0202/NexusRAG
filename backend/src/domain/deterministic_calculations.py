"""Auditable decimal calculations; generated prose never performs arithmetic."""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, DivisionByZero, InvalidOperation, localcontext
from enum import StrEnum
from statistics import median


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
        if not self.value.is_finite():
            raise ValueError("Quantity must be finite")
        if not self.unit.strip():
            raise ValueError("Unit is required")
        if not self.evidence_ids:
            raise ValueError("Calculated inputs require evidence")


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
    if not 0 <= precision <= 18:
        raise ValueError("precision must be between 0 and 18")
    if operation in {
        CalculationOperation.ADD,
        CalculationOperation.SUBTRACT,
        CalculationOperation.PERCENT_CHANGE,
        CalculationOperation.DIFFERENCE,
    } and left.unit != right.unit:
        raise ValueError("Units are incompatible")
    try:
        with localcontext() as context:
            context.prec = 38
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
    except (DivisionByZero, InvalidOperation) as error:
        raise ValueError("Calculation is undefined") from error
    quantum = Decimal(1).scaleb(-precision)
    rounded = value.quantize(quantum)
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
    if not values:
        raise ValueError("At least one value is required")
    if not 0 <= precision <= 18:
        raise ValueError("precision must be between 0 and 18")
    if missing_value_treatment not in {"REJECT", "EXCLUDE"}:
        raise ValueError("Unsupported missing-value treatment")
    units = {item.unit for item in values}
    if len(units) != 1:
        raise ValueError("Units are incompatible")
    numbers = tuple(item.value for item in values)
    quantum = Decimal(1).scaleb(-precision)
    with localcontext() as context:
        context.prec = 38
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
        output = output.quantize(quantum)
    evidence = tuple(
        dict.fromkeys(evidence_id for value in values for evidence_id in value.evidence_ids)
    )
    return AggregateResult(
        operation,
        output,
        "" if operation is AggregationOperation.COUNT else values[0].unit,
        f"{operation.value.lower()}({','.join(str(number) for number in numbers)})",
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
    if factor <= 0 or not factor.is_finite():
        raise ValueError("Conversion factor must be positive and finite")
    if not target_unit.strip() or not conversion_evidence_id:
        raise ValueError("Target unit and conversion evidence are required")
    quantum = Decimal(1).scaleb(-precision)
    result = (value.value * factor).quantize(quantum)
    evidence = tuple(dict.fromkeys((*value.evidence_ids, conversion_evidence_id)))
    return CalculationResult(
        CalculationOperation.MULTIPLY,
        result,
        target_unit,
        f"{value.value}*{factor}",
        evidence,
        precision,
    )