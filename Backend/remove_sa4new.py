import os, django, sys
os.environ["ENDPOINT_SENTINEL_ENV_FILE"] = ".env.development"
sys.path.insert(0, ".")
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "core.settings")
django.setup()

from dashboard.models import EndpointStatus, EndpointDevice, LicenseDeviceRecord, EndpointReport

MAC = "00:0C:29:DB:93:E9"

# Show what will be removed
ep = EndpointStatus.objects.filter(mac_address=MAC)
dev = EndpointDevice.objects.filter(mac_address=MAC)
records = LicenseDeviceRecord.objects.filter(mac_address=MAC)
reports = EndpointReport.objects.filter(mac_address=MAC)

print(f"EndpointStatus:       {ep.count()} record(s)")
print(f"EndpointDevice:       {dev.count()} record(s)")
print(f"LicenseDeviceRecord:  {records.count()} record(s)")
print(f"EndpointReport:       {reports.count()} record(s)")
print()

ep.delete()
dev.delete()
records.delete()
reports.delete()

print("SA-4NEW removed from DB.")
print("Reinstall the agent on the machine whenever ready.")
