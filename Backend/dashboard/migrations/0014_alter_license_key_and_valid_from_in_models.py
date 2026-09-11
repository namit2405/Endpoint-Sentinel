# Generated migration for License model in models.py

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('dashboard', '0013_alter_license_license_key_and_alter_license_valid_from'),
    ]

    operations = [
        migrations.AlterField(
            model_name='license',
            name='license_key',
            field=models.CharField(blank=True, db_index=True, editable=False, max_length=50, unique=True),
        ),
        migrations.AlterField(
            model_name='license',
            name='valid_from',
            field=models.DateTimeField(blank=True, help_text='When license becomes valid (defaults to now if blank)', null=True),
        ),
    ]
