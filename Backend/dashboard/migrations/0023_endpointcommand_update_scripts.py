from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [("dashboard", "0022_endpointstatus_disk_details")]

    operations = [
        migrations.AlterField(
            model_name="endpointcommand",
            name="command",
            field=models.CharField(
                max_length=20,
                choices=[
                    ("shutdown", "Shutdown"),
                    ("restart", "Restart"),
                    ("update_scripts", "Update Scripts"),
                ],
            ),
        ),
    ]
