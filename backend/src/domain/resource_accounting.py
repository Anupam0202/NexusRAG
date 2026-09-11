"""In-memory reference lifecycle for durable quota reservation implementations."""
from __future__ import annotations
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from enum import StrEnum
from threading import RLock
from uuid import uuid4
from src.domain.zero_cost import AdmissionDecision, Priority, ResourceBudget, admit

class ReservationState(StrEnum):
    RESERVED="RESERVED";SETTLED="SETTLED";RELEASED="RELEASED";RECONCILIATION_REQUIRED="RECONCILIATION_REQUIRED"
@dataclass(frozen=True,slots=True)
class Reservation:
    id:str;workspace_id:str;provider:str;resource:str;requested:int;state:ReservationState;created_at:datetime;measured:int|None=None;idempotency_key:str=""
class ReservationLedger:
    """Thread-safe reference model; production persistence belongs in PostgreSQL RPCs."""
    def __init__(self)->None:
        self._lock=RLock();self._budgets:dict[tuple[str,str,str],ResourceBudget]={};self._reservations:dict[str,Reservation]={};self._keys:dict[tuple[str,str],str]={}
    def set_budget(self,scope:str,provider:str,budget:ResourceBudget)->None:
        if scope!="global" and not scope.startswith("workspace:"):raise ValueError("Budget scope must be global or workspace:<id>")
        with self._lock:self._budgets[(scope,provider,budget.name)]=budget
    def reserve(self,*,workspace_id:str,provider:str,resource:str,amount:int,idempotency_key:str,priority:Priority=Priority.INTERACTIVE)->tuple[Reservation|None,dict[str,AdmissionDecision]]:
        if not workspace_id or not provider or not resource or not idempotency_key:raise ValueError("Reservation identity is incomplete")
        with self._lock:
            key=(workspace_id,idempotency_key)
            if key in self._keys:
                existing=self._reservations[self._keys[key]]
                if (existing.provider,existing.resource,existing.requested)!=(provider,resource,amount):raise ValueError("Idempotency key was reused with different reservation parameters")
                return existing,{}
            dimensions={"global":self._require_budget("global",provider,resource),"workspace":self._require_budget(f"workspace:{workspace_id}",provider,resource)}
            decisions={scope:admit(budget,amount,priority=priority) for scope,budget in dimensions.items()}
            if not all(decision.allowed for decision in decisions.values()):return None,decisions
            reservation=Reservation(str(uuid4()),workspace_id,provider,resource,amount,ReservationState.RESERVED,datetime.now(timezone.utc),idempotency_key=idempotency_key)
            self._reservations[reservation.id]=reservation;self._keys[key]=reservation.id
            for scope,budget in dimensions.items():
                scope_key="global" if scope=="global" else f"workspace:{workspace_id}"
                self._budgets[(scope_key,provider,resource)]=replace(budget,reserved=budget.reserved+amount)
            return reservation,decisions
    def settle(self,reservation_id:str,measured:int|None)->Reservation:
        with self._lock:
            reservation=self._active(reservation_id)
            if measured is None or measured<0:
                updated=replace(reservation,state=ReservationState.RECONCILIATION_REQUIRED,measured=None);self._reservations[reservation_id]=updated;return updated
            for scope in ("global",f"workspace:{reservation.workspace_id}"):
                key=(scope,reservation.provider,reservation.resource);budget=self._budgets[key]
                self._budgets[key]=replace(budget,reserved=max(0,budget.reserved-reservation.requested),used=budget.used+measured)
            updated=replace(reservation,state=ReservationState.SETTLED,measured=measured);self._reservations[reservation_id]=updated;return updated
    def release(self,reservation_id:str)->Reservation:
        with self._lock:
            reservation=self._active(reservation_id)
            for scope in ("global",f"workspace:{reservation.workspace_id}"):
                key=(scope,reservation.provider,reservation.resource);budget=self._budgets[key]
                self._budgets[key]=replace(budget,reserved=max(0,budget.reserved-reservation.requested))
            updated=replace(reservation,state=ReservationState.RELEASED);self._reservations[reservation_id]=updated;return updated
    def budget(self,scope:str,provider:str,resource:str)->ResourceBudget:
        with self._lock:return self._require_budget(scope,provider,resource)
    def _require_budget(self,scope:str,provider:str,resource:str)->ResourceBudget:
        try:return self._budgets[(scope,provider,resource)]
        except KeyError as error:raise ValueError(f"Undocumented budget: {scope}/{provider}/{resource}") from error
    def _active(self,reservation_id:str)->Reservation:
        reservation=self._reservations[reservation_id]
        if reservation.state is not ReservationState.RESERVED:raise ValueError("Reservation is no longer active")
        return reservation
