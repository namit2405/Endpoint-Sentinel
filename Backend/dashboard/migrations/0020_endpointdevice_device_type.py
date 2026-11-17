# Generated manually

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("dashboard", "0019_endpointstatus_uptime_seconds_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="endpointdevice",
            name="device_type",
            field=models.CharField(
                choices=[
                    ("physical", "Physical"),
                    ("vm", "Virtual Machine"),
                    ("container", "Container"),
                ],
                default="physical",
                max_length=20,
            ),
        ),
    ]
