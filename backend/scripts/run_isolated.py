"""New offline regression entry point; NOT a replacement for the full pytest suite."""
from __future__ import annotations
import os
from pathlib import Path
import sys
import unittest
from offline_network import install_network_guard

ROOT = Path(__file__).resolve().parents[1]
# Do not inherit live keys, endpoints, proxies, .env settings, or model credentials.
keep = {key: os.environ[key] for key in ("PATH", "HOME", "TMPDIR", "SYSTEMROOT") if key in os.environ}
os.environ.clear()
os.environ.update(keep)
os.environ.update({
    "GOOGLE_API_KEY": "test-only-not-a-real-key",
    "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1",
    "DO_NOT_TRACK": "1", "PYTEST_DISABLE_PLUGIN_AUTOLOAD": "1",
    "NEXUSRAG_TEST_PROFILE": "isolated", "ENABLE_ANONYMOUS_DEMO": "false",
})
sys.path.insert(0, str(ROOT))

install_network_guard()
if __name__ == "__main__":
    suite = unittest.defaultTestLoader.discover(str(ROOT / "tests/regressions"), pattern="test_*.py")
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    if not result.testsRun or result.skipped:
        raise SystemExit("Required isolated regression suite was empty or skipped")
    raise SystemExit(0 if result.wasSuccessful() else 1)
