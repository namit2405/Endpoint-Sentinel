from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("dashboard", "0024_add_running_apps")]
    operations = [
        migrations.AddField(
            model_name="endpointstatus",
            name="installed_apps",
            field=models.JSONField(blank=True, default=list),
        ),
    ]
