import os, django, sys
os.environ["ENDPOINT_SENTINEL_ENV_FILE"] = ".env.development"
sys.path.insert(0, ".")
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "core.settings")
django.setup()

from dashboard.models import EndpointReport, EndpointStatus, LicenseDeviceRecord

# Check all activated endpoints and their latest reports
activated_macs = set(LicenseDeviceRecord.objects.filter(
    deactivated_at__isnull=True
).values_list("mac_address", flat=True))

print("=== Latest reports for activated endpoints ===")
for mac in activated_macs:
    ep = EndpointStatus.objects.filter(mac_address=mac).first()
    if not ep:
        continue
    report = EndpointReport.objects.filter(mac_address=mac).order_by("-report_date").first()
    if report:
        raw = report.raw_data or {}
        sw = raw.get("installed_software", [])
        services = raw.get("running_services", [])
        ports = raw.get("open_ports", [])
        print(f"\n{ep.hostname} ({mac})")
        print(f"  Report date: {str(report.report_date)[:19]}")
        print(f"  installed_software: {len(sw)} items")
        print(f"  running_services: {len(services)} items")
        print(f"  open_ports: {len(ports)} items")
        print(f"  raw_data keys: {list(raw.keys())}")
        if sw:
            print(f"  First 3 software: {sw[:3]}")
    else:
        print(f"\n{ep.hostname} ({mac}) — NO AUDIT REPORT")
