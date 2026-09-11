"""
Initial migration – creates the EndpointReport table.
Generated manually to avoid needing Django installed at build time.
"""
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name="EndpointReport",
            fields=[
                ("id",                    models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                # Identity
                ("hostname",              models.CharField(max_length=255)),
                ("os_type",               models.CharField(choices=[("windows","Windows"),("linux","Linux"),("macos","macOS")], max_length=10)),
                ("os_name",               models.CharField(blank=True, max_length=255)),
                ("os_version",            models.CharField(blank=True, max_length=100)),
                ("architecture",          models.CharField(blank=True, max_length=50)),
                ("ip_address",            models.CharField(blank=True, max_length=60)),
                ("report_date",           models.DateTimeField()),
                ("imported_at",           models.DateTimeField(auto_now_add=True)),
                ("report_file",           models.CharField(blank=True, max_length=512)),
                # Hardware
                ("cpu",                   models.CharField(blank=True, max_length=255)),
                ("ram",                   models.CharField(blank=True, max_length=50)),
                ("bios_version",          models.CharField(blank=True, max_length=255)),
                # Security
                ("firewall_enabled",      models.BooleanField(null=True)),
                ("encryption_enabled",    models.BooleanField(null=True)),
                ("antivirus_installed",   models.BooleanField(null=True)),
                ("antivirus_name",        models.CharField(blank=True, max_length=255)),
                ("antivirus_realtime",    models.BooleanField(null=True)),
                ("antivirus_updated_at",  models.DateTimeField(blank=True, null=True)),
                ("secure_boot_enabled",   models.BooleanField(null=True)),
                ("tpm_present",           models.BooleanField(null=True)),
                ("ssh_enabled",           models.BooleanField(null=True)),
                ("auditd_enabled",        models.BooleanField(null=True)),
                ("passwordless_sudo",     models.BooleanField(null=True)),
                ("sip_enabled",           models.BooleanField(null=True)),
                ("gatekeeper_enabled",    models.BooleanField(null=True)),
                # Updates
                ("pending_updates",       models.IntegerField(blank=True, null=True)),
                ("last_patch_date",       models.DateField(blank=True, null=True)),
                # Password policy
                ("pass_max_days",         models.IntegerField(blank=True, null=True)),
                ("pass_min_days",         models.IntegerField(blank=True, null=True)),
                ("pass_min_len",          models.IntegerField(blank=True, null=True)),
                ("lockout_threshold",     models.IntegerField(blank=True, null=True)),
                # Remote access
                ("anydesk_running",       models.BooleanField(default=False)),
                ("teamviewer_running",    models.BooleanField(default=False)),
                ("rdp_open",              models.BooleanField(default=False)),
                # Risk
                ("risk_score",            models.IntegerField(default=100)),
                ("risk_level",            models.CharField(choices=[("healthy","Healthy"),("warning","Warning"),("critical","Critical")], default="healthy", max_length=10)),
                # Raw snapshot
                ("raw_data",              models.JSONField(default=dict)),
            ],
            options={"ordering": ["-report_date"]},
        ),
        migrations.AlterUniqueTogether(
            name="endpointreport",
            unique_together={("hostname", "report_date")},
        ),
    ]
