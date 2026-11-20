import importlib.util
from pathlib import Path
import unittest

script = Path(__file__).resolve().parents[2] / "scripts/containers/verify-opencv-runtime.py"
spec = importlib.util.spec_from_file_location("opencv_verification", script)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class OpenCVRuntimeProof(unittest.TestCase):
    def test_explicit_disabled_metadata_and_runtime(self):
        module.verify("Video I/O:\n  FFMPEG: NO", False, ["/opt/venv/cv2.abi3.so"])

    def test_upstream_omitted_disabled_label_requires_runtime_proof(self):
        module.verify("Video I/O:\n  v4l/v4l2: NO", False, [])

    def test_enabled_label_denied(self):
        with self.assertRaises(ValueError):
            module.verify("Video I/O:\n  FFMPEG: YES", False, [])

    def test_enabled_runtime_denied_even_without_label(self):
        with self.assertRaises(ValueError):
            module.verify("Video I/O:", True, [])

    def test_unknown_runtime_proof_denied(self):
        for unknown in (None, 0, "false"):
            with self.subTest(unknown=unknown), self.assertRaises(ValueError):
                module.verify("Video I/O:", unknown, [])

    def test_missing_capability_metadata_denied(self):
        with self.assertRaises(ValueError):
            module.verify("", False, [])

    def test_hidden_or_hashed_library_denied(self):
        for path in ("/opt/venv/cv2.libs/libavcodec-abcd.so.62", "/opt/venv/libavutil.so", "/opt/venv/libswresample.so"):
            with self.subTest(path=path), self.assertRaises(ValueError):
                module.verify("Video I/O:", False, [path])
