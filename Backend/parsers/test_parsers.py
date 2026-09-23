import tempfile
import unittest
from pathlib import Path

from . import linux_parser, macos_parser, windows_parser


SCORECARD = """
<h2>Security Scorecard</h2>
<table>
  <tr><th>Security Check</th><th>Result</th><th>Detail</th></tr>
  <tr><td>Pending OS Updates</td><td>Pass</td><td>System is up to date</td></tr>
  <tr><td>Disk Encryption (BitLocker)</td><td>Fail</td><td>No encrypted volumes found</td></tr>
  <tr><td>Antivirus / EDR</td><td>Pass</td><td>Protection enabled</td></tr>
  <tr><td>Firewall</td><td>Pass</td><td>Firewall active</td></tr>
  <tr><td>Secure Boot</td><td>Info</td><td>N/A - Legacy BIOS</td></tr>
  <tr><td>TPM Present</td><td>Warn</td><td>TPM Not Detected</td></tr>
</table>
"""


class ParserTests(unittest.TestCase):
    def parse_html(self, parser, html):
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".html", encoding="utf-8", delete=False
        ) as report_file:
            report_file.write(html)
            path = Path(report_file.name)
        try:
            return parser.parse(path)
        finally:
            path.unlink()

    def test_windows_current_report_layout_uses_scorecard_and_labels(self):
        html = f"""
        <html><body>
          <p>Generated: 09/23/2026 08:00:23</p>
          {SCORECARD}
          <h2>System Information</h2>
          <table>
            <tr><th>Parameter</th><th>Value</th></tr>
            <tr><td>Hostname</td><td>SYSTEM-56</td></tr>
            <tr><td>OS</td><td>Windows 11</td></tr>
            <tr><td>Version</td><td>10.0.26100</td></tr>
            <tr><td>Architecture</td><td>64-bit</td></tr>
            <tr><td>CPU</td><td>Test CPU</td></tr>
            <tr><td>RAM</td><td>16 GB</td></tr>
            <tr><td>IP Address</td><td>192.168.1.56</td></tr>
          </table>
        </body></html>
        """
        data = self.parse_html(windows_parser, html.replace("Windows 11", "Windows 11 Microsoft"))

        self.assertEqual(data["hostname"], "SYSTEM-56")
        self.assertEqual(data["ip_address"], "192.168.1.56")
        self.assertTrue(data["firewall_enabled"])
        self.assertFalse(data["encryption_enabled"])
        self.assertTrue(data["antivirus_installed"])
        self.assertFalse(data["secure_boot_enabled"])
        self.assertFalse(data["tpm_present"])

    def test_linux_scorecard_controls_are_normalized(self):
        html = f"""
        <html><body><p>Linux audit</p>{SCORECARD}
        <h2>System Information</h2>
        <table><tr><td>Hostname</td><td>linux-01</td></tr></table>
        </body></html>
        """
        data = self.parse_html(linux_parser, html)

        self.assertTrue(data["firewall_enabled"])
        self.assertFalse(data["encryption_enabled"])
        self.assertTrue(data["antivirus_installed"])

    def test_macos_scorecard_controls_are_normalized(self):
        html = f"""
        <html><body><p>macOS audit</p>{SCORECARD}
        <table><tr><td>Hostname</td><td>mac-01</td></tr></table>
        </body></html>
        """
        data = self.parse_html(macos_parser, html)

        self.assertTrue(data["firewall_enabled"])
        self.assertFalse(data["encryption_enabled"])
        self.assertTrue(data["antivirus_installed"])


if __name__ == "__main__":
    unittest.main()
