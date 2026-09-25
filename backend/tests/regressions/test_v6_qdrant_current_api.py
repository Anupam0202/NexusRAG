from pathlib import Path
import unittest


class QdrantCurrentApiContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = (
            Path(__file__).resolve().parents[2] / "src/vectorstores/qdrant_store.py"
        ).read_text()

    def test_query_points_replaces_retired_search_endpoint(self):
        self.assertIn('self._endpoint("/points/query")', self.source)
        self.assertNotIn('self._endpoint("/points/search")', self.source)
        self.assertIn('"query": query_embedding', self.source)

    def test_vector_identity_indexes_cover_tenant_version_and_generation(self):
        for field in ("workspace_id", "version_id", "index_generation"):
            self.assertIn(f'("{field}", "keyword")', self.source)
        self.assertIn('"version_id": chunk.metadata.get("version_id")', self.source)
        self.assertIn('"index_generation": chunk.metadata.get("index_generation")', self.source)


if __name__ == "__main__":
    unittest.main()