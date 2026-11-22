import os, django, sys, json
os.environ["ENDPOINT_SENTINEL_ENV_FILE"] = ".env.development"
sys.path.insert(0, ".")
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "core.settings")
django.setup()
from dashboard.models import EndpointStatus

ep = EndpointStatus.objects.get(mac_address="00:0C:29:DB:93:E9")
ep.antivirus_products = [{"name": "Panda/WatchGuard Endpoint Security", "enabled": True, "up_to_date": True}]
ep.antivirus_active = True
ep.firewall_products = []  # No host firewall — protected by network-level Fortinet
ep.firewall_active = False
ep.save(update_fields=["antivirus_products", "antivirus_active", "firewall_products", "firewall_active"])
print("Done.")
print("antivirus_products:", json.dumps(ep.antivirus_products))
