"""
Common data model for endpoint security audit reports.
Every Windows, Linux, and macOS report maps to these fields.
"""
from django.db import models
import uuid


class EndpointReport(models.Model):
    # ── Identity ──────────────────────────────────────────────────────────
    endpoint_device = models.ForeignKey(
        "EndpointDevice", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="reports",
    )
    mac_address    = models.CharField(max_length=17, null=True, blank=True, db_index=True)  # Link to EndpointStatus
    hostname       = models.CharField(max_length=255)
    os_type        = models.CharField(
        max_length=10,
        choices=[("windows", "Windows"), ("linux", "Linux"), ("macos", "macOS")],
    )
    os_name        = models.CharField(max_length=255, blank=True)   # e.g. "Ubuntu 24.04.3 LTS"
    os_version     = models.CharField(max_length=100, blank=True)   # build / kernel
    architecture   = models.CharField(max_length=50,  blank=True)
    ip_address     = models.CharField(max_length=60,  blank=True)
    report_date    = models.DateTimeField()                         # parsed from report
    imported_at    = models.DateTimeField(auto_now_add=True)        # when we ingested it
    report_file    = models.CharField(max_length=512, blank=True)   # original HTML path (Samba/local)
    s3_object_key  = models.CharField(max_length=1024, blank=True)  # S3 object key (production)
    storage_provider = models.CharField(max_length=20, blank=True, default="local")

    # ── Hardware ──────────────────────────────────────────────────────────
    cpu            = models.CharField(max_length=255, blank=True)   # e.g. "2 cores"
    cpu_model      = models.CharField(max_length=255, blank=True)   # e.g. "Intel Core i7-9700K @ 3.60GHz"
    ram            = models.CharField(max_length=50,  blank=True)   # e.g. "8 GB"
    bios_version   = models.CharField(max_length=255, blank=True)

    # ── Security controls ─────────────────────────────────────────────────
    firewall_enabled      = models.BooleanField(null=True)          # True/False/None(unknown)
    encryption_enabled    = models.BooleanField(null=True)          # BitLocker / LUKS / FileVault
    antivirus_installed   = models.BooleanField(null=True)
    antivirus_name        = models.CharField(max_length=255, blank=True)
    antivirus_realtime    = models.BooleanField(null=True)          # real-time protection on?
    antivirus_updated_at  = models.DateTimeField(null=True, blank=True)
    secure_boot_enabled   = models.BooleanField(null=True)
    tpm_present           = models.BooleanField(null=True)
    ssh_enabled           = models.BooleanField(null=True)          # Linux/macOS
    auditd_enabled        = models.BooleanField(null=True)          # Linux only
    passwordless_sudo     = models.BooleanField(null=True)          # Linux only
    sip_enabled           = models.BooleanField(null=True)          # macOS SIP
    gatekeeper_enabled    = models.BooleanField(null=True)          # macOS Gatekeeper

    # ── Updates ───────────────────────────────────────────────────────────
    pending_updates       = models.IntegerField(null=True, blank=True)
    last_patch_date       = models.DateField(null=True, blank=True)

    # ── Password policy ───────────────────────────────────────────────────
    pass_max_days         = models.IntegerField(null=True, blank=True)
    pass_min_days         = models.IntegerField(null=True, blank=True)
    pass_min_len          = models.IntegerField(null=True, blank=True)
    lockout_threshold     = models.IntegerField(null=True, blank=True)

    # ── Extended security controls ────────────────────────────────────────
    usb_storage_enabled   = models.BooleanField(null=True)          # Windows: USB storage allowed
    screen_lock_enabled   = models.BooleanField(null=True)          # screen saver/lock active
    chrome_remote_desktop = models.BooleanField(default=False)      # CRD service detected
    antivirus_tamper      = models.BooleanField(null=True)          # Windows Defender tamper protection

    # ── Remote access ─────────────────────────────────────────────────────
    anydesk_running       = models.BooleanField(default=False)
    teamviewer_running    = models.BooleanField(default=False)
    rdp_open              = models.BooleanField(default=False)      # port 3389

    # ── Risk ──────────────────────────────────────────────────────────────
    risk_score            = models.IntegerField(default=100)
    risk_level            = models.CharField(
        max_length=10,
        choices=[("healthy", "Healthy"), ("warning", "Warning"), ("critical", "Critical")],
        default="healthy",
    )

    # ── Raw JSON snapshot (full parsed data for detail view) ──────────────
    raw_data              = models.JSONField(default=dict)

    class Meta:
        ordering = ["-report_date"]
        constraints = [
            # S3 events: s3_object_key is the primary identity (production)
            models.UniqueConstraint(
                fields=['s3_object_key'],
                condition=models.Q(s3_object_key__isnull=False) & ~models.Q(s3_object_key=''),
                name='unique_s3_object_key_when_set',
            ),
            # Samba/local imports: hostname+report_date when no S3 key (development)
            models.UniqueConstraint(
                fields=['hostname', 'report_date'],
                condition=models.Q(s3_object_key=''),
                name='unique_hostname_date_when_no_s3_key',
            ),
        ]

    def __str__(self):
        return f"{self.hostname} [{self.os_type}] — {self.report_date.date()} ({self.risk_level})"

    # ── Convenience properties ────────────────────────────────────────────

    @property
    def update_band(self):
        """Returns '0-5', '6-20', or '20+' for the updates chart."""
        n = self.pending_updates
        if n is None:
            return "unknown"
        if n <= 5:
            return "0-5"
        if n <= 20:
            return "6-20"
        return "20+"

    @property
    def status_badge(self):
        return {"healthy": "success", "warning": "warning", "critical": "danger"}.get(
            self.risk_level, "secondary"
        )

    @property
    def status_icon(self):
        return {"healthy": "🟢", "warning": "🟡", "critical": "🔴"}.get(self.risk_level, "⚪")


