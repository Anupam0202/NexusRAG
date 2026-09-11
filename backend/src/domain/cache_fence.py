"""Authorization and provenance fencing for deterministic and AI caches."""
from __future__ import annotations
from dataclasses import dataclass
import hashlib
import json

@dataclass(frozen=True, slots=True)
class CacheFence:
    workspace_id: str
    authorization_revision: int
    workspace_policy_hash: str
    rights_hash: str
    source_version_hashes: tuple[str, ...]
    operation: str
    prompt_version: str
    model_revision: str
    parameters: tuple[tuple[str, str], ...] = ()
    def __post_init__(self) -> None:
        if not self.workspace_id or self.authorization_revision < 0 or not self.operation: raise ValueError("Cache fence identity is incomplete")
        for digest in (self.workspace_policy_hash, self.rights_hash, *self.source_version_hashes):
            if len(digest) != 64 or any(character not in "0123456789abcdef" for character in digest.lower()): raise ValueError("Cache fence hashes must be SHA-256 hex")
        if not self.source_version_hashes: raise ValueError("At least one source version is required")
    @property
    def key(self) -> str:
        payload={"workspace_id":self.workspace_id,"authorization_revision":self.authorization_revision,"workspace_policy_hash":self.workspace_policy_hash,"rights_hash":self.rights_hash,"source_version_hashes":sorted(self.source_version_hashes),"operation":self.operation,"prompt_version":self.prompt_version,"model_revision":self.model_revision,"parameters":sorted(self.parameters)}
        return "v6:"+hashlib.sha256(json.dumps(payload,sort_keys=True,separators=(",", ":")).encode()).hexdigest()

def reusable(cached: CacheFence, current: CacheFence) -> bool: return cached.key == current.key
