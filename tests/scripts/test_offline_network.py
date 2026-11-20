"""Local self-pipes work without granting test code outbound socket access."""
from pathlib import Path
import subprocess
import sys
import unittest


class OfflineNetworkTests(unittest.TestCase):
    def test_asyncio_and_socketpair_work_while_network_calls_fail(self):
        guard = Path(__file__).resolve().parents[2] / "backend/scripts/offline_network.py"
        code = """
import asyncio, runpy, socket, sys
runpy.run_path(sys.argv[1])['install_network_guard']()
a, b = socket.socketpair()
try:
    a.send(b'fixture'); assert b.recv(7) == b'fixture'
finally:
    a.close(); b.close()
async def exercise():
    await asyncio.sleep(0)
    return 7
assert asyncio.run(exercise()) == 7
for family in (socket.AF_INET, socket.AF_INET6):
    with socket.socket(family, socket.SOCK_STREAM) as s:
        for operation in (s.connect, s.connect_ex):
            try: operation(('203.0.113.1', 443))
            except RuntimeError: pass
            else: raise AssertionError('Outbound socket was allowed')
for operation, args in ((socket.getaddrinfo, ('example.invalid',443)), (socket.create_connection, (('203.0.113.1',443),))):
    try: operation(*args)
    except RuntimeError: pass
    else: raise AssertionError('Outbound helper was allowed')
print('OFFLINE_NETWORK_GUARD_PASS')
"""
        result = subprocess.run([sys.executable, "-c", code, str(guard)],
                                capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("OFFLINE_NETWORK_GUARD_PASS", result.stdout)
