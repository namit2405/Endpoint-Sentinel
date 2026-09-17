from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("dashboard", "0017_backfill_endpoint_devices"),
    ]

    operations = [
        migrations.AddField(
            model_name="endpointstatus",
            name="connection_started_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]