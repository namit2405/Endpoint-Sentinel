"""Check reinstall flags across all 137 devices"""
import sys, base64, json, urllib.request
sys.path.insert(0, ".")
from decouple import Config, RepositoryEnv
c = Config(RepositoryEnv(".env.development"))
WG_API_BASE = c("WG_API_BASE"); WG_ACCOUNT_ID = c("WG_ACCOUNT_ID")
WG_ACCESS_ID = c("WG_ACCESS_ID"); WG_PASSWORD = c("WG_PASSWORD"); WG_API_KEY = c("WG_API_KEY")

creds = base64.b64encode(f"{WG_ACCESS_ID}:{WG_PASSWORD}".encode()).decode()
with urllib.request.urlopen(urllib.request.Request(
    f"{WG_API_BASE}/oauth/token",
    data=b"grant_type=client_credentials&scope=api-access",
    headers={"Authorization": f"Basic {creds}", "Content-Type": "application/x-www-form-urlencoded"},
    method="POST"), timeout=15) as r:
    token = json.loads(r.read())["access_token"]

h = {"Authorization": f"Bearer {token}", "WatchGuard-API-Key": WG_API_KEY, "Accept": "application/json"}
BASE = f"{WG_API_BASE}/rest/endpoint-security/management/api/v1/accounts/{WG_ACCOUNT_ID}"

with urllib.request.urlopen(urllib.request.Request(
    f"{BASE}/devices?pageSize=200", headers=h), timeout=20) as r:
    devices = json.loads(r.read())["data"]

reinstall_prot = [d for d in devices if d.get("reinstall_protection_requested")]
reinstall_agent = [d for d in devices if d.get("reinstall_agent_requested")]
reboot = [d for d in devices if d.get("reboot_requested")]
isolated = [d for d in devices if d.get("isolation_state", 0) == 1]
clean = [d for d in devices if not d.get("reinstall_protection_requested")
         and not d.get("reinstall_agent_requested")
         and d.get("isolation_state", 0) == 0]

print(f"Total: {len(devices)}")
print(f"Properly protected (clean): {len(clean)}")
print(f"reinstall_protection_requested=True: {len(reinstall_prot)}")
print(f"reinstall_agent_requested=True:      {len(reinstall_agent)}")
print(f"reboot_requested=True:               {len(reboot)}")
print(f"isolated:                            {len(isolated)}")

if reinstall_prot:
    print("\nDevices with reinstall_protection_requested:")
    for d in reinstall_prot:
        print(f"  {d['host_name']} | {d['ip_address']} | last={d['last_connection'][:10]}")

if reinstall_agent:
    print("\nDevices with reinstall_agent_requested:")
    for d in reinstall_agent:
        print(f"  {d['host_name']} | {d['ip_address']} | last={d['last_connection'][:10]}")

if reboot:
    print("\nDevices with reboot_requested:")
    for d in reboot[:5]:
        print(f"  {d['host_name']} | {d['ip_address']}")
