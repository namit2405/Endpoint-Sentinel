import os, django, time, sys
os.environ["ENDPOINT_SENTINEL_ENV_FILE"] = ".env.development"
sys.path.insert(0, ".")
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "core.settings")
django.setup()
from django.utils.timezone import now
from dashboard.models import EndpointStatus

prev = None
print("Watching last_seen for SA-4NEW (00:0C:29:DB:93:E9) every 15s...")
for i in range(8):
    ep = EndpointStatus.objects.get(mac_address="00:0C:29:DB:93:E9")
    delta = now() - ep.last_seen
    changed = " <-- UPDATED" if prev and ep.last_seen != prev else ""
    print(f"[{i+1}] last_seen={ep.last_seen.strftime('%H:%M:%S')} UTC  age={round(delta.total_seconds())}s{changed}")
    prev = ep.last_seen
    if i < 7:
        time.sleep(15)
print("Done.")
