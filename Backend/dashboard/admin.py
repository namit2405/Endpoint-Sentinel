from django.contrib import admin
from .models import (
    EndpointDevice,
    EndpointReport, EndpointStatus, EndpointCommand, EndpointMetricsHistory, PowerActionLog,
    Company, Employee, IndividualAccount, License, LicenseDeviceRecord, LicenseUsageLog
)


@admin.register(EndpointReport)
class EndpointReportAdmin(admin.ModelAdmin):
    list_display = (
        "hostname", "os_type", "ip_address", "risk_level", "risk_score",
        "firewall_enabled", "antivirus_installed", "encryption_enabled",
        "pending_updates", "report_date",
    )
    list_filter  = ("os_type", "risk_level", "firewall_enabled",
                    "antivirus_installed", "encryption_enabled")
    search_fields = ("hostname", "ip_address", "os_name")
    ordering      = ("-report_date",)
    readonly_fields = ("risk_score", "risk_level", "imported_at", "raw_data")

    fieldsets = (
        ("Identity",  {"fields": ("endpoint_device", "hostname", "os_type", "os_name", "os_version",
                                  "architecture", "ip_address", "report_date",
                                  "report_file", "imported_at")}),
        ("Hardware",  {"fields": ("cpu", "ram", "bios_version")}),
        ("Security",  {"fields": ("firewall_enabled", "encryption_enabled",
                                  "antivirus_installed", "antivirus_name",
                                  "antivirus_realtime", "antivirus_updated_at",
                                  "secure_boot_enabled", "tpm_present",
                                  "ssh_enabled", "auditd_enabled",
                                  "passwordless_sudo", "sip_enabled",
                                  "gatekeeper_enabled")}),
        ("Updates",   {"fields": ("pending_updates", "last_patch_date")}),
        ("Password Policy", {"fields": ("pass_max_days", "pass_min_days",
                                        "pass_min_len", "lockout_threshold")}),
        ("Remote Access", {"fields": ("anydesk_running", "teamviewer_running", "rdp_open")}),
        ("Risk",      {"fields": ("risk_score", "risk_level")}),
        ("Raw Data",  {"fields": ("raw_data",), "classes": ("collapse",)}),
    )

@admin.register(EndpointDevice)
class EndpointDeviceAdmin(admin.ModelAdmin):
    list_display = (
        "hostname", "mac_address", "ip_address", "os", "company",
        "is_active", "created_at", "updated_at",
    )
    list_filter = ("is_active", "company", "os")
    search_fields = ("hostname", "mac_address", "ip_address", "os", "company__name")
    ordering = ("hostname",)
    readonly_fields = ("created_at", "updated_at", "deleted_at")
    fieldsets = (
        ("Identity", {"fields": ("hostname", "mac_address", "ip_address", "os")}),
        ("Ownership", {"fields": ("company",)}),
        ("Lifecycle", {"fields": ("is_active", "deleted_at", "created_at", "updated_at")}),
    )
    actions = ("soft_delete_devices", "restore_devices")

    @admin.action(description="Soft-delete selected endpoint devices")
    def soft_delete_devices(self, request, queryset):
        from django.utils.timezone import now

        updated = queryset.filter(is_active=True).update(is_active=False, deleted_at=now())
        self.message_user(request, f"{updated} endpoint device(s) soft-deleted.")

    @admin.action(description="Restore selected endpoint devices")
    def restore_devices(self, request, queryset):
        updated = queryset.filter(is_active=False).update(is_active=True, deleted_at=None)
        self.message_user(request, f"{updated} endpoint device(s) restored.")

@admin.register(EndpointStatus)
class EndpointStatusAdmin(admin.ModelAdmin):
    list_display = (
        "hostname", "os", "ip_address", "username", "last_seen",
        "mac_address", "wol_enabled", "agent_version",
    )
    list_filter = ("os", "wol_enabled")
    search_fields = ("hostname", "ip_address", "mac_address")
    ordering = ("hostname",)
    readonly_fields = ("last_seen", "updated_at")

    fieldsets = (
        ("Identity", {"fields": ("hostname", "os", "ip_address", "username",
                                 "agent_version", "endpoint_device", "last_seen", "updated_at")}),
        ("Power Management", {"fields": ("mac_address", "wol_enabled")}),
    )


