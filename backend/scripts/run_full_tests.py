"""Run the complete backend suite without inherited secrets or outbound networking."""
from pathlib import Path
import os
import socket
import sys

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

def denied(*args, **kwargs):
    raise RuntimeError('Outbound networking is denied in backend tests')

original_connect = socket.socket.connect
original_connect_ex = socket.socket.connect_ex

def connect(sock, *args, **kwargs):
    if sock.family in (socket.AF_INET, socket.AF_INET6):
        return denied()
    return original_connect(sock, *args, **kwargs)

def connect_ex(sock, *args, **kwargs):
    if sock.family in (socket.AF_INET, socket.AF_INET6):
        return denied()
    return original_connect_ex(sock, *args, **kwargs)

socket.socket.connect = connect
socket.socket.connect_ex = connect_ex
socket.create_connection = denied
socket.getaddrinfo = denied
socket.socket.sendto = denied

if __name__ == '__main__':
    import pytest
    raise SystemExit(pytest.main(['-p', 'pytest_asyncio.plugin', '-q', 'tests', *sys.argv[1:]]))
