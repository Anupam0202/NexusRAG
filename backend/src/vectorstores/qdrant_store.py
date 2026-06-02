"""Qdrant vector store adapter with mandatory workspace filters."""

from __future__ import annotations

import uuid
from typing import Any

import httpx

from config.settings import Settings, get_settings
from src.vectorstores.base import VectorChunk, VectorSearchResult


class QdrantVectorStore:
    _PAYLOAD_INDEXES: tuple[tuple[str, str], ...] = (
        ("workspace_id", "keyword"),
        ("document_id", "keyword"),
    )

    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        self._url = self._settings.qdrant_url.rstrip("/")
        self._collection = self._settings.qdrant_collection

    def _headers(self) -> dict[str, str]:
        if not self._settings.qdrant_api_key:
            return {"Content-Type": "application/json"}
        return {
            "Content-Type": "application/json",
            "api-key": self._settings.qdrant_api_key,
        }

    def _endpoint(self, path: str) -> str:
        if not self._url:
            raise RuntimeError("Qdrant is not configured. Set QDRANT_URL and QDRANT_API_KEY.")
        return f"{self._url}/collections/{self._collection}{path}"

    def _collection_endpoint(self) -> str:
        if not self._url:
            raise RuntimeError("Qdrant is not configured. Set QDRANT_URL and QDRANT_API_KEY.")
        return f"{self._url}/collections/{self._collection}"

    @staticmethod
    def stable_point_id(value: str) -> str:
        """Return a Qdrant-compatible point id for any stable chunk identifier."""
        try:
            return str(uuid.UUID(str(value)))
        except (TypeError, ValueError):
            return str(uuid.uuid5(uuid.NAMESPACE_URL, f"nexusrag:qdrant:{value}"))

    @staticmethod
    def collection_payload(*, vector_size: int, distance: str = "Cosine") -> dict[str, Any]:
        return {"vectors": {"size": vector_size, "distance": distance}}

    @staticmethod
    def payload_index_payload(field_name: str, field_schema: str = "keyword") -> dict[str, Any]:
        return {"field_name": field_name, "field_schema": field_schema}

    @staticmethod
    def workspace_filter(
        workspace_id: str,
        extra_filters: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        must: list[dict[str, Any]] = [
            {"key": "workspace_id", "match": {"value": workspace_id}},
        ]
        if extra_filters:
            for key, value in extra_filters.items():
                if value is None:
                    continue
                if isinstance(value, dict) and any(
                    bound in value for bound in ("gt", "gte", "lt", "lte")
                ):
                    must.append({"key": key, "range": value})
                elif isinstance(value, (list, tuple, set)):
                    values = [item for item in value if item is not None]
                    if values:
                        must.append({"key": key, "match": {"any": values}})
                else:
                    must.append({"key": key, "match": {"value": value}})
        return {"must": must}

    @staticmethod
    def point_payload(
        *,
        workspace_id: str,
        document_id: str,
        chunk: VectorChunk,
    ) -> dict[str, Any]:
        return {
            "workspace_id": workspace_id,
            "document_id": document_id,
            "chunk_id": chunk.chunk_id,
            "filename": chunk.filename,
            "page_number": chunk.page_number,
            "chunk_index": chunk.chunk_index,
            "content_hash": chunk.content_hash,
            "content": chunk.content,
            "metadata": chunk.metadata,
        }

    @classmethod
    def point(
        cls,
        *,
        workspace_id: str,
        document_id: str,
        chunk: VectorChunk,
    ) -> dict[str, Any]:
        return {
            "id": cls.stable_point_id(chunk.chunk_id),
            "vector": chunk.embedding,
            "payload": cls.point_payload(
                workspace_id=workspace_id,
                document_id=document_id,
                chunk=chunk,
            ),
        }

    @classmethod
    def search_payload(
        cls,
        *,
        workspace_id: str,
        query_embedding: list[float],
        top_k: int,
        filters: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return {
            "vector": query_embedding,
            "limit": top_k,
            "with_payload": True,
            "filter": cls.workspace_filter(workspace_id, filters),
        }

    @classmethod
    def delete_payload(cls, *, workspace_id: str, document_id: str) -> dict[str, Any]:
        return {
            "filter": cls.workspace_filter(
                workspace_id,
                {"document_id": document_id},
            )
        }

    async def ensure_collection(self, *, vector_size: int, distance: str = "Cosine") -> None:
        """Create the collection when it is missing.

        Existing collections are left untouched so deployments do not rewrite
        production vector configuration during routine uploads.
        """
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(
                self._collection_endpoint(),
                headers=self._headers(),
            )
            if response.status_code == 200:
                await self._ensure_payload_indexes(client)
                return
            if response.status_code != 404:
                response.raise_for_status()
            create = await client.put(
                self._collection_endpoint(),
                json=self.collection_payload(vector_size=vector_size, distance=distance),
                headers=self._headers(),
            )
            create.raise_for_status()
            await self._ensure_payload_indexes(client)

    async def _ensure_payload_indexes(self, client: httpx.AsyncClient) -> None:
        for field_name, field_schema in self._PAYLOAD_INDEXES:
            response = await client.put(
                self._endpoint("/index?wait=true"),
                json=self.payload_index_payload(field_name, field_schema),
                headers=self._headers(),
            )
            if response.status_code in {200, 201, 409}:
                continue
            if response.status_code == 400 and "already exists" in response.text.lower():
                continue
            response.raise_for_status()

    async def upsert_chunks(
        self,
        *,
        workspace_id: str,
        document_id: str,
        chunks: list[VectorChunk],
    ) -> int:
        if not chunks:
            return 0
        payload = {
            "points": [
                self.point(workspace_id=workspace_id, document_id=document_id, chunk=chunk)
                for chunk in chunks
            ]
        }
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.put(
                self._endpoint("/points?wait=true"),
                json=payload,
                headers=self._headers(),
            )
            response.raise_for_status()
        return len(chunks)

    def search_sync(
        self,
        *,
        workspace_id: str,
        query_embedding: list[float],
        top_k: int,
        filters: dict[str, Any] | None = None,
    ) -> list[VectorSearchResult]:
        with httpx.Client(timeout=30) as client:
            response = client.post(
                self._endpoint("/points/search"),
                json=self.search_payload(
                    workspace_id=workspace_id,
                    query_embedding=query_embedding,
                    top_k=top_k,
                    filters=filters,
                ),
                headers=self._headers(),
            )
            response.raise_for_status()
            data = response.json()
        return self._results_from_search_response(data)

    async def search(
        self,
        *,
        workspace_id: str,
        query_embedding: list[float],
        top_k: int,
        filters: dict[str, Any] | None = None,
    ) -> list[VectorSearchResult]:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                self._endpoint("/points/search"),
                json=self.search_payload(
                    workspace_id=workspace_id,
                    query_embedding=query_embedding,
                    top_k=top_k,
                    filters=filters,
                ),
                headers=self._headers(),
            )
            response.raise_for_status()
            data = response.json()

        return self._results_from_search_response(data)

    @staticmethod
    def _results_from_search_response(data: dict[str, Any]) -> list[VectorSearchResult]:
        results: list[VectorSearchResult] = []
        for item in data.get("result", []):
            payload = item.get("payload") or {}
            results.append(
                VectorSearchResult(
                    chunk_id=str(payload.get("chunk_id") or item.get("id")),
                    document_id=str(payload.get("document_id") or ""),
                    content=str(payload.get("content") or ""),
                    score=float(item.get("score") or 0.0),
                    payload=payload,
                )
            )
        return results

    async def delete_document(self, *, workspace_id: str, document_id: str) -> int:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                self._endpoint("/points/delete?wait=true"),
                json=self.delete_payload(workspace_id=workspace_id, document_id=document_id),
                headers=self._headers(),
            )
            response.raise_for_status()
        return 0

    async def count_chunks(self, *, workspace_id: str) -> int:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                self._endpoint("/points/count"),
                json={
                    "exact": True,
                    "filter": self.workspace_filter(workspace_id),
                },
                headers=self._headers(),
            )
            response.raise_for_status()
            data = response.json()
        return int((data.get("result") or {}).get("count") or 0)

    def count_chunks_sync(self, *, workspace_id: str) -> int:
        with httpx.Client(timeout=10) as client:
            response = client.post(
                self._endpoint("/points/count"),
                json={
                    "exact": True,
                    "filter": self.workspace_filter(workspace_id),
                },
                headers=self._headers(),
            )
            response.raise_for_status()
            data = response.json()
        return int((data.get("result") or {}).get("count") or 0)
