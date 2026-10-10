"""Source checkpoint correctness without network or production credentials."""
import importlib.util
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
import zipfile

SPEC = importlib.util.spec_from_file_location('checkpoint_source', Path(__file__).resolve().parents[2] / 'scripts/checkpoint_source.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class CheckpointTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.root = self.base / 'source'
        self.root.mkdir()
        subprocess.run(['git', 'init', '-q', str(self.root)], check=True)
        self.git('config', 'user.name', 'Synthetic Test')
        self.git('config', 'user.email', 'test@example.invalid')
        (self.root / 'package-lock.json').write_text('{"lockfileVersion":3}\n')
        (self.root / 'RUN-STATE.md').write_text('Reverify after recovery.\n')
        (self.root / '.gitignore').write_text('private.env\n')
        (self.root / 'private.env').write_text('SYNTHETIC_ONLY=not-exported\n')
        self.git('add', '.')
        self.git('commit', '-qm', 'synthetic fixture')
        self.log = self.base / 'test.log'
        self.log.write_text('PASS synthetic fixture only\n')
        self.archive = self.base / 'checkpoint.zip'

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.root), *args])

    def test_roundtrip_preserves_all_tracked_source_locks_and_logs(self):
        manifest = MODULE.export(self.root, self.archive, [self.log])
        self.assertEqual(set(manifest['files']), {'.gitignore', 'package-lock.json', 'RUN-STATE.md'})
        self.assertEqual(MODULE.verify(self.archive), manifest)
        recovered = self.base / 'recovered'
        MODULE.recover(self.archive, recovered, hashlib.sha256(self.archive.read_bytes()).hexdigest())
        for name in manifest['files']:
            self.assertEqual((self.root / name).read_bytes(), (recovered / name).read_bytes())
        self.assertFalse((recovered / 'private.env').exists())
        self.assertFalse((recovered / '.git').exists())
        self.assertEqual((recovered / '.checkpoint/logs/test.log').read_bytes(), self.log.read_bytes())

    def test_dirty_and_untracked_source_fail_instead_of_being_omitted(self):
        for name in ['RUN-STATE.md', 'new-source.py']:
            with self.subTest(name=name):
                p = self.root / name
                old = p.read_bytes() if p.exists() else None
                p.write_text('unsaved change\n')
                with self.assertRaises(ValueError): MODULE.export(self.root, self.archive, [])
                if old is None:p.unlink()
                else:p.write_bytes(old)

    def test_never_overwrites_checkpoint_or_existing_recovery_directory(self):
        MODULE.export(self.root, self.archive, [])
        with self.assertRaises(ValueError): MODULE.export(self.root, self.archive, [])
        with self.assertRaises(ValueError): MODULE.recover(self.archive, self.root, hashlib.sha256(self.archive.read_bytes()).hexdigest())

    def test_output_inside_source_is_rejected(self):
        with self.assertRaises(ValueError): MODULE.export(self.root, self.root / 'checkpoint.zip', [])

    def test_duplicate_log_names_are_rejected(self):
        with self.assertRaises(ValueError): MODULE.export(self.root, self.archive, [self.log, self.log])

    def test_tracked_symlink_is_not_silently_exported(self):
        (self.root / 'link').symlink_to('RUN-STATE.md')
        self.git('add', 'link');self.git('commit', '-qm', 'symlink fixture')
        with self.assertRaises(ValueError): MODULE.export(self.root, self.archive, [])

    def test_tampering_and_unexpected_entries_are_rejected(self):
        MODULE.export(self.root, self.archive, [])
        with zipfile.ZipFile(self.archive) as z: items={n:z.read(n) for n in z.namelist()}
        for mutation in ['tamper', 'extra', 'traversal', 'missing']:
            with self.subTest(mutation=mutation):
                changed=dict(items)
                if mutation=='tamper':changed['RUN-STATE.md']=b'altered'
                if mutation=='extra':changed['unexpected.py']=b'bad'
                if mutation=='traversal':changed['../outside']=b'bad'
                if mutation=='missing':changed.pop('package-lock.json')
                target=self.base/(mutation+'.zip')
                with zipfile.ZipFile(target,'w') as z:
                    for n,b in changed.items():z.writestr(n,b)
                with self.assertRaises(ValueError):MODULE.verify(target)

    def test_unsafe_paths_are_rejected(self):
        for path in ['/abs', '../escape', 'a/../escape', 'a\\b', './file', 'a//b', '.git/config', '.GiT/hooks/post-checkout', 'C:/path']:
            with self.subTest(path=path), self.assertRaises(ValueError):MODULE.safe_name(path)

    def test_external_checksum_rejects_even_self_consistent_forged_manifest(self):
        MODULE.export(self.root, self.archive, [])
        trusted = hashlib.sha256(self.archive.read_bytes()).hexdigest()
        with zipfile.ZipFile(self.archive) as z: items={n:z.read(n) for n in z.namelist()}
        items['RUN-STATE.md']=b'forged'
        manifest=json.loads(items[MODULE.META]);manifest['files']['RUN-STATE.md'].update(sha256=hashlib.sha256(b'forged').hexdigest(),size=6)
        items[MODULE.META]=json.dumps(manifest).encode()
        forged=self.base/'forged.zip'
        with zipfile.ZipFile(forged,'w') as z:
            for n,b in items.items():z.writestr(n,b)
        MODULE.verify(forged) # Internal hashes alone do not authenticate an artifact.
        with self.assertRaises(ValueError):MODULE.recover(forged,self.base/'forged-recovery',trusted)
        self.assertFalse((self.base/'forged-recovery').exists())
