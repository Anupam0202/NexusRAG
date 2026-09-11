from __future__ import annotations

import unittest


class UploadSecurityTests(unittest.TestCase):
    def test_preflight_rejects_oversize_and_unsupported_media(self):
        from src.domain.upload_security import UploadPreflight

        with self.assertRaisesRegex(ValueError, "UPLOAD_LIMIT_EXCEEDED"):
            UploadPreflight("large.pdf", "application/pdf", 25_000_001).validate()
        with self.assertRaisesRegex(ValueError, "UNSUPPORTED_MEDIA_TYPE"):
            UploadPreflight("payload.exe", "application/octet-stream", 10).validate()

    def test_media_sniffing_blocks_declared_type_confusion(self):
        from src.domain.upload_security import require_media_match, sniff_media_type

        sniffed = sniff_media_type(b"%PDF-1.7\n")
        self.assertEqual(sniffed, "application/pdf")
        with self.assertRaisesRegex(ValueError, "MEDIA_TYPE_MISMATCH"):
            require_media_match("image/png", sniffed)

    def test_office_documents_accept_zip_container_signature(self):
        from src.domain.upload_security import require_media_match, sniff_media_type

        sniffed = sniff_media_type(b"PK\x03\x04payload")
        require_media_match(
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            sniffed,
        )

    def test_archive_bomb_limits_and_zip_slip_paths(self):
        from src.domain.upload_security import ArchiveManifest

        with self.assertRaisesRegex(ValueError, "ARCHIVE_RATIO_LIMIT"):
            ArchiveManifest(1_000, 100_001, 1, ("safe.txt",)).validate()
        with self.assertRaisesRegex(ValueError, "ARCHIVE_UNSAFE_PATH"):
            ArchiveManifest(1_000, 2_000, 1, ("../escape.txt",)).validate()

    def test_server_path_cannot_be_user_selected(self):
        from src.domain.upload_security import server_object_key

        workspace = "550e8400-e29b-41d4-a716-446655440000"
        document = "123e4567-e89b-42d3-a456-426614174000"
        version = "987fcdeb-51a2-43d7-8f9e-123456789abc"
        self.assertEqual(
            server_object_key(workspace, document, version),
            f"{workspace}/{document}/{version}/original",
        )
        with self.assertRaisesRegex(ValueError, "INVALID_OBJECT_IDENTITY"):
            server_object_key("../../other-workspace", document, version)

    def test_signed_download_expiry_is_bounded(self):
        from src.domain.upload_security import signed_download_ttl

        self.assertEqual(signed_download_ttl(60), 60)
        self.assertEqual(signed_download_ttl(86_400), 900)
        with self.assertRaisesRegex(ValueError, "INVALID_DOWNLOAD_TTL"):
            signed_download_ttl(0)

    def test_content_receipt_is_deterministic(self):
        from src.domain.upload_security import content_receipt

        digest, size = content_receipt(b"evidence")
        self.assertEqual(size, 8)
        self.assertEqual(
            digest,
            "ee8250fb76e094b34b471f13a73dbbe51d1ae142e9df59d7c0d31ec20f0a0a8e",
        )


if __name__ == "__main__":
    unittest.main()
