import os, django, sys
os.environ["ENDPOINT_SENTINEL_ENV_FILE"] = ".env.development"
sys.path.insert(0, ".")
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "core.settings")
django.setup()

from dashboard.models import License, LicenseDeviceRecord
from django.utils.timezone import now

sound_around_lic = License.objects.get(license_key="ES-Q7QX-5PXH-MCFN")
krishna_lic = License.objects.get(license_key="ES-4STB-N9BH-6GFV")

# MACs that belong to Sound Around only: SA-4NEW and DC1
sound_around_macs = {"00:0C:29:DB:93:E9", "00:0C:29:9F:5F:78"}

# Deactivate everything else from Sound Around that shouldn't be there
wrong_records = LicenseDeviceRecord.objects.filter(
    license=sound_around_lic,
    deactivated_at__isnull=True
).exclude(mac_address__in=sound_around_macs)

print(f"Removing {wrong_records.count()} incorrect activations from Sound Around:")
for r in wrong_records:
    hostname = r.endpoint.hostname if r.endpoint else "?"
    print(f"  Deactivating: {hostname} ({r.mac_address}) from Sound Around")

wrong_records.update(deactivated_at=now())

print()
print("=== Sound Around devices now ===")
for r in LicenseDeviceRecord.objects.filter(license=sound_around_lic, deactivated_at__isnull=True).select_related("endpoint"):
    hostname = r.endpoint.hostname if r.endpoint else "?"
    print(f"  {hostname} | {r.mac_address}")

print()
print("=== Krishna Innovative devices now ===")
for r in LicenseDeviceRecord.objects.filter(license=krishna_lic, deactivated_at__isnull=True).select_related("endpoint"):
    hostname = r.endpoint.hostname if r.endpoint else "?"
    print(f"  {hostname} | {r.mac_address}")
