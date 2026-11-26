import os, django, sys
os.environ["ENDPOINT_SENTINEL_ENV_FILE"] = ".env.development"
sys.path.insert(0, ".")
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "core.settings")
django.setup()

from dashboard.models import EndpointStatus, LicenseDeviceRecord
from django.utils.timezone import now
from datetime import timedelta

print(f"{'Hostname':20s} {'MAC':18s} {'Last Seen':20s} {'Age':>10s} {'Licensed':>10s}")
print("-" * 85)

activated = set(LicenseDeviceRecord.objects.filter(
    deactivated_at__isnull=True
).values_list("mac_address", flat=True))

for ep in EndpointStatus.objects.order_by("-last_seen")[:15]:
    delta = now() - ep.last_seen
    mins = round(delta.total_seconds() / 60, 1)
    status = "online" if mins <= 3 else "warning" if mins <= 5 else "offline"
    lic = "✓" if ep.mac_address in activated else "✗"
    print(f"{ep.hostname:20s} {ep.mac_address:18s} {str(ep.last_seen)[:19]:20s} {f'{mins} min':>10s} {lic:>10s}  {status}")
