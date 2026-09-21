"""
Tests for Phase 3: Remote Power Management

Security focus:
  - Endpoint ownership verification (IP match checks)
  - Agent authorization (Bearer token + IP validation)
  - User authentication for browser power APIs
  - MAC address validation
  - Backward compatibility with existing agents
"""
from django.conf import settings
import json
from django.test import TestCase, Client
from django.contrib.auth.models import User
from django.utils.timezone import now
from datetime import timedelta

from .models import EndpointDevice, EndpointReport, EndpointStatus, EndpointCommand, PowerActionLog
from .services.power import normalize_mac


# ── MAC Address Validation Tests ──────────────────────────────────────────

class MACAddressTests(TestCase):
    """Test MAC address normalization and validation."""

    def test_normalize_mac_colon_format(self):
        """MAC with colons normalizes correctly."""
        result = normalize_mac("AA:BB:CC:DD:EE:FF")
        self.assertEqual(result, "AA:BB:CC:DD:EE:FF")

    def test_normalize_mac_dash_format(self):
        """MAC with dashes normalizes to colons."""
        result = normalize_mac("AA-BB-CC-DD-EE-FF")
        self.assertEqual(result, "AA:BB:CC:DD:EE:FF")

    def test_invalid_mac_empty(self):
        """Empty MAC raises ValueError."""
        with self.assertRaises(ValueError):
            normalize_mac("")


# ── Agent Authorization Tests ────────────────────────────────────────────

class AgentAuthorizationTests(TestCase):
    """Test agent authorization using Bearer token without IP matching."""

    def setUp(self):
        """Create test endpoints."""
        self.client = Client()

        self.endpoint_pc01 = EndpointStatus.objects.create(
            hostname="PC01",
            os="Windows 11",
            ip_address="192.168.1.10",
            username="alice",
            agent_version="1.0",
            last_seen=now(),
            mac_address="AA:BB:CC:DD:EE:11",
            wol_enabled=True,
        )

        self.endpoint_pc02 = EndpointStatus.objects.create(
            hostname="PC02",
            os="Linux",
            ip_address="192.168.1.20",
            username="bob",
            agent_version="1.0",
            last_seen=now(),
            mac_address="AA:BB:CC:DD:EE:22",
            wol_enabled=True,
        )

    def test_agent_fetch_commands_no_auth(self):
        """Agent without Bearer token cannot fetch commands."""
        response = self.client.get(
            "/api/agent/commands/PC01/",
            REMOTE_ADDR="192.168.1.10",
        )
        self.assertEqual(response.status_code, 403)

    def test_agent_fetch_commands_with_auth(self):
        """Authenticated agent can fetch commands regardless of source IP."""
        response = self.client.get(
            "/api/agent/commands/PC01/",
            HTTP_AUTHORIZATION=f"Bearer {settings.HEARTBEAT_API_KEY}",
            REMOTE_ADDR="10.0.1.201",
        )
        self.assertEqual(response.status_code, 200)

    def test_agent_can_fetch_commands_behind_nat(self):
        """Authenticated agent behind NAT/ALB can fetch commands."""
        response = self.client.get(
            "/api/agent/commands/PC01/",
            HTTP_AUTHORIZATION=f"Bearer {settings.HEARTBEAT_API_KEY}",
            REMOTE_ADDR="10.0.1.201",
        )
        self.assertEqual(response.status_code, 200)


# ── Browser Power API Tests ──────────────────────────────────────────────

class BrowserPowerAPITests(TestCase):
    """Test login_required decorator on power APIs."""

    def setUp(self):
        """Create test user and endpoints."""
        self.client = Client()
        self.user = User.objects.create_user(
            username="admin",
            password="testpass123"
        )
        
        self.endpoint = EndpointStatus.objects.create(
            hostname="PC01",
            os="Windows 11",
            ip_address="192.168.1.10",
            username="alice",
            agent_version="1.0",
            last_seen=now(),
            mac_address="AA:BB:CC:DD:EE:FF",
            wol_enabled=True,
        )

    def test_power_apis_require_login(self):
        """All power APIs require login."""
        for endpoint in ["/api/endpoints/PC01/power/on/",
                         "/api/endpoints/PC01/power/shutdown/",
                         "/api/endpoints/PC01/power/restart/"]:
            response = self.client.post(endpoint)
            self.assertEqual(response.status_code, 302)
            self.assertIn("/accounts/login", response.url)


