"""Guard the offline, secret-free self-managed image verification boundary."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]


class ContainerVerificationTests(unittest.TestCase):
    def test_opencv_build_supplies_missing_python315_numpy_without_disabling_isolation(self):
        dockerfile = (ROOT / 'backend/Dockerfile').read_text(encoding='utf-8')
        self.assertIn('COPY patches/opencv-numpy315.patch', dockerfile)
        opencv = dockerfile.split('COPY patches/opencv-numpy315.patch', 1)[1]
        self.assertIn('patch --batch --forward --fuzz=0', opencv)
        self.assertLess(opencv.index('sha256sum --check --strict'), opencv.index('patch --batch'))
        self.assertNotIn('--no-build-isolation', opencv)
        patch = (ROOT / 'backend/patches/opencv-numpy315.patch').read_text()
        self.assertIn('+  "numpy==2.5.3; python_version==\'3.15\'",', patch)
        self.assertEqual(sum(line.startswith('+  "numpy') for line in patch.splitlines()), 1)

    def test_custom_interpreter_preserves_native_decimal_calculations(self):
        dockerfile = (ROOT / 'backend/Dockerfile').read_text(encoding='utf-8')
        builder, runtime = dockerfile.split('# ── Stage 2: Runtime', 1)
        self.assertIn('libmpdec-dev', builder)
        self.assertIn('--with-system-libmpdec', builder)
        self.assertIn('libmpdec4', runtime)
        probe = (ROOT / 'scripts/containers/verify-python-runtime.py').read_text()
        self.assertIn('decimal.Decimal is _decimal.Decimal', probe)
        self.assertIn('CalculationOperation.ADD', probe)
        self.assertIn('1000000000000000000000000000001.000000000000000000', probe)

    def test_backend_uses_supported_pinned_lts_and_verified_stable_python(self):
        dockerfile = (ROOT / 'backend/Dockerfile').read_text(encoding='utf-8')
        self.assertEqual(dockerfile.count('FROM ubuntu:26.04@sha256:'), 2)
        self.assertIn('f144425ff09be612d6d9ad965196e9cdc23dae1f42110a8a11a3e9a8198759f7', dockerfile)
        self.assertIn('ENV PYTHON_VERSION=3.15.0', dockerfile)
        self.assertIn('ba4bed1ba346b916890b76d9e320451420aa69f6408997d33c66482eeae3d575', dockerfile)
        self.assertIn('sha256sum --check --strict', dockerfile)
        self.assertIn('https://www.python.org/ftp/python/', dockerfile)
        self.assertIn('COPY --from=python-build /opt/python /opt/python', dockerfile)
        self.assertNotIn('FROM python:3.13-slim', dockerfile)
        self.assertNotIn('add-apt-repository', dockerfile)
        self.assertNotRegex(dockerfile, r'\b(?:sid|forky)\b')
        self.assertIn('torch==2.14.1', dockerfile)

    def test_real_image_requires_interpreter_standard_library_and_faiss_checks(self):
        script = (ROOT / 'scripts/containers/verify-runtime.sh').read_text()
        self.assertIn('- < scripts/containers/verify-python-runtime.py', script)
        probe = (ROOT / 'scripts/containers/verify-python-runtime.py').read_text()
        for required in ('sys.version_info[:3]', 'ssl.create_default_context',
                         'sqlite3.connect', 'gzip.decompress', 'lzma.decompress',
                         'bz2.decompress', 'faiss.write_index', 'faiss.read_index',
                         'REAL_PYTHON_STDLIB_AND_FAISS_PASSED'):
            self.assertIn(required, probe)
        self.assertIn('torch.version.cuda is None', probe)
        self.assertIn('mode & 0o777 == 0o700', probe)

    def test_frontend_compiles_public_configuration_and_runs_non_root(self):
        dockerfile = (ROOT / 'frontend/Dockerfile').read_text()
        self.assertIn('FROM node:24-alpine', dockerfile)
        self.assertIn('USER node', dockerfile)
        self.assertIn('apk upgrade --no-cache', dockerfile)
        self.assertIn('rm -rf /usr/local/lib/node_modules/npm', dockerfile)
        self.assertIn('apk add --no-cache alpine-baselayout-data', dockerfile)
        self.assertIn('apk del alpine-baselayout busybox busybox-binsh ssl_client', dockerfile)
        self.assertLess(dockerfile.index('apk add --no-cache alpine-baselayout-data'),
                        dockerfile.index('apk del alpine-baselayout busybox'))
        self.assertIn('fs.chmodSync("/tmp",0o1777)', dockerfile)
        self.assertIn('ENTRYPOINT ["node"]', dockerfile)
        self.assertIn('CMD ["server.js"]', dockerfile)
        self.assertIn('/usr/local/bin/docker-entrypoint.sh', dockerfile)
        self.assertNotIn('--force-broken-world', dockerfile)
        self.assertNotIn('rm -rf /lib/apk', dockerfile)
        self.assertIn('ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', dockerfile)
        self.assertNotIn('SERVICE_ROLE', dockerfile)
        ignore = (ROOT / 'frontend/.dockerignore').read_text()
        self.assertIn('**/.env', ignore)
        self.assertIn('**/.env.*', ignore)
        self.assertIn('.next', ignore)
        compose = (ROOT / 'docker-compose.yml').read_text()
        self.assertNotIn('http://backend:8000', compose)
        self.assertIn('args:', compose)

    def test_backend_model_is_immutable_and_image_is_non_root(self):
        dockerfile = (ROOT / 'backend/Dockerfile').read_text(encoding='utf-8')
        self.assertRegex(dockerfile, r'ENV EMBEDDING_REVISION=[a-f0-9]{40}\b')
        self.assertIn("revision=os.environ['EMBEDDING_REVISION']", dockerfile)
        self.assertIn('trust_remote_code=False', dockerfile)
        self.assertIn('USER nexusrag', dockerfile)
        self.assertIn('python -m venv /opt/venv', dockerfile)
        self.assertIn('COPY --from=builder /opt/venv /opt/venv', dockerfile)
        self.assertIn('setuptools>=83.0.0', dockerfile)
        self.assertNotIn('setuptools>=78.1.1,<82', dockerfile)
        self.assertNotIn('|| true', dockerfile)
        runtime = dockerfile.split('# ── Stage 2: Runtime', 1)[1]
        for unused in ('poppler-utils', 'libgl1', 'libglib2.0-0', '\n    curl'):
            self.assertNotIn(unused, runtime)
        self.assertIn('apt-get upgrade -y', runtime)
        self.assertIn('ENV TMPDIR=/app/data/private_tmp', runtime)
        self.assertIn('chmod 0700 /app/data/private_tmp', dockerfile)
        self.assertIn('CMAKE_ARGS="-DWITH_FFMPEG=OFF"', dockerfile)
        self.assertRegex(dockerfile, r'opencv_python_headless-[0-9.]+\.tar\.gz#sha256=[a-f0-9]{64}')

    def test_ci_no_secret_or_cloud_publication_and_checks_exact_head(self):
        workflow = (ROOT / '.github/workflows/container-verification.yml').read_text()
        self.assertIn('runs-on: ubuntu-latest', workflow)
        self.assertIn('test "$REPOSITORY_VISIBILITY" = public', workflow)
        self.assertIn('github.event.pull_request.head.sha || github.sha', workflow)
        self.assertIn('persist-credentials: false', workflow)
        self.assertNotIn('secrets.', workflow)
        self.assertNotIn('upload-artifact', workflow)
        self.assertEqual(workflow.count('uses: anchore/scan-action@27805bf3b4e84b4a5c980df22ed233c00390a439'), 2)
        self.assertEqual(workflow.count('grype-version: v0.118.0'), 2)
        self.assertEqual(workflow.count('only-fixed: false'), 2)
        self.assertEqual(workflow.count('cache-db: false'), 2)
        self.assertNotIn('continue-on-error', workflow)
        self.assertIn('ignore: []', workflow)
        foundation = (ROOT / '.github/workflows/v6-foundation-ci.yml').read_text()
        self.assertIn('uses: ./.github/workflows/container-verification.yml', foundation)
        self.assertIn('CONTAINER_RESULT: ${{ needs.self-managed-runtime.result }}', foundation)
        self.assertIn('test "$CONTAINER_RESULT" = success', foundation)
        script = (ROOT / 'scripts/containers/verify-runtime.sh').read_text()
        self.assertNotRegex(script, r'docker\s+(push|login)')
        self.assertIn('ENABLE_LIGHTWEIGHT_EMBEDDINGS=false', script)
        self.assertIn('REAL_OFFLINE_NEURAL_EMBEDDING_PASSED', script)
        self.assertIn('REAL_NATIVE_PDF_IMAGE_FIXTURES_PASSED', script)
        self.assertIn('- < scripts/containers/verify-opencv-runtime.py', script)
        opencv_probe = (ROOT / 'scripts/containers/verify-opencv-runtime.py').read_text()
        self.assertIn('cv2.getBuildInformation()', opencv_probe)
        self.assertIn('cv2.videoio_registry.hasBackend(cv2.CAP_FFMPEG)', opencv_probe)
        self.assertIn('Path("/opt/venv").rglob("*")', opencv_probe)
        self.assertNotIn('--entrypoint sh', script)
        self.assertNotIn('frontend_container" sh', script)
        self.assertIn('urllib.request.urlopen', script)
        self.assertIn('--no-deps --disable-pip', script)
        self.assertIn('readiness', script)
        self.assertIn('--network none', script)
        self.assertNotIn('pip-audit" --ignore', script)


if __name__ == '__main__':
    unittest.main()