# ── Canonical endpoint identity ──────────────────────────────────────────────

class EndpointDevice(models.Model):
    """Canonical identity and ownership record for one endpoint device."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    mac_address = models.CharField(max_length=17, unique=True, db_index=True)
    hostname = models.CharField(max_length=255)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    os = models.CharField(max_length=255, null=True, blank=True)
    company = models.ForeignKey(
        "Company", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="endpoint_devices",
    )
    is_active = models.BooleanField(default=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["hostname"]
        indexes = [
            models.Index(fields=["company", "is_active"]),
            models.Index(fields=["hostname"]),
        ]

    def __str__(self):
        return f"{self.hostname} ({self.mac_address})"


# ── Phase 2: Heartbeat / live presence ───────────────────────────────────────

class EndpointStatus(models.Model):
    """Live endpoint presence and status tracking.
    
    Stores latest known state of each endpoint from heartbeat and health monitoring.
    Updated by agent heartbeats and health reports. Used for dashboard real-time display.
    """
    # ── Identity ──────────────────────────────────────────────────────────
    hostname = models.CharField(max_length=100, blank=True, unique=False, db_index=True)
    mac_address = models.CharField(max_length=17, null=True, blank=True, unique=True, db_index=True)
    endpoint_device = models.OneToOneField(
        EndpointDevice, on_delete=models.CASCADE, null=True, blank=True,
        related_name="status",
    )
    os = models.CharField(max_length=100)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    username = models.CharField(max_length=100, blank=True)
    
    # ── Agent presence ────────────────────────────────────────────────────
    agent_version = models.CharField(max_length=20, blank=True)
    last_seen = models.DateTimeField()
    last_health_check = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    # ── Power management ──────────────────────────────────────────────────
    wol_enabled = models.BooleanField(null=True, blank=True)
    
    # ── Real-time health metrics ──────────────────────────────────────────
    cpu_percent = models.FloatField(null=True, blank=True)          # CPU usage %
    memory_percent = models.FloatField(null=True, blank=True)       # Memory usage %
    disk_percent = models.FloatField(null=True, blank=True)         # Disk usage %
    process_count = models.IntegerField(null=True, blank=True)      # Active processes
    
    # ── Security status ───────────────────────────────────────────────────
    firewall_active = models.BooleanField(null=True, blank=True)
    antivirus_active = models.BooleanField(null=True, blank=True)
    
    # ── Health scoring ────────────────────────────────────────────────────
    health_score = models.FloatField(default=100.0)
    health_status = models.CharField(
        max_length=20,
        choices=[
            ('healthy', 'Healthy'),
            ('warning', 'Warning'),
            ('critical', 'Critical'),
        ],
        default='healthy'
    )
    
    class Meta:
        ordering = ['hostname']
        verbose_name = 'Endpoint Status'
        verbose_name_plural = 'Endpoint Statuses'
        indexes = [
            models.Index(fields=['mac_address']),
            models.Index(fields=['hostname']),
        ]
    
    def __str__(self):
        return f"{self.hostname} ({self.health_status})"
    
    @property
    def presence(self):
        """Determine if endpoint is online based on last_seen timestamp."""
        from django.utils import timezone
        from datetime import timedelta
        
        if not self.last_seen:
            return "offline"
        
        time_since_seen = timezone.now() - self.last_seen
        if time_since_seen < timedelta(minutes=5):
            return "online"
        elif time_since_seen < timedelta(hours=1):
            return "idle"
        else:
            return "offline"
    
    @property
    def presence_label(self):
        """Human-readable presence label."""
        return {
            "online": "Online",
            "idle": "Idle (last seen < 1h)",
            "offline": "Offline"
        }.get(self.presence, "Unknown")


class EndpointCommand(models.Model):
    """Queued commands to be executed on endpoints.
    
    Agents poll for pending commands and report results.
    """
    COMMAND_CHOICES = [
        ('shutdown', 'Shutdown'),
        ('restart', 'Restart'),
    ]
    
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('delivered', 'Delivered'),
        ('executing', 'Executing'),
        ('success', 'Success'),
        ('failed', 'Failed'),
        ('expired', 'Expired'),
    ]
    
    endpoint = models.ForeignKey(EndpointStatus, on_delete=models.CASCADE, related_name='commands')
    endpoint_device = models.ForeignKey(
        EndpointDevice, on_delete=models.CASCADE, null=True, blank=True,
        related_name="commands_v2",
    )
    command = models.CharField(max_length=20, choices=COMMAND_CHOICES)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    
    created_at = models.DateTimeField(auto_now_add=True)
    sent_at = models.DateTimeField(null=True, blank=True)        # when agent fetched it
    completed_at = models.DateTimeField(null=True, blank=True)   # when agent reported result
    updated_at = models.DateTimeField(auto_now=True)
    
    requested_by = models.ForeignKey(
        'auth.User', on_delete=models.SET_NULL, null=True, blank=True, related_name='power_commands'
    )
    result_message = models.TextField(blank=True)    # agent success message
    error_message = models.TextField(blank=True)     # agent error details
    
    class Meta:
        ordering = ['-created_at']
        verbose_name = 'Endpoint Command'
        verbose_name_plural = 'Endpoint Commands'
    
    def __str__(self):
        return f"{self.endpoint.hostname} — {self.command} ({self.status})"


class EndpointMetricsHistory(models.Model):
    """Time-series snapshots of CPU/memory/disk metrics for real-time monitoring.
    
    Every health check from an endpoint creates a metrics history record,
    allowing charts to display historical trends and current status.
    """
    endpoint = models.ForeignKey(
        EndpointStatus, on_delete=models.CASCADE, related_name='metrics_history'
    )
    endpoint_device = models.ForeignKey(
        EndpointDevice, on_delete=models.CASCADE, null=True, blank=True,
        related_name="metrics_history_v2",
    )
    timestamp = models.DateTimeField(db_index=True)  # When metrics were collected
    recorded_at = models.DateTimeField(auto_now_add=True)  # When we recorded them
    
    # ── Utilization metrics ───────────────────────────────────────────────
    cpu_percent = models.FloatField(null=True, blank=True)
    memory_percent = models.FloatField(null=True, blank=True)
    disk_percent = models.FloatField(null=True, blank=True)
    
    # ── Health assessment ─────────────────────────────────────────────────
    health_status = models.CharField(
        max_length=20,
        choices=[
            ('healthy', 'Healthy'),
            ('warning', 'Warning'),
            ('critical', 'Critical'),
        ],
        default='healthy'
    )
    health_score = models.FloatField(default=100.0)
    
    # ── Security status ───────────────────────────────────────────────────
    firewall_active = models.BooleanField(null=True, blank=True)
    antivirus_active = models.BooleanField(null=True, blank=True)
    
    class Meta:
        ordering = ['-timestamp']
        verbose_name = 'Endpoint Metrics History'
        verbose_name_plural = 'Endpoint Metrics Histories'
        indexes = [
            models.Index(fields=['endpoint', 'timestamp']),
            models.Index(fields=['timestamp']),
        ]
    
    def __str__(self):
        return f"{self.endpoint.hostname} @ {self.timestamp} ({self.health_status})"


class PowerActionLog(models.Model):
    """Audit trail of all power management operations (WoL, shutdown, restart).
    
    Records both the request and the final result.
    """
    OPERATION_CHOICES = [
        ('power_on', 'Power On (WoL)'),
        ('shutdown', 'Shutdown'),
        ('restart', 'Restart'),
    ]
    
    STATUS_CHOICES = [
        ('requested', 'Requested'),
        ('success', 'Success'),
        ('failed', 'Failed'),
    ]
    
    timestamp = models.DateTimeField(auto_now_add=True)
    user = models.ForeignKey(
        'auth.User', on_delete=models.SET_NULL, null=True, blank=True, related_name='power_actions'
    )
    endpoint = models.ForeignKey(EndpointStatus, on_delete=models.CASCADE, related_name='power_logs')
    endpoint_device = models.ForeignKey(
        EndpointDevice, on_delete=models.CASCADE, null=True, blank=True,
        related_name="power_logs_v2",
    )
    
    operation = models.CharField(max_length=20, choices=OPERATION_CHOICES)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES)
    
    message = models.TextField(blank=True)  # human-readable result or error
    source_ip = models.GenericIPAddressField(null=True, blank=True)  # IP of user who initiated
    
    class Meta:
        ordering = ['-timestamp']
        verbose_name = 'Power Action Log'
        verbose_name_plural = 'Power Action Logs'
    
    def __str__(self):
        return f"{self.timestamp} — {self.endpoint.hostname} — {self.operation} ({self.status})"


# ──────────────────────────────────────────────────────────────────────────────
# ── LICENSING AND ACCOUNT MODELS ──
# ──────────────────────────────────────────────────────────────────────────────

import secrets
import string
from django.core.exceptions import ValidationError


class Company(models.Model):
    """
    Company/Organization account with multiple employees and licenses.
    """
    STATUS_CHOICES = [
        ('active', 'Active'),
        ('suspended', 'Suspended'),
        ('expired', 'Expired'),
        ('inactive', 'Inactive'),
    ]

    name = models.CharField(max_length=255, unique=True)
    email = models.EmailField(unique=True)
    phone = models.CharField(max_length=20, blank=True)
    website = models.URLField(blank=True)
    
    # Address
    address_line1 = models.CharField(max_length=255, blank=True)
    address_line2 = models.CharField(max_length=255, blank=True)
    city = models.CharField(max_length=100, blank=True)
    state = models.CharField(max_length=100, blank=True)
    country = models.CharField(max_length=100, blank=True)
    postal_code = models.CharField(max_length=20, blank=True)
    
    # Account info
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='active')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    admin_user = models.OneToOneField(
        'auth.User', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='company_admin'
    )
    
    max_employees = models.IntegerField(null=True, blank=True)  # None = unlimited
    
    class Meta:
        ordering = ['name']
        verbose_name = 'Company'
        verbose_name_plural = 'Companies'
        indexes = [
            models.Index(fields=['email']),
            models.Index(fields=['status']),
        ]
    
    def __str__(self):
        return f"{self.name} ({self.status})"
    
    def employee_count(self):
        """Number of active employees"""
        return self.employees.filter(status='active').count()
    
    def can_add_employee(self):
        """Check if can add more employees"""
        if self.max_employees is None:
            return True
        return self.employee_count() < self.max_employees
    
    def total_device_limit(self):
        """Sum of device limits from active licenses"""
        return sum(
            lic.device_limit 
            for lic in self.licenses.filter(status='active')
        )
    
    def total_devices_used(self):
        """Count unique devices across all licenses"""
        return LicenseDeviceRecord.objects.filter(
            license__company=self
        ).values('mac_address').distinct().count()


class Employee(models.Model):
    """
    Employee account linked to a Company.
    """
    STATUS_CHOICES = [
        ('active', 'Active'),
        ('inactive', 'Inactive'),
        ('suspended', 'Suspended'),
    ]

    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name='employees')
    user = models.OneToOneField('auth.User', on_delete=models.CASCADE, related_name='employee')
    
    job_title = models.CharField(max_length=100, blank=True)
    department = models.CharField(max_length=100, blank=True)
    phone = models.CharField(max_length=20, blank=True)
    
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='active')
    is_admin = models.BooleanField(default=False)  # Company admin
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        ordering = ['user__first_name', 'user__last_name']
        verbose_name = 'Employee'
        verbose_name_plural = 'Employees'
        unique_together = ['company', 'user']
        indexes = [
            models.Index(fields=['company', 'status']),
        ]
    
    def __str__(self):
        return f"{self.user.get_full_name() or self.user.username} ({self.company.name})"


class IndividualAccount(models.Model):
    """
    Individual/Personal account (not part of a company).
    """
    STATUS_CHOICES = [
        ('active', 'Active'),
        ('inactive', 'Inactive'),
        ('suspended', 'Suspended'),
    ]

    user = models.OneToOneField('auth.User', on_delete=models.CASCADE, related_name='individual_account')
    
    phone = models.CharField(max_length=20, blank=True)
    organization_name = models.CharField(max_length=255, blank=True)  # Optional
    
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='active')
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        ordering = ['-created_at']
        verbose_name = 'Individual Account'
        verbose_name_plural = 'Individual Accounts'
    
    def __str__(self):
        return f"{self.user.get_full_name() or self.user.username} (Individual)"


class License(models.Model):
    """
    License key for activating endpoints.
    
    Each license has a device limit and tracks activated MAC addresses.
    Tied to either a Company or Individual account.
    """
    STATUS_CHOICES = [
        ('active', 'Active'),
        ('inactive', 'Inactive'),
        ('suspended', 'Suspended'),
        ('expired', 'Expired'),
    ]

    LICENSE_TYPE_CHOICES = [
        ('commercial', 'Commercial'),
        ('trial', 'Trial'),
        ('education', 'Education'),
        ('nonprofit', 'Nonprofit'),
    ]

    # License key (e.g., ES-XXXX-XXXX-XXXX) - auto-generated if not provided
    license_key = models.CharField(max_length=50, unique=True, db_index=True, blank=True, editable=False)
    
    # Owner
    company = models.ForeignKey(
        Company, on_delete=models.CASCADE, null=True, blank=True, related_name='licenses'
    )
    individual = models.ForeignKey(
        IndividualAccount, on_delete=models.CASCADE, null=True, blank=True, related_name='licenses'
    )
    
    license_type = models.CharField(max_length=20, choices=LICENSE_TYPE_CHOICES, default='commercial')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='active')
    
    # Device limit - max devices that can be activated with this license
    device_limit = models.IntegerField(
        help_text="Maximum number of devices that can be activated with this license"
    )
    
    # Validity
    issued_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(help_text="License expiration date")
    valid_from = models.DateTimeField(blank=True, null=True, help_text="When license becomes valid (defaults to now if blank)")
    
    description = models.TextField(blank=True)  # Internal notes
    issued_by = models.ForeignKey(
        'auth.User', on_delete=models.SET_NULL, null=True, blank=True, related_name='issued_licenses'
    )
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        ordering = ['-created_at']
        verbose_name = 'License'
        verbose_name_plural = 'Licenses'
        constraints = [
            models.CheckConstraint(
                check=models.Q(company__isnull=False, individual__isnull=True) |
                      models.Q(company__isnull=True, individual__isnull=False),
                name='license_has_owner'
            ),
        ]
        indexes = [
            models.Index(fields=['license_key']),
            models.Index(fields=['company', 'status']),
            models.Index(fields=['individual', 'status']),
            models.Index(fields=['expires_at']),
        ]
    
    def __str__(self):
        owner = self.company.name if self.company else self.individual.user.username
        return f"{self.license_key} ({owner}) - {self.status}"
    
    def clean(self):
        """Validate license has exactly one owner"""
        if (self.company is None and self.individual is None) or \
           (self.company is not None and self.individual is not None):
            raise ValidationError("License must have either a company or individual owner.")
    
    def save(self, *args, **kwargs):
        """Auto-generate license key and set valid_from if not provided"""
        if not self.license_key:
            self.license_key = self.generate_license_key()
        if not self.valid_from:
            from django.utils import timezone
            self.valid_from = timezone.now()
        super().save(*args, **kwargs)
    
    def is_valid(self):
        """Check if license is currently valid"""
        from django.utils import timezone
        now = timezone.now()
        valid_from = self.valid_from if self.valid_from else timezone.now()
        return (
            self.status == 'active' and
            now >= valid_from and
            now <= self.expires_at
        )
    
    def devices_used(self):
        """Count unique devices activated under this license"""
        return LicenseDeviceRecord.objects.filter(
            license=self, deactivated_at__isnull=True
        ).values('mac_address').distinct().count()
    
    def can_add_device(self):
        """Check if another device can be added"""
        return self.devices_used() < self.device_limit
    
    def can_activate_device(self, mac_address):
        """
        Check if a specific device can be activated.
        Returns tuple: (is_allowed, reason)
        """
        if not self.is_valid():
            return False, f"License is not valid (status: {self.status})"
        
        # Check if already activated
        if LicenseDeviceRecord.objects.filter(
            license=self, mac_address=mac_address, deactivated_at__isnull=True
        ).exists():
            return True, "Device already activated under this license"
        
        # Check if at limit
        if not self.can_add_device():
            used = self.devices_used()
            return False, f"Device limit reached ({used}/{self.device_limit})"
        
        return True, "Device can be activated"
    
    @staticmethod
    def generate_license_key():
        """Generate unique license key: ES-XXXX-XXXX-XXXX"""
        chars = string.ascii_uppercase + string.digits
        # Remove confusing chars: I, O, 0, 1, l
        chars = chars.replace('I', '').replace('O', '').replace('0', '') \
                     .replace('1', '').replace('l', '')
        
        while True:
            parts = []
            for _ in range(3):
                part = ''.join(secrets.choice(chars) for _ in range(4))
                parts.append(part)
            
            license_key = f"ES-{'-'.join(parts)}"
            
            if not License.objects.filter(license_key=license_key).exists():
                return license_key


class LicenseDeviceRecord(models.Model):
    """
    Record of each device activated under a license.
    
    Tracks MAC address with timestamp for audit purposes.
    Device limit enforcement happens via unique_together constraint.
    """
    license = models.ForeignKey(License, on_delete=models.CASCADE, related_name='device_records')
    endpoint_device = models.ForeignKey(
        EndpointDevice, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="license_records",
    )
    mac_address = models.CharField(max_length=17, db_index=True)  # "AA:BB:CC:DD:EE:FF"
    
    activated_at = models.DateTimeField(auto_now_add=True)
    deactivated_at = models.DateTimeField(null=True, blank=True)
    
    endpoint = models.ForeignKey(
        EndpointStatus, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='license_records'
    )
    
    activated_by = models.ForeignKey(
        'auth.User', on_delete=models.SET_NULL, null=True, blank=True, related_name='activated_devices'
    )
    
    notes = models.TextField(blank=True)
    
    class Meta:
        ordering = ['-activated_at']
        # One active MAC per license (multiple if deactivated/reactivated)
        constraints = [
            models.UniqueConstraint(
                fields=['license', 'mac_address'],
                condition=models.Q(deactivated_at__isnull=True),
                name='unique_active_mac_per_license'
            ),
        ]
        verbose_name = 'License Device Record'
        verbose_name_plural = 'License Device Records'
        indexes = [
            models.Index(fields=['license', 'mac_address']),
            models.Index(fields=['mac_address']),
            models.Index(fields=['activated_at']),
        ]
    
    def __str__(self):
        status = "Deactivated" if self.deactivated_at else "Active"
        return f"{self.mac_address} - {self.license.license_key} ({status})"
    
    def is_active(self):
        """Check if device record is currently active"""
        return self.deactivated_at is None
    
    def deactivate(self):
        """Mark device as deactivated"""
        if not self.deactivated_at:
            self.deactivated_at = models.functions.Now()
            self.save()


class LicenseUsageLog(models.Model):
    """
    Audit log for license operations.
    """
    ACTION_CHOICES = [
        ('activated', 'Device Activated'),
        ('deactivated', 'Device Deactivated'),
        ('validated', 'License Validated'),
        ('created', 'License Created'),
        ('renewed', 'License Renewed'),
        ('suspended', 'License Suspended'),
        ('error', 'Activation Error'),
    ]

    license = models.ForeignKey(License, on_delete=models.CASCADE, related_name='usage_logs')
    endpoint_device = models.ForeignKey(
        EndpointDevice, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="license_usage_logs",
    )
    action = models.CharField(max_length=20, choices=ACTION_CHOICES)
    
    mac_address = models.CharField(max_length=17, null=True, blank=True)
    status_code = models.CharField(max_length=20, blank=True)  # SUCCESS, LIMIT_EXCEEDED, etc.
    message = models.TextField(blank=True)
    
    performed_by = models.ForeignKey(
        'auth.User', on_delete=models.SET_NULL, null=True, blank=True, related_name='license_actions'
    )
    
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True)
    
    timestamp = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        ordering = ['-timestamp']
        verbose_name = 'License Usage Log'
        verbose_name_plural = 'License Usage Logs'
        indexes = [
            models.Index(fields=['license', 'timestamp']),
            models.Index(fields=['action']),
            models.Index(fields=['timestamp']),
        ]
    
    def __str__(self):
        return f"{self.license.license_key} - {self.action}"
