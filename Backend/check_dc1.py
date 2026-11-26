import os, django, sys
os.environ["ENDPOINT_SENTINEL_ENV_FILE"] = ".env.development"
sys.path.insert(0, ".")
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "core.settings")
django.setup()

from dashboard.models import EndpointStatus, LicenseDeviceRecord
from django.utils.timezone import now
from datetime import timedelta

# Check for DC1
dc1 = EndpointStatus.objects.filter(hostname__iexact="DC1").first()
if dc1:
    delta = now() - dc1.last_seen
    print(f"DC1 found: MAC={dc1.mac_address} | last_seen={round(delta.total_seconds())}s ago")
    activated = LicenseDeviceRecord.objects.filter(mac_address=dc1.mac_address, deactivated_at__isnull=True).exists()
    print(f"Activated under license: {activated}")
else:
    print("DC1 not in DB yet — heartbeat hasn't fired")

print()
print("All endpoints last seen within 5 min:")
for ep in EndpointStatus.objects.filter(last_seen__gte=now()-timedelta(minutes=5)).order_by("hostname"):
    delta = now() - ep.last_seen
    activated = LicenseDeviceRecord.objects.filter(mac_address=ep.mac_address, deactivated_at__isnull=True).exists()
    print(f"  {ep.hostname:20s} | {ep.mac_address} | {round(delta.total_seconds())}s ago | {'✓' if activated else '✗'}")
