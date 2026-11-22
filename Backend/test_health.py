"""
Test script — simulates what supabase_agent.py insert_health does
Run this locally to verify the SQL works with the new columns.
"""
import os, django, sys, json
os.environ["ENDPOINT_SENTINEL_ENV_FILE"] = ".env.development"
sys.path.insert(0, ".")
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "core.settings")
django.setup()

from django.db import connection

mac = "00:0C:29:DB:93:E9"
cpu = 21.0
mem = 97.2
disk = 48.6
uptime = 352247
firewall_active = False
antivirus_active = True
firewall_products = []
antivirus_products = [{"name": "Panda/WatchGuard Endpoint Security", "enabled": True, "up_to_date": True}]
health_score = 70
health_status = "warning"

with connection.cursor() as c:
    c.execute("""
        UPDATE dashboard_endpointstatus
        SET cpu_percent=%s, memory_percent=%s, disk_percent=%s, uptime_seconds=%s,
            firewall_active=%s, antivirus_active=%s,
            firewall_products=%s, antivirus_products=%s,
            health_score=%s, health_status=%s, last_health_check=NOW()
        WHERE mac_address=%s
    """, (
        cpu, mem, disk, uptime,
        firewall_active, antivirus_active,
        json.dumps(firewall_products), json.dumps(antivirus_products),
        health_score, health_status, mac
    ))
    print(f"Rows updated: {c.rowcount}")

print("Done.")
