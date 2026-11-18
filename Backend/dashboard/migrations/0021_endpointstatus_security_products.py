from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [("dashboard", "0020_endpointdevice_device_type")]

    operations = [
        migrations.AddField(
            model_name="endpointstatus",
            name="firewall_products",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="endpointstatus",
            name="antivirus_products",
            field=models.JSONField(blank=True, default=list),
        ),
    ]