@admin.register(EndpointCommand)
class EndpointCommandAdmin(admin.ModelAdmin):
    list_display = (
        "id", "endpoint", "command", "status", "requested_by",
        "created_at", "completed_at",
    )
    list_filter = ("command", "status", "created_at")
    search_fields = ("endpoint__hostname",)
    ordering = ("-created_at",)
    readonly_fields = ("created_at", "updated_at", "sent_at", "completed_at")

    fieldsets = (
        ("Command", {"fields": ("endpoint_device", "endpoint", "command", "status")}),
        ("Timeline", {"fields": ("created_at", "sent_at", "completed_at", "updated_at")}),
        ("Result", {"fields": ("result_message", "error_message")}),
        ("Audit", {"fields": ("requested_by",)}),
    )


@admin.register(EndpointMetricsHistory)
class EndpointMetricsHistoryAdmin(admin.ModelAdmin):
    list_display = (
        "endpoint", "timestamp", "cpu_percent", "memory_percent", 
        "disk_percent", "health_status", "health_score",
    )
    list_filter = ("health_status", "timestamp", "endpoint")
    search_fields = ("endpoint__hostname",)
    ordering = ("-timestamp",)
    readonly_fields = ("timestamp", "recorded_at")

    fieldsets = (
        ("Endpoint", {"fields": ("endpoint_device", "endpoint")}),
        ("Timeline", {"fields": ("timestamp", "recorded_at")}),
        ("Metrics", {"fields": ("cpu_percent", "memory_percent", "disk_percent")}),
        ("Health", {"fields": ("health_status", "health_score")}),
        ("Security", {"fields": ("firewall_active", "antivirus_active")}),
    )

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(PowerActionLog)
class PowerActionLogAdmin(admin.ModelAdmin):
    list_display = (
        "timestamp", "endpoint", "operation", "status", "user", "source_ip",
    )
    list_filter = ("operation", "status", "timestamp")
    search_fields = ("endpoint__hostname", "user__username", "source_ip")
    ordering = ("-timestamp",)
    readonly_fields = ("timestamp",)

    fieldsets = (
        ("Action", {"fields": ("endpoint_device", "endpoint", "operation", "status")}),
        ("Result", {"fields": ("message",)}),
        ("Audit", {"fields": ("user", "source_ip", "timestamp")}),
    )



# ── Licensing Admin ────────────────────────────────────────────────────────

@admin.register(Company)
class CompanyAdmin(admin.ModelAdmin):
    list_display = ("name", "email", "status", "created_at")
    list_filter = ("status", "created_at")
    search_fields = ("name", "email", "city", "country")
    readonly_fields = ("created_at", "updated_at")
    ordering = ("name",)

    fieldsets = (
        ("Company Info", {"fields": ("name", "email", "phone", "website")}),
        ("Address", {"fields": ("address_line1", "address_line2", "city", "state", "country", "postal_code")}),
        ("Account", {"fields": ("status", "admin_user", "max_employees")}),
        ("Timestamps", {"fields": ("created_at", "updated_at")}),
    )


@admin.register(Employee)
class EmployeeAdmin(admin.ModelAdmin):
    list_display = ("user", "company", "job_title", "status", "is_admin", "created_at")
    list_filter = ("company", "status", "is_admin", "created_at")
    search_fields = ("user__username", "user__email", "user__first_name", "user__last_name", "company__name")
    readonly_fields = ("created_at", "updated_at")
    ordering = ("company", "user__first_name")

    fieldsets = (
        ("User", {"fields": ("company", "user")}),
        ("Details", {"fields": ("job_title", "department", "phone")}),
        ("Access", {"fields": ("status", "is_admin")}),
        ("Timestamps", {"fields": ("created_at", "updated_at")}),
    )


