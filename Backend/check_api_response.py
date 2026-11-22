import os, django, sys, json
os.environ["ENDPOINT_SENTINEL_ENV_FILE"] = ".env.development"
sys.path.insert(0, ".")
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "core.settings")
django.setup()

from django.utils.timezone import now
from datetime import timedelta
from dashboard.models import EndpointStatus

ep = EndpointStatus.objects.select_related("endpoint_device").get(mac_address="00:0C:29:DB:93:E9")
delta = now() - ep.last_seen
secs = int(delta.total_seconds())

row = {
    "hostname": ep.hostname,
    "uptime_seconds": ep.uptime_seconds,
    "last_health_check": ep.last_health_check.isoformat() if ep.last_health_check else None,
    "connection_started_at": ep.connection_started_at.isoformat() if ep.connection_started_at else None,
    "last_seen_age_secs": secs,
    "wol_enabled": ep.wol_enabled,
}
print(json.dumps(row, indent=2))
