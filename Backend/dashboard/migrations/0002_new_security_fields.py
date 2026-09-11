"""
Migration 0002 — add new security fields:
  usb_storage_enabled, screen_lock_enabled, chrome_remote_desktop, antivirus_tamper
"""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("dashboard", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="endpointreport",
            name="usb_storage_enabled",
            field=models.BooleanField(null=True),
        ),
        migrations.AddField(
            model_name="endpointreport",
            name="screen_lock_enabled",
            field=models.BooleanField(null=True),
        ),
        migrations.AddField(
            model_name="endpointreport",
            name="chrome_remote_desktop",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="endpointreport",
            name="antivirus_tamper",
            field=models.BooleanField(null=True),
        ),
    ]
