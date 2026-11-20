from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [("dashboard", "0021_endpointstatus_security_products")]

    operations = [
        migrations.AddField(
            model_name="endpointstatus",
            name="disk_details",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.RunSQL(
            sql="ALTER TABLE dashboard_endpointstatus ALTER COLUMN disk_details SET DEFAULT '[]'::jsonb;",
            reverse_sql="ALTER TABLE dashboard_endpointstatus ALTER COLUMN disk_details DROP DEFAULT;",
        ),
    ]
