import os, django, sys
os.environ["ENDPOINT_SENTINEL_ENV_FILE"] = ".env.development"
sys.path.insert(0, ".")
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "core.settings")
django.setup()
from django.db import connection
with connection.cursor() as c:
    c.execute("""
        SELECT hostname, uptime_seconds, last_health_check, last_seen
        FROM dashboard_endpointstatus
        WHERE mac_address = '00:0C:29:DB:93:E9'
    """)
    row = c.fetchone()
    print("hostname:         ", row[0])
    print("uptime_seconds:   ", row[1])
    print("last_health_check:", row[2])
    print("last_seen:        ", row[3])
