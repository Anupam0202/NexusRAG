"""Offline checks for the real interpreter/native runtime, not a security waiver."""
import _decimal
import bz2
import ctypes
import curses
import dbm.gnu
import decimal
import gzip
import json
import lzma
import os
from pathlib import Path
import platform
import readline
import shutil
import sqlite3
import ssl
import sys
import tempfile
import uuid
import xml.etree.ElementTree as ET
import zlib

import faiss
import numpy as np
import ormsgpack
import torch

from src.domain.deterministic_calculations import CalculationOperation, Quantity, calculate


assert sys.version_info[:3] == (3, 14, 8)
assert platform.freedesktop_os_release()["VERSION_ID"] == "26.04"
assert platform.freedesktop_os_release()["ID"] == "ubuntu"
assert all(not os.path.lexists(path) for path in ("/usr/bin/pebble", "/bin/pebble"))
assert shutil.which("pebble") is None
assert ssl.create_default_context().cert_store_stats()["x509_ca"] > 0
assert torch.version.cuda is None and "+cpu" in torch.__version__
assert decimal.Decimal is _decimal.Decimal
calculation = calculate(
    CalculationOperation.ADD,
    Quantity(decimal.Decimal("1e30"), "kg", ("synthetic-left",)),
    Quantity(decimal.Decimal("1"), "kg", ("synthetic-right",)),
    precision=18,
)
assert str(calculation.value) == "1000000000000000000000000000001.000000000000000000"
assert calculation.evidence_ids == ("synthetic-left", "synthetic-right")
assert hasattr(readline, "read_history_file") and hasattr(curses, "setupterm")
assert ctypes.CDLL(None).getpid() == os.getpid()
assert ET.fromstring("<root><value>synthetic</value></root>")[0].text == "synthetic"
assert uuid.UUID(str(uuid.uuid4())).version == 4
raw = b"non-sensitive runtime compression fixture" * 16
assert gzip.decompress(gzip.compress(raw)) == raw
assert bz2.decompress(bz2.compress(raw)) == raw
assert lzma.decompress(lzma.compress(raw)) == raw
assert zlib.decompress(zlib.compress(raw)) == raw
with sqlite3.connect(":memory:") as connection:
    connection.execute("CREATE TABLE fixture (value TEXT NOT NULL)")
    connection.execute("INSERT INTO fixture VALUES (?)", ("synthetic",))
    assert connection.execute("SELECT value FROM fixture").fetchone() == ("synthetic",)
mode = Path(os.environ["TMPDIR"]).stat().st_mode
assert mode & 0o777 == 0o700
assert Path(os.environ["TMPDIR"]).stat().st_uid == os.getuid() == 10001
with tempfile.TemporaryDirectory() as directory:
    with dbm.gnu.open(str(Path(directory) / "fixture-db"), "c") as database:
        database[b"fixture"] = b"synthetic"
        assert database[b"fixture"] == b"synthetic"
    vectors = np.asarray([[1.0, 0.0], [0.0, 1.0]], dtype="float32")
    index = faiss.IndexFlatIP(2)
    index.add(vectors)
    path = str(Path(directory) / "fixture.faiss")
    faiss.write_index(index, path)
    restored = faiss.read_index(path)
    scores, ids = restored.search(vectors[:1], 1)
    assert restored.ntotal == 2 and ids.tolist() == [[0]]
    assert np.allclose(scores, [[1.0]])
assert np.allclose(torch.from_numpy(vectors).numpy(), vectors)
checkpoint = {"messages": [{"role": "user", "content": "synthetic"}], "revision": 2}
assert ormsgpack.unpackb(ormsgpack.packb(checkpoint)) == checkpoint
print("REAL_PYTHON_STDLIB_AND_FAISS_PASSED " + json.dumps({
    "python": platform.python_version(), "os": "ubuntu26.04", "torch": torch.__version__,
    "faiss": faiss.__version__, "sqlite": sqlite3.sqlite_version,
    "zlib_runtime": zlib.ZLIB_RUNTIME_VERSION, "provider_processing": False,
    "native_decimal": True, "mpdecimal": _decimal.__libmpdec_version__,
    "unused_base_pebble": False,
    "production_acceptance": False,
}))
