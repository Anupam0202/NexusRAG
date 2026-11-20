from pathlib import Path
import importlib.util
import unittest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "os_runtime", ROOT / "scripts/containers/report-os-runtime.py"
)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class OSInventoryTests(unittest.TestCase):
    def test_only_actually_installed_packages_are_reported_with_source(self):
        rows = MODULE.packages(
            "Package: installed\nStatus: install ok installed\nVersion: 1\nArchitecture: amd64\nSource: source (1)\n\nPackage: removed\nStatus: deinstall ok config-files\nVersion: 2\nArchitecture: amd64\n"
        )
        self.assertEqual(
            rows,
            [
                {
                    "Package": "installed",
                    "Version": "1",
                    "Architecture": "amd64",
                    "Source": "source (1)",
                }
            ],
        )

    def test_empty_inventory_is_not_success(self):
        with self.assertRaises(ValueError):
            MODULE.packages("")

    def test_malformed_installed_package_is_not_silently_skipped(self):
        with self.assertRaises(ValueError):
            MODULE.packages("Package: invalid\nStatus: install ok installed\n")

    def test_actual_image_is_inspected_without_network_or_shell_entrypoint(self):
        script = (ROOT / "scripts/containers/verify-runtime.sh").read_text()
        self.assertIn(
            'docker run --rm -i --network none --entrypoint python "$BACKEND" - < scripts/containers/report-os-runtime.py',
            script,
        )
        self.assertNotIn("rm -rf /var/lib/dpkg", script)


if __name__ == "__main__":
    unittest.main()
