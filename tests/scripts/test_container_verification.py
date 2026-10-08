"""Guard the offline, secret-free self-managed image verification boundary."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]


class ContainerVerificationTests(unittest.TestCase):
    def test_frontend_compiles_public_configuration_and_runs_non_root(self):
        dockerfile = (ROOT / 'frontend/Dockerfile').read_text()
        self.assertIn('FROM node:24-alpine', dockerfile)
        self.assertIn('USER node', dockerfile)
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
        dockerfile = (ROOT / 'backend/Dockerfile').read_text()
        self.assertRegex(dockerfile, r'ENV EMBEDDING_REVISION=[a-f0-9]{40}\b')
        self.assertIn("revision=os.environ['EMBEDDING_REVISION']", dockerfile)
        self.assertIn('trust_remote_code=False', dockerfile)
        self.assertIn('USER nexusrag', dockerfile)
        self.assertIn('python -m venv /opt/venv', dockerfile)
        self.assertIn('COPY --from=builder /opt/venv /opt/venv', dockerfile)
        self.assertIn('setuptools>=83.0.0', dockerfile)
        self.assertNotIn('setuptools>=78.1.1,<82', dockerfile)
        self.assertNotIn('|| true', dockerfile)

    def test_ci_no_secret_or_cloud_publication_and_checks_exact_head(self):
        workflow = (ROOT / '.github/workflows/container-verification.yml').read_text()
        self.assertIn('runs-on: ubuntu-latest', workflow)
        self.assertIn('test "$REPOSITORY_VISIBILITY" = public', workflow)
        self.assertIn('github.event.pull_request.head.sha || github.sha', workflow)
        self.assertIn('persist-credentials: false', workflow)
        self.assertNotIn('secrets.', workflow)
        self.assertNotIn('upload-artifact', workflow)
        foundation = (ROOT / '.github/workflows/v6-foundation-ci.yml').read_text()
        self.assertIn('uses: ./.github/workflows/container-verification.yml', foundation)
        self.assertIn('CONTAINER_RESULT: ${{ needs.self-managed-runtime.result }}', foundation)
        self.assertIn('test "$CONTAINER_RESULT" = success', foundation)
        script = (ROOT / 'scripts/containers/verify-runtime.sh').read_text()
        self.assertNotRegex(script, r'docker\s+(push|login)')
        self.assertIn('ENABLE_LIGHTWEIGHT_EMBEDDINGS=false', script)
        self.assertIn('REAL_OFFLINE_NEURAL_EMBEDDING_PASSED', script)
        self.assertIn('--no-deps --disable-pip', script)
        self.assertIn('readiness', script)
        self.assertIn('--network none', script)
        self.assertNotIn('pip-audit" --ignore', script)


if __name__ == '__main__':
    unittest.main()