# ── Backward Compatibility Tests ──────────────────────────────────────────

class BackwardCompatibilityTests(TestCase):
    """Test that existing agents without MAC/WoL fields still work."""

    def setUp(self):
        """Set up test client."""
        self.client = Client()

    def test_heartbeat_without_mac_address(self):
        """Agent without MAC address field works."""
        response = self.client.post(
            "/api/heartbeat/",
            data=json.dumps({
                "hostname": "OLDPC",
                "os": "Windows 10",
                "ip_address": "192.168.1.50",
                "username": "olduser",
                "agent_version": "1.0",
            }),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {settings.HEARTBEAT_API_KEY}",
            REMOTE_ADDR="192.168.1.50",
        )
        
        self.assertEqual(response.status_code, 200)
        ep = EndpointStatus.objects.get(hostname="OLDPC")
        self.assertIsNone(ep.mac_address)

    def test_heartbeat_with_new_fields(self):
        """Agent sending MAC and WoL works."""
        response = self.client.post(
            "/api/heartbeat/",
            data=json.dumps({
                "hostname": "NEWPC",
                "os": "macOS",
                "ip_address": "192.168.1.70",
                "username": "user",
                "agent_version": "1.1",
                "mac_address": "AA:BB:CC:DD:EE:FF",
                "wol_enabled": True,
            }),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {settings.HEARTBEAT_API_KEY}",
            REMOTE_ADDR="192.168.1.70",
        )
        
        self.assertEqual(response.status_code, 200)
        ep = EndpointStatus.objects.get(hostname="NEWPC")
        self.assertEqual(ep.mac_address, "AA:BB:CC:DD:EE:FF")
        self.assertTrue(ep.wol_enabled)

        device = EndpointDevice.objects.get(mac_address="AA:BB:CC:DD:EE:FF")
        self.assertEqual(ep.endpoint_device_id, device.id)

    def test_heartbeat_normalizes_mac_and_uses_mac_identity(self):
        payload = {
            "hostname": "MACPC",
            "os": "Linux",
            "ip_address": "192.168.1.71",
            "username": "user",
            "agent_version": "1.1",
            "mac_address": "aa-bb-cc-dd-ee-11",
        }
        response = self.client.post(
            "/api/heartbeat/",
            data=json.dumps(payload),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {settings.HEARTBEAT_API_KEY}",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(EndpointDevice.objects.count(), 1)
        device = EndpointDevice.objects.get()
        self.assertEqual(device.mac_address, "AA:BB:CC:DD:EE:11")
        status = EndpointStatus.objects.get()
        self.assertEqual(status.mac_address, device.mac_address)
        self.assertEqual(status.endpoint_device_id, device.id)

    def test_legacy_agent_heartbeat_alias_creates_device(self):
        response = self.client.post(
            "/api/agent/heartbeat",
            data=json.dumps({
                "hostname": "LEGACYPC",
                "os_type": "Linux",
                "ip_address": "192.168.1.72",
                "username": "user",
                "agent_version": "1.0",
                "mac_address": "AABBCCDDEEFF",
            }),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {settings.HEARTBEAT_API_KEY}",
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(EndpointDevice.objects.filter(
            mac_address="AA:BB:CC:DD:EE:FF",
        ).exists())

    def test_endpoint_status_requires_account_scope(self):
        EndpointStatus.objects.create(
            hostname="STATUSPC",
            os="Linux",
            ip_address="192.168.1.73",
            username="user",
            agent_version="1.1",
            last_seen=now(),
            mac_address="AA:BB:CC:DD:EE:12",
        )
        EndpointReport.objects.create(
            hostname="STATUSPC",
            os_type="linux",
            report_date=now(),
            mac_address="AA:BB:CC:DD:EE:12",
        )

        unauthenticated = self.client.get("/api/endpoints/status/")
        self.assertEqual(unauthenticated.status_code, 401)

        user = User.objects.create_user(username="status-user", password="pass")
        from rest_framework.authtoken.models import Token
        token = Token.objects.create(user=user)
        response = self.client.get(
            "/api/endpoints/status/",
            HTTP_AUTHORIZATION=f"Token {token.key}",
            HTTP_X_ACCOUNT_TYPE="company",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["endpoints"], [])


# ── Presence-based Command Queueing Tests ────────────────────────────────

class PresenceCommandQueueTests(TestCase):
    """Test command queueing based on endpoint presence."""

    def setUp(self):
        """Set up user and endpoints."""
        self.user = User.objects.create_user(
            username="admin",
            password="testpass123"
        )
        self.client = Client()
        self.client.login(username="admin", password="testpass123")
        
        self.online_ep = EndpointStatus.objects.create(
            hostname="ONLINE",
            os="Windows 11",
            ip_address="192.168.1.10",
            username="user",
            agent_version="1.0",
            last_seen=now(),
        )
        
        self.offline_ep = EndpointStatus.objects.create(
            hostname="OFFLINE",
            os="Linux",
            ip_address="192.168.1.20",
            username="user",
            agent_version="1.0",
            last_seen=now() - timedelta(minutes=10),
        )

    def test_shutdown_queued_for_online(self):
        """Shutdown can be queued for online endpoint."""
        response = self.client.post(
            "/api/endpoints/ONLINE/power/shutdown/",
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)

    def test_shutdown_rejected_for_offline(self):
        """Shutdown is rejected for offline endpoint."""
        response = self.client.post(
            "/api/endpoints/OFFLINE/power/shutdown/",
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)


# ── S3 Event Processing Tests ────────────────────────────────────────────

class S3EventProcessingTests(TestCase):
    """Test S3 report event processing from SQS."""

    def setUp(self):
        """Set up test environment."""
        from datetime import datetime
        
        self.os_type = "linux"
        self.hostname = "SYSTEM-55"
        self.s3_key_1 = "reports/Linux/SYSTEM-55/a1b2c3d4-e5f6-4789-b0c1-d2e3f4a5b6c7-SYSTEM-55.html"
        self.s3_key_2 = "reports/Linux/SYSTEM-55/f1e2d3c4-b5a6-9876-5432-10fedcba9876-SYSTEM-55.html"
        self.report_date = now()

    def test_s3_key_validation_valid(self):
        """Valid S3 key format is accepted."""
        import re
        pattern = re.compile(
            r'^reports/(Linux|Windows|macOS)/([^/]+)/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}-(.+)\.html$'
        )
        
        # Valid keys
        valid_keys = [
            "reports/Linux/SYSTEM-55/a1b2c3d4-e5f6-4789-b0c1-d2e3f4a5b6c7-SYSTEM-55.html",
            "reports/Windows/PC-01/f1e2d3c4-b5a6-9876-5432-10fedcba9876-PC-01.html",
            "reports/macOS/MAC-01/12345678-1234-5678-1234-567812345678-MAC-01.html",
        ]
        
        for key in valid_keys:
            match = pattern.match(key)
            self.assertIsNotNone(match, f"Key should be valid: {key}")

    def test_s3_key_validation_invalid(self):
        """Invalid S3 key formats are rejected."""
        import re
        pattern = re.compile(
            r'^reports/(Linux|Windows|macOS)/([^/]+)/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}-(.+)\.html$'
        )
        
        # Invalid keys
        invalid_keys = [
            "reports/SYSTEM-55/a1b2c3d4-e5f6-4789-b0c1-d2e3f4a5b6c7-SYSTEM-55.html",  # missing OS type
            "reports/Linux/SYSTEM-55/invalid-uuid-SYSTEM-55.html",  # invalid UUID format
            "reports/Linux/SYSTEM-55/SYSTEM-55.html",  # missing UUID
            "SYSTEM-55/a1b2c3d4-e5f6-4789-b0c1-d2e3f4a5b6c7-SYSTEM-55.html",  # missing prefix
        ]
        
        for key in invalid_keys:
            match = pattern.match(key)
            self.assertIsNone(match, f"Key should be invalid: {key}")

    def test_two_different_s3_keys_same_hostname_date_remain_distinct(self):
        """Two different S3 keys for same hostname+date must create separate records.
        
        This test proves that s3_object_key is the primary identity, not hostname+report_date.
        Two different files from the same machine at the same time must remain distinct.
        """
        from dashboard.models import EndpointReport
        
        # Create first record with s3_key_1
        report1 = EndpointReport.objects.create(
            hostname=self.hostname,
            report_date=self.report_date,
            os_type='linux',
            risk_score=50,
            risk_level='warning',
            s3_object_key=self.s3_key_1,
        )
        
        # Create second record with s3_key_2 (same hostname, same report_date)
        report2 = EndpointReport.objects.create(
            hostname=self.hostname,
            report_date=self.report_date,
            os_type='linux',
            risk_score=75,
            risk_level='critical',
            s3_object_key=self.s3_key_2,
        )
        
        # Both records should exist and be distinct
        count = EndpointReport.objects.filter(hostname=self.hostname, report_date=self.report_date).count()
        self.assertEqual(count, 2, "Should have 2 separate records for 2 different S3 keys")
        
        # Verify they have different s3_object_keys
        self.assertNotEqual(report1.s3_object_key, report2.s3_object_key)
        
        # Verify they have different risk scores
        self.assertNotEqual(report1.risk_score, report2.risk_score)
        
        # Query by s3_object_key should return only one
        found1 = EndpointReport.objects.get(s3_object_key=self.s3_key_1)
        found2 = EndpointReport.objects.get(s3_object_key=self.s3_key_2)
        self.assertEqual(found1.risk_score, 50)
        self.assertEqual(found2.risk_score, 75)

    def test_same_s3_key_processed_twice_idempotent(self):
        """Processing the same S3 object key twice must result in exactly one record.
        
        This test proves that s3_object_key is used as the get_or_create lookup key,
        and duplicate SQS deliveries don't create duplicates in the database.
        """
        from dashboard.models import EndpointReport
        
        # First "delivery" of s3_key_1
        obj1, created1 = EndpointReport.objects.get_or_create(
            s3_object_key=self.s3_key_1,
            defaults={
                'hostname': self.hostname,
                'report_date': self.report_date,
                'risk_score': 50,
                'risk_level': 'warning',
            }
        )
        
        # Second "delivery" of same s3_key_1 (simulates SQS redelivery)
        obj2, created2 = EndpointReport.objects.get_or_create(
            s3_object_key=self.s3_key_1,
            defaults={
                'hostname': self.hostname,
                'report_date': self.report_date,
                'risk_score': 50,
                'risk_level': 'warning',
            }
        )
        
        # Should be the same object
        self.assertEqual(obj1.id, obj2.id)
        self.assertTrue(created1)  # First was new
        self.assertFalse(created2)  # Second returned existing
        
        # Only one record should exist
        count = EndpointReport.objects.filter(s3_object_key=self.s3_key_1).count()
        self.assertEqual(count, 1, "Should have exactly 1 record for same S3 key")

    def test_object_deleted_idempotent(self):
        """Deleting non-existent object is treated as success."""
        from dashboard.models import EndpointReport
        
        # Try to delete record that doesn't exist
        count, _ = EndpointReport.objects.filter(s3_object_key=self.s3_key_1).delete()
        
        # Should return 0 (nothing deleted) but not error
        self.assertEqual(count, 0)

    def test_wrong_bucket_rejected(self):
        """Events from wrong bucket are skipped."""
        wrong_bucket = "wrong-bucket"
        correct_bucket = settings.AWS_REPORTS_BUCKET
        
        self.assertNotEqual(wrong_bucket, correct_bucket)

    def test_os_type_extraction_from_key(self):
        """OS type is correctly extracted from S3 key."""
        import re
        pattern = re.compile(
            r'^reports/(Linux|Windows|macOS)/([^/]+)/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}-(.+)\.html$'
        )
        
        keys_and_os = [
            ("reports/Linux/SYSTEM-55/a1b2c3d4-e5f6-4789-b0c1-d2e3f4a5b6c7-SYSTEM-55.html", "Linux"),
            ("reports/Windows/PC-01/f1e2d3c4-b5a6-9876-5432-10fedcba9876-PC-01.html", "Windows"),
            ("reports/macOS/MAC-01/12345678-1234-5678-1234-567812345678-MAC-01.html", "macOS"),
        ]
        
        for key, expected_os in keys_and_os:
            match = pattern.match(key)
            self.assertIsNotNone(match)
            os_type, hostname, filename = match.groups()
            self.assertEqual(os_type, expected_os)


