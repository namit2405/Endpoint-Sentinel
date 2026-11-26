from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("dashboard", "0023_endpointcommand_update_scripts")]
    operations = [
        migrations.AddField(
            model_name="endpointstatus",
            name="running_apps",
            field=models.JSONField(blank=True, default=list),
        ),
    ]
