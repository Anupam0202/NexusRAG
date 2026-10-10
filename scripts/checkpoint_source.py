"""Export/verify/recover clean tracked source with explicit, hash-verified logs.

Never includes ignored/untracked files, .git, credentials or runtime caches.
Log selection remains the operator's responsibility: use sanitized test logs only.
Recovery restores source, not dependencies, git history or historical test validity.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import re
from pathlib import Path, PurePosixPath
import stat
import subprocess
import zipfile

META = '.checkpoint/manifest.json'
MAX_TOTAL = 1_000_000_000
MAX_FILE = 200_000_000


def git(root: Path, *args: str) -> bytes:
    return subprocess.check_output(['git', '-C', str(root), *args])


def safe_name(name: str) -> None:
    p = PurePosixPath(name)
    if not name or p.is_absolute() or '..' in p.parts or '\\' in name or str(p) != name or '\x00' in name or ':' in name or p.parts[0].casefold() == '.git':
        raise ValueError('Unsafe archive path')


def digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def export(root: Path, output: Path, logs: list[Path]) -> dict:
    root, output = root.resolve(), output.resolve()
    if output.is_relative_to(root):
        raise ValueError('Checkpoint must be outside the source checkout')
    if output.exists():
        raise ValueError('Refusing to overwrite an existing checkpoint')
    if git(root, 'status', '--porcelain').strip():
        raise ValueError('Save/publish source first: checkout must be clean')
    revision = git(root, 'rev-parse', 'HEAD').decode().strip()
    entries = git(root, 'ls-tree', '-rz', '--full-tree', 'HEAD').split(b'\0')
    files = {}
    for entry in entries:
        if not entry:
            continue
        metadata, raw_path = entry.split(b'\t', 1)
        mode, kind, oid = metadata.decode().split()
        name = raw_path.decode('utf-8')
        safe_name(name)
        if PurePosixPath(name).parts[0] == '.checkpoint' or kind != 'blob' or mode not in ('100644', '100755'):
            raise ValueError('Unsupported source entry; no silent omission')
        content = git(root, 'cat-file', 'blob', oid)
        if (root / name).read_bytes() != content:
            raise ValueError('Working source differs from committed bytes')
        files[name] = {'sha256': digest(content), 'size': len(content), 'mode': mode}
    receipts = {}
    for log in logs:
        name = log.name
        safe_name(name)
        if name in receipts:
            raise ValueError('Duplicate log basename')
        content = log.read_bytes()
        receipts[name] = {'sha256': digest(content), 'size': len(content)}
    manifest = {'schema_version': 1, 'source_commit': revision,
                'files': files, 'logs': receipts,
                'recovery_notice': 'Reinstall dependencies and rerun verification after recovery; logs are historical evidence, not a new pass.'}
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + '.partial')
    try:
        with zipfile.ZipFile(temporary, 'x', compression=zipfile.ZIP_DEFLATED) as archive:
            for name, info in files.items():
                zi = zipfile.ZipInfo(name)
                zi.compress_type = zipfile.ZIP_DEFLATED
                zi.external_attr = (stat.S_IFREG | (0o755 if info['mode'] == '100755' else 0o644)) << 16
                archive.writestr(zi, (root / name).read_bytes())
            for log in logs:
                archive.writestr('.checkpoint/logs/' + log.name, log.read_bytes())
            archive.writestr(META, json.dumps(manifest, indent=2) + '\n')
        verified = verify(temporary)
        if verified != manifest:
            raise ValueError('Checkpoint manifest mismatch')
        if git(root, 'status', '--porcelain').strip() or git(root, 'rev-parse', 'HEAD').decode().strip() != revision:
            raise ValueError('Source changed during checkpoint export')
        temporary.rename(output)
    finally:
        temporary.unlink(missing_ok=True)
    return manifest


def verify(path: Path, expected_sha256: str | None = None) -> dict:
    if expected_sha256 is not None and (not re.fullmatch(r'[0-9a-f]{64}', expected_sha256) or digest(path.read_bytes()) != expected_sha256):
        raise ValueError('Archive differs from trusted external checksum')
    with zipfile.ZipFile(path) as archive:
        infos = archive.infolist()
        names = [x.filename for x in infos]
        if len(names) != len(set(names)) or sum(x.file_size for x in infos) > MAX_TOTAL:
            raise ValueError('Duplicate or oversized archive')
        for info in infos:
            safe_name(info.filename)
            if info.file_size > MAX_FILE or stat.S_ISLNK(info.external_attr >> 16) or info.is_dir():
                raise ValueError('Unsupported archive entry')
        if archive.getinfo(META).file_size > 10_000_000:
            raise ValueError('Oversized manifest')
        manifest = json.loads(archive.read(META))
        if not re.fullmatch(r'[0-9a-f]{40}|[0-9a-f]{64}', str(manifest.get('source_commit', ''))) or manifest.get('schema_version') != 1 or not isinstance(manifest.get('files'), dict) or not isinstance(manifest.get('logs'), dict):
            raise ValueError('Invalid checkpoint manifest')
        expected = {META} | set(manifest['files']) | {'.checkpoint/logs/' + name for name in manifest['logs']}
        if set(names) != expected:
            raise ValueError('Missing or unexpected checkpoint entry')
        for section in ('files', 'logs'):
            for name, info in manifest[section].items():
                safe_name(name)
                if section == 'files' and PurePosixPath(name).parts[0] == '.checkpoint':
                    raise ValueError('Reserved source path')
                if section == 'logs' and PurePosixPath(name).name != name:
                    raise ValueError('Unsafe log basename')
                entry = name if section == 'files' else '.checkpoint/logs/' + name
                if not isinstance(info, dict) or (section == 'files' and info.get('mode') not in ('100644', '100755')):
                    raise ValueError('Invalid entry metadata')
                content = archive.read(entry)
                if len(content) != info['size'] or digest(content) != info['sha256']:
                    raise ValueError('Checkpoint hash/size mismatch')
    return manifest


def recover(path: Path, destination: Path, expected_sha256: str) -> dict:
    manifest = verify(path, expected_sha256)
    destination = destination.resolve()
    if destination.exists():
        raise ValueError('Recover only into a new destination; never overwrite work')
    destination.mkdir(parents=True)
    with zipfile.ZipFile(path) as archive:
        for name in manifest['files']:
            target = destination / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.read(name))
            target.chmod(0o755 if manifest['files'][name]['mode'] == '100755' else 0o644)
        evidence = destination / '.checkpoint'
        evidence.mkdir()
        (evidence / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
        (evidence / 'logs').mkdir()
        for name in manifest['logs']:
            (evidence / 'logs' / name).write_bytes(archive.read('.checkpoint/logs/' + name))
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['export', 'verify', 'recover'])
    parser.add_argument('--root', type=Path, default=Path.cwd())
    parser.add_argument('--archive', type=Path, required=True)
    parser.add_argument('--log', type=Path, action='append', default=[])
    parser.add_argument('--destination', type=Path)
    parser.add_argument('--expected-sha256', help='Trusted out-of-band archive checksum; required for recovery')
    args = parser.parse_args()
    if args.operation == 'export':
        result = export(args.root, args.archive, args.log)
    elif args.operation == 'verify':
        result = verify(args.archive, args.expected_sha256)
    else:
        if args.destination is None or args.expected_sha256 is None:
            parser.error('recover requires --destination and trusted --expected-sha256')
        result = recover(args.archive, args.destination, args.expected_sha256)
    print(json.dumps({'source_commit': result['source_commit'], 'source_files': len(result['files']), 'logs': len(result['logs']), 'hash_verification': 'PASS', 'tests_reexecuted_by_this_command': False}))


if __name__ == '__main__':
    main()