@admin.register(IndividualAccount)
class IndividualAccountAdmin(admin.ModelAdmin):
    list_display = ("user", "organization_name", "status", "created_at")
    list_filter = ("status", "created_at")
    search_fields = ("user__username", "user__email", "user__first_name", "user__last_name")
    readonly_fields = ("created_at", "updated_at")
    ordering = ("-created_at",)

    fieldsets = (
        ("User", {"fields": ("user",)}),
        ("Details", {"fields": ("phone", "organization_name")}),
        ("Status", {"fields": ("status",)}),
        ("Timestamps", {"fields": ("created_at", "updated_at")}),
    )


@admin.register(License)
class LicenseAdmin(admin.ModelAdmin):
    list_display = ("license_key", "owner", "license_type", "device_limit", "status", "expires_at")
    list_filter = ("status", "license_type", "expires_at", "created_at")
    search_fields = ("license_key", "company__name", "individual__user__username")
    readonly_fields = ("issued_at", "created_at", "updated_at")
    ordering = ("-created_at",)

    fieldsets = (
        ("Owner", {"fields": ("company", "individual")}),
        ("Type & Status", {"fields": ("license_type", "status")}),
        ("Device Limit", {"fields": ("device_limit",)}),
        ("Validity", {"fields": ("expires_at",)}),
        ("Metadata", {"fields": ("description", "issued_by")}),
        ("Timestamps", {"fields": ("issued_at", "created_at", "updated_at")}),
    )

    class Media:
        js = ('admin/js/license_owner_toggle.js',)

    def owner(self, obj):
        return obj.company.name if obj.company else obj.individual.user.username
    owner.short_description = "Owner"

    def get_form(self, request, obj=None, **kwargs):
        """Override form to add JavaScript for toggling owner fields"""
        form = super().get_form(request, obj, **kwargs)
        return form

    def save_model(self, request, obj, form, change):
        """Set issued_by if not already set"""
        if not obj.issued_by:
            obj.issued_by = request.user
        super().save_model(request, obj, form, change)

    actions = ["mark_active", "mark_suspended"]

    def mark_active(self, request, queryset):
        queryset.update(status='active')
    mark_active.short_description = "Mark selected licenses as Active"

    def mark_suspended(self, request, queryset):
        queryset.update(status='suspended')
    mark_suspended.short_description = "Mark selected licenses as Suspended"


@admin.register(LicenseDeviceRecord)
class LicenseDeviceRecordAdmin(admin.ModelAdmin):
    list_display = ("mac_address", "license", "activated_at", "deactivated_at", "is_active")
    list_filter = ("activated_at", "license__company", "license__individual")
    search_fields = ("mac_address", "license__license_key", "endpoint__hostname")
    readonly_fields = ("activated_at", "is_active")
    ordering = ("-activated_at",)

    fieldsets = (
        ("License", {"fields": ("license",)}),
        ("Device", {"fields": ("endpoint_device", "mac_address", "endpoint")}),
        ("Timeline", {"fields": ("activated_at", "deactivated_at")}),
        ("Audit", {"fields": ("activated_by", "notes", "is_active")}),
    )

    actions = ["deactivate_devices"]

    def deactivate_devices(self, request, queryset):
        count = 0
        for record in queryset:
            if record.is_active():
                record.deactivate()
                count += 1
        self.message_user(request, f"{count} device(s) deactivated.")
    deactivate_devices.short_description = "Deactivate selected devices"


@admin.register(LicenseUsageLog)
class LicenseUsageLogAdmin(admin.ModelAdmin):
    list_display = ("timestamp", "license", "action", "status_code", "mac_address")
    list_filter = ("action", "status_code", "timestamp", "license__company")
    search_fields = ("license__license_key", "mac_address", "message")
    readonly_fields = ("timestamp",)
    ordering = ("-timestamp",)

    fieldsets = (
        ("License", {"fields": ("license",)}),
        ("Action", {"fields": ("action", "status_code")}),
        ("Device", {"fields": ("endpoint_device", "mac_address")}),
        ("Message", {"fields": ("message",)}),
        ("Audit", {"fields": ("performed_by", "ip_address", "user_agent")}),
        ("Timestamp", {"fields": ("timestamp",)}),
    )

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
