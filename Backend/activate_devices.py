import os, django, sys
os.environ["ENDPOINT_SENTINEL_ENV_FILE"] = ".env.development"
sys.path.insert(0, ".")
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "core.settings")
django.setup()

from dashboard.models import License, LicenseDeviceRecord, EndpointStatus, EndpointDevice
from django.utils.timezone import now
from datetime import timedelta

lic = License.objects.get(license_key="ES-Q7QX-5PXH-MCFN")
activated_macs = set(LicenseDeviceRecord.objects.filter(
    license=lic, deactivated_at__isnull=True
).values_list("mac_address", flat=True))

recent = EndpointStatus.objects.select_related("endpoint_device").filter(
    last_seen__gte=now()-timedelta(minutes=30),
    mac_address__isnull=False
).exclude(mac_address="")

count = 0
for ep in recent:
    if ep.mac_address in activated_macs:
        continue

    # Ensure EndpointDevice exists and is linked
    dev = ep.endpoint_device
    if not dev:
        dev, _ = EndpointDevice.objects.get_or_create(
            mac_address=ep.mac_address,
            defaults={"hostname": ep.hostname, "os": ep.os or "", "ip_address": ep.ip_address}
        )
        ep.endpoint_device = dev
        ep.save(update_fields=["endpoint_device"])

    # Activate under license — endpoint field is FK to EndpointStatus
    LicenseDeviceRecord.objects.get_or_create(
        license=lic,
        mac_address=ep.mac_address,
        defaults={
            "endpoint": ep,
            "endpoint_device": dev,
        }
    )
    count += 1
    print(f"Activated: {ep.hostname} ({ep.mac_address})")

total = LicenseDeviceRecord.objects.filter(license=lic, deactivated_at__isnull=True).count()
print(f"\nDone. Activated {count} new devices. Total under license: {total}/{lic.device_limit}")
