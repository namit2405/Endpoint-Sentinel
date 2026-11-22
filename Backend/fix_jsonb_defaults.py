import os, django, sys
os.environ["ENDPOINT_SENTINEL_ENV_FILE"] = ".env.development"
sys.path.insert(0, ".")
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "core.settings")
django.setup()
from django.db import connection

with connection.cursor() as c:
    c.execute("ALTER TABLE dashboard_endpointstatus ALTER COLUMN firewall_products SET DEFAULT '[]'::jsonb")
    c.execute("ALTER TABLE dashboard_endpointstatus ALTER COLUMN antivirus_products SET DEFAULT '[]'::jsonb")
    c.execute("UPDATE dashboard_endpointstatus SET firewall_products='[]' WHERE firewall_products IS NULL")
    c.execute("UPDATE dashboard_endpointstatus SET antivirus_products='[]' WHERE antivirus_products IS NULL")
    # Also check if NOT NULL constraint exists and add it back safely
    print("DB defaults fixed.")

print("Done.")
