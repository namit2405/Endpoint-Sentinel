import os, django, sys, json
os.environ["ENDPOINT_SENTINEL_ENV_FILE"] = ".env.development"
sys.path.insert(0, ".")
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "core.settings")
django.setup()
from dashboard.models import EndpointStatus
ep = EndpointStatus.objects.get(mac_address="00:0C:29:DB:93:E9")
print("firewall_products: ", json.dumps(ep.firewall_products))
print("antivirus_products:", json.dumps(ep.antivirus_products))
print("last_health_check: ", ep.last_health_check)
