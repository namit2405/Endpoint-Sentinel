from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [("dashboard", "0021_endpointstatus_security_products")]

    operations = [
        migrations.AddField(
            model_name="endpointstatus",
            name="disk_details",
            field=models.JSONField(blank=True, default=list),
        ),
    ]
