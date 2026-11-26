import os, django, sys
os.environ["ENDPOINT_SENTINEL_ENV_FILE"] = ".env.development"
sys.path.insert(0, ".")
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "core.settings")
django.setup()

from dashboard.models import EndpointReport, LicenseDeviceRecord
from django.db.models import Count

print("=== All EndpointReports OS distribution ===")
for r in EndpointReport.objects.values("os_type").annotate(count=Count("id")):
    print(f"  {r['os_type']}: {r['count']}")

print(f"\nTotal reports: {EndpointReport.objects.count()}")

# Sound Around scoped
activated_macs = set(LicenseDeviceRecord.objects.filter(
    license__company__name="Sound Around",
    deactivated_at__isnull=True
).values_list("mac_address", flat=True))
print(f"\nSound Around activated MACs: {activated_macs}")

scoped = EndpointReport.objects.filter(mac_address__in=activated_macs)
print(f"Reports for Sound Around: {scoped.count()}")
for r in scoped.values("hostname","os_type","report_date").order_by("-report_date")[:5]:
    print(f"  {r['hostname']} | {r['os_type']} | {str(r['report_date'])[:10]}")
