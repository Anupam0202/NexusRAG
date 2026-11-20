"""Run the complete backend suite without inherited secrets or outbound networking."""
from pathlib import Path
import os
import sys
from offline_network import install_network_guard

ROOT = Path(__file__).resolve().parents[1]
keep = {key: os.environ[key] for key in ('PATH', 'HOME', 'TMPDIR', 'SYSTEMROOT') if key in os.environ}
os.environ.clear()
os.environ.update(keep)
os.environ.update({
    'GOOGLE_API_KEY': 'test-only-not-a-real-key',
    'ENABLE_LIGHTWEIGHT_EMBEDDINGS': 'true',
    'HF_HUB_OFFLINE': '1', 'TRANSFORMERS_OFFLINE': '1',
    'DO_NOT_TRACK': '1', 'PYTEST_DISABLE_PLUGIN_AUTOLOAD': '1',
})
os.chdir(ROOT)
sys.path.insert(0, str(ROOT))

install_network_guard()

if __name__ == '__main__':
    import pytest
    raise SystemExit(pytest.main(['-p', 'pytest_asyncio.plugin', '-q', 'tests', *sys.argv[1:]]))
