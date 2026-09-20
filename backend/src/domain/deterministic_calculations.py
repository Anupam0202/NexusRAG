"""Auditable decimal calculations; generated prose never performs arithmetic."""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, DivisionByZero, InvalidOperation, localcontext
from enum import StrEnum


class CalculationOperation(StrEnum):
    ADD = "ADD"
    SUBTRACT = "SUBTRACT"
    MULTIPLY = "MULTIPLY"
    DIVIDE = "DIVIDE"
    PERCENT_CHANGE = "PERCENT_CHANGE"


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
    } and left.unit != right.unit:
        raise ValueError("Units are incompatible")
    try:
        with localcontext() as context:
            context.prec = 38
            if operation is CalculationOperation.ADD:
                value, unit, symbol = left.value + right.value, left.unit, "+"
            elif operation is CalculationOperation.SUBTRACT:
                value, unit, symbol = left.value - right.value, left.unit, "-"
            elif operation is CalculationOperation.MULTIPLY:
                value, unit, symbol = left.value * right.value, f"{left.unit}*{right.unit}", "*"
            elif operation is CalculationOperation.DIVIDE:
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