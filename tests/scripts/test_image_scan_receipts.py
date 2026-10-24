import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[2] / 'scripts/containers/report-image-scans.py'


class ImageReceiptTests(unittest.TestCase):
    def run_report(self, reports):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for name, content in reports.items():
                (root / f'nexusrag-{name}-grype.json').write_text(json.dumps(content))
            env = {key: value for key, value in os.environ.items() if key != 'GITHUB_STEP_SUMMARY'}
            return subprocess.run([sys.executable, str(SCRIPT), '--report-dir', folder], text=True, capture_output=True, env=env)

    def report(self, severity=None):
        return {'descriptor': {'name': 'grype', 'version': 'synthetic-fixture'},
                'source': {'type': 'image', 'target': {'imageID': 'synthetic-local-image'}},
                'matches': [] if not severity else [{'vulnerability': {'id': 'SYNTHETIC-TEST', 'severity': severity}, 'artifact': {'name': 'synthetic-package', 'version': '1'}}]}

    def test_missing_scan_never_turns_green(self):
        result = self.run_report({'backend': self.report()})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('SCAN_RESULT_UNAVAILABLE', result.stdout)

    def test_medium_findings_fail_including_without_a_fix(self):
        result = self.run_report({'backend': self.report('Medium'), 'frontend': self.report()})
        self.assertNotEqual(result.returncode, 0)

    def test_suppressed_findings_are_rejected(self):
        report = self.report(); report['ignoredMatches'] = [{'synthetic': 'ignored'}]
        self.assertNotEqual(self.run_report({'backend': report, 'frontend': self.report()}).returncode, 0)

    def test_wrong_source_type_is_not_an_image_gate(self):
        report = self.report(); report['source']['type'] = 'directory'
        self.assertNotEqual(self.run_report({'backend': report, 'frontend': self.report()}).returncode, 0)

    def test_low_findings_remain_visible_not_suppressed(self):
        result = self.run_report({'backend': self.report('Low'), 'frontend': self.report()})
        self.assertEqual(result.returncode, 0)
        self.assertIn('SYNTHETIC-TEST', result.stdout)
        self.assertIn('Low', result.stdout)

    def test_every_finding_has_recoverable_fix_and_location_receipt(self):
        report = self.report('Medium')
        report['matches'][0]['vulnerability']['fix'] = {'state': 'fixed', 'versions': ['2']}
        report['matches'][0]['artifact']['locations'] = [{'path': '/synthetic/native/library'}]
        report['matches'] *= 21
        result = self.run_report({'backend': report, 'frontend': self.report()})
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(sum(line.startswith('IMAGE_FINDING ') for line in result.stdout.splitlines()), 21)
        self.assertIn('/synthetic/native/library', result.stdout)
        self.assertIn('"versions": ["2"]', result.stdout)

    def test_bounded_summary_prioritizes_critical_not_original_scan_order(self):
        report = self.report('Low'); report['matches'] *= 20
        critical = self.report('Critical')['matches'][0]
        critical['vulnerability']['id'] = 'SYNTHETIC-CRITICAL'
        report['matches'].append(critical)
        result = self.run_report({'backend': report, 'frontend': self.report()})
        self.assertIn('- SYNTHETIC-CRITICAL:', result.stdout)
        self.assertNotEqual(result.returncode, 0)




class ImageProvenanceTests(unittest.TestCase):
    run_report = ImageReceiptTests.run_report
    report = ImageReceiptTests.report
    def test_origin_layers_source_package_and_scanner_identity_remain_visible(self):
        report = self.report('High')
        report['matches'][0]['artifact'].update({'locations': [{'path': '/synthetic/library', 'layerID': 'synthetic-layer'}], 'metadata': {'sourceName': 'synthetic-source', 'sourceVersion': '1'}})
        report['matches'][0]['vulnerability'].update({'namespace': 'synthetic-distro', 'dataSource': 'https://example.invalid/synthetic-advisory'})
        result = self.run_report({'backend': report, 'frontend': self.report()})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('synthetic-layer', result.stdout)
        self.assertIn('synthetic-source', result.stdout)
        self.assertIn('IMAGE_SCAN_DESCRIPTOR', result.stdout)


if __name__ == '__main__':
    unittest.main()
