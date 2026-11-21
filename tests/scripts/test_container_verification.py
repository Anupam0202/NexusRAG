"""Guard the offline, secret-free self-managed image verification boundary."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]


class ContainerVerificationTests(unittest.TestCase):
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
        # No package manager at runtime: apk-tools and libapk are the only users of the system OpenSSL, which Node
        # does not link (it carries its own), so their advisories never apply to the app (NX-52).
        self.assertIn('apk add --no-cache alpine-baselayout-data ca-certificates-bundle', dockerfile)
        self.assertIn('apk del alpine-baselayout busybox busybox-binsh ssl_client apk-tools', dockerfile)
        runtime = (ROOT / 'scripts/containers/verify-runtime.sh').read_text()
        self.assertIn('"/sbin/apk","/usr/bin/ssl_client"', runtime)
        self.assertIn('P:(apk-tools|libapk|ssl_client|libssl3|libcrypto3)', runtime)
        self.assertIn('Node TLS unavailable', runtime)
        self.assertIn('CA bundle missing', runtime)
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

    def test_ci_no_secret_or_cloud_publication_and_checks_exact_head(self):
        workflow = (ROOT / '.github/workflows/container-verification.yml').read_text()
        self.assertIn('runs-on: ubuntu-latest', workflow)
        self.assertIn('test "$REPOSITORY_VISIBILITY" = public', workflow)
        self.assertIn('github.event.pull_request.head.sha || github.sha', workflow)
        self.assertIn('persist-credentials: false', workflow)
        self.assertNotIn('secrets.', workflow)
        self.assertNotIn('upload-artifact', workflow)
        self.assertEqual(workflow.count('uses: anchore/scan-action@27805bf3b4e84b4a5c980df22ed233c00390a439'), 1)
        self.assertEqual(workflow.count('grype-version: v0.118.0'), 1)
        self.assertEqual(workflow.count('only-fixed: false'), 1)
        self.assertEqual(workflow.count('cache-db: false'), 1)
        self.assertNotIn('continue-on-error', workflow)
        # The self-managed frontend is the only image; the Python backend was removed (NX-31).
        self.assertNotIn('backend', workflow)
        self.assertIn('ignore: []', workflow)
        foundation = (ROOT / '.github/workflows/v6-foundation-ci.yml').read_text()
        self.assertIn('uses: ./.github/workflows/container-verification.yml', foundation)
        self.assertIn('CONTAINER_RESULT: ${{ needs.self-managed-runtime.result }}', foundation)
        self.assertIn('test "$CONTAINER_RESULT" = success', foundation)
        self.assertNotIn('backend', foundation)
        script = (ROOT / 'scripts/containers/verify-runtime.sh').read_text()
        self.assertNotRegex(script, r'docker\s+(push|login)')
        self.assertNotIn('--entrypoint sh', script)
        self.assertNotIn('frontend_container" sh', script)
        self.assertIn('--network none', script)
        self.assertNotIn('BACKEND', script)


if __name__ == '__main__':
    unittest.main()
