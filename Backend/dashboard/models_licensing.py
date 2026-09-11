"""
Licensing and Account Models for Endpoint Sentinel

Supports:
- Company accounts with multiple organizations
- Individual user accounts
- License keys with device limits
- Device activation tracking via MAC addresses
- License key generation and validation
"""

from django.db import models
from django.contrib.auth.models import User
from django.core.exceptions import ValidationError
from django.utils import timezone
import secrets
import string


class Company(models.Model):
    """
    Company/Organization account
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
    
    # Address information
    address_line1 = models.CharField(max_length=255, blank=True)
    address_line2 = models.CharField(max_length=255, blank=True)
    city = models.CharField(max_length=100, blank=True)
    state = models.CharField(max_length=100, blank=True)
    country = models.CharField(max_length=100, blank=True)
    postal_code = models.CharField(max_length=20, blank=True)
    
    # Account information
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='active')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    # Admin user for this company
    admin_user = models.OneToOneField(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='company_admin'
    )
    
    # Max employees allowed (None = unlimited)
    max_employees = models.IntegerField(null=True, blank=True)
    
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
        """Return number of employees in this company"""
        return self.employees.filter(status='active').count()
    
    def can_add_employee(self):
        """Check if company can add more employees"""
        if self.max_employees is None:
            return True
        return self.employee_count() < self.max_employees
    
    def total_device_limit(self):
        """Sum of all device limits from active licenses"""
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
    Employee account (linked to a Company)
    """
    STATUS_CHOICES = [
        ('active', 'Active'),
        ('inactive', 'Inactive'),
        ('suspended', 'Suspended'),
    ]

    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name='employees')
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='employee')
    
    # Employee details
    job_title = models.CharField(max_length=100, blank=True)
    department = models.CharField(max_length=100, blank=True)
    phone = models.CharField(max_length=20, blank=True)
    
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='active')
    is_admin = models.BooleanField(default=False)  # Admin for company operations
    
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
    Individual/Personal account (not part of a company)
    """
    STATUS_CHOICES = [
        ('active', 'Active'),
        ('inactive', 'Inactive'),
        ('suspended', 'Suspended'),
    ]

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='individual_account')
    
    # Personal details
    phone = models.CharField(max_length=20, blank=True)
    organization_name = models.CharField(max_length=255, blank=True)  # Optional org name for individual
    
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
    License key for activating endpoints
    
    Each license can be used to activate multiple endpoints up to the device limit.
    License is tied to either a Company or Individual account.
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

    # License key and identification
    license_key = models.CharField(max_length=50, unique=True, db_index=True, blank=True, editable=False)  # e.g., ES-XXXX-XXXX-XXXX
    
    # Owner (either company or individual)
    company = models.ForeignKey(
        Company, on_delete=models.CASCADE, null=True, blank=True, related_name='licenses'
    )
    individual = models.ForeignKey(
        IndividualAccount, on_delete=models.CASCADE, null=True, blank=True, related_name='licenses'
    )
    
    # License details
    license_type = models.CharField(max_length=20, choices=LICENSE_TYPE_CHOICES, default='commercial')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='active')
    
    # Device limit
    device_limit = models.IntegerField(
        help_text="Maximum number of devices that can be activated with this license"
    )
    
    # Validity
    issued_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(help_text="License expiration date")
    valid_from = models.DateTimeField(blank=True, null=True, help_text="When license becomes valid (defaults to now if blank)")
    
    # Metadata
    description = models.TextField(blank=True)  # Internal notes
    issued_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True, related_name='issued_licenses'
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
        """Validate that license has exactly one owner"""
        if (self.company is None and self.individual is None) or \
           (self.company is not None and self.individual is not None):
            raise ValidationError("License must have either a company or individual owner, not both or neither.")
    
    def save(self, *args, **kwargs):
        """Auto-generate license key if not provided, and set valid_from to now if not provided"""
        if not self.license_key:
            self.license_key = self.generate_license_key()
        if not self.valid_from:
            self.valid_from = timezone.now()
        super().save(*args, **kwargs)
    
    def is_valid(self):
        """Check if license is currently valid"""
        now = timezone.now()
        return (
            self.status == 'active' and
            (self.valid_from is None or now >= self.valid_from) and
            now <= self.expires_at
        )
    
    def devices_used(self):
        """Count number of unique devices activated under this license"""
        return LicenseDeviceRecord.objects.filter(license=self).values('mac_address').distinct().count()
    
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
        
        # Check if MAC already activated
        if LicenseDeviceRecord.objects.filter(license=self, mac_address=mac_address).exists():
            return True, "Device already activated under this license"
        
        # Check if at limit
        if not self.can_add_device():
            return False, f"Device limit reached ({self.device_limit} devices)"
        
        return True, "Device can be activated"
    
    @staticmethod
    def generate_license_key():
        """Generate a unique license key in format: ES-XXXX-XXXX-XXXX"""
        # Generate random alphanumeric
        chars = string.ascii_uppercase + string.digits
        # Remove confusing characters: I, O, 0, 1, l
        chars = chars.replace('I', '').replace('O', '').replace('0', '').replace('1', '').replace('l', '')
        
        parts = []
        for _ in range(3):
            part = ''.join(secrets.choice(chars) for _ in range(4))
            parts.append(part)
        
        license_key = f"ES-{'-'.join(parts)}"
        
        # Ensure uniqueness
        while License.objects.filter(license_key=license_key).exists():
            parts = []
            for _ in range(3):
                part = ''.join(secrets.choice(chars) for _ in range(4))
                parts.append(part)
            license_key = f"ES-{'-'.join(parts)}"
        
        return license_key


class LicenseDeviceRecord(models.Model):
    """
    Record of each device activated under a license.
    
    Tracks MAC address and timestamp of activation for audit purposes.
    """
    license = models.ForeignKey(License, on_delete=models.CASCADE, related_name='device_records')
    mac_address = models.CharField(max_length=17, db_index=True)  # "AA:BB:CC:DD:EE:FF"
    
    # Activation info
    activated_at = models.DateTimeField(auto_now_add=True)
    deactivated_at = models.DateTimeField(null=True, blank=True)
    
    # Optional endpoint info
    endpoint = models.ForeignKey(
        'EndpointStatus', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='license_records'
    )
    
    # User who activated this device
    activated_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True, related_name='activated_devices'
    )
    
    # Notes/reason for activation
    notes = models.TextField(blank=True)
    
    class Meta:
        ordering = ['-activated_at']
        unique_together = ['license', 'mac_address']  # One MAC per license
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
        """Check if this device record is currently active"""
        return self.deactivated_at is None
    
    def deactivate(self):
        """Mark this device as deactivated"""
        if not self.deactivated_at:
            self.deactivated_at = timezone.now()
            self.save()


class LicenseUsageLog(models.Model):
    """
    Audit log for license operations (activation, deactivation, validation, etc.)
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
    action = models.CharField(max_length=20, choices=ACTION_CHOICES)
    
    mac_address = models.CharField(max_length=17, null=True, blank=True)  # For device actions
    status_code = models.CharField(max_length=20, blank=True)  # e.g., "SUCCESS", "LIMIT_EXCEEDED"
    message = models.TextField(blank=True)  # Human-readable message
    
    performed_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True, related_name='license_actions'
    )
    
    # Request metadata
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
        return f"{self.license.license_key} - {self.action} ({self.timestamp.date()})"
