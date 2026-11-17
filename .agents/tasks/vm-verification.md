# VM Support — Verification

## 1. Django migrations

```powershell
cd c:\Projects\Endpoint-Sentinel\Endpoint-Sentinel\Backend
$env:ENDPOINT_SENTINEL_ENV_FILE = '.env.development'
.\venv\Scripts\python.exe manage.py migrate
```

**Output:**
```
Operations to perform:
  Apply all migrations: admin, auth, authtoken, contenttypes, dashboard, sessions
Running migrations:
  Applying dashboard.0020_endpointdevice_device_type... OK
```

Exit code: 0 ✓

---

## 2. Django system check

```powershell
cd c:\Projects\Endpoint-Sentinel\Endpoint-Sentinel\Backend
$env:ENDPOINT_SENTINEL_ENV_FILE = '.env.development'
.\venv\Scripts\python.exe manage.py check
```

**Output:**
```
System check identified no issues (0 silenced).
```

Exit code: 0 ✓

---

## 3. TypeScript type check

```powershell
# Run from: c:\Projects\Endpoint-Sentinel\Endpoint-Sentinel\frontend\src\frontend
pnpm run typecheck
```

**Output:**
```
$ tsc --noEmit
```

Exit code: 0 ✓

---

## Changes implemented

| # | Layer | Change |
|---|-------|--------|
| 1 | `dashboard/models.py` | Added `DEVICE_TYPE_CHOICES` and `device_type` field to `EndpointDevice` |
| 2 | `dashboard/migrations/0020_endpointdevice_device_type.py` | New migration adding `device_type` with default `'physical'` |
| 3 | `dashboard/views.py` — `heartbeat()` | Reads `device_type` from payload, passes to `EndpointDevice`, forces `wol_enabled=False` for VMs |
| 4 | `dashboard/views_health_monitoring.py` — `health_monitoring()` | Same pattern as heartbeat; forces `wol_enabled=False` for VMs |
| 5 | `dashboard/api_views.py` + `dashboard/views.py` | Added `device_type` field to both endpoint serializers |
| 6 | `heartbeat/linux/heartbeat.sh` | Added `systemd-detect-virt` VM detection; passes `$DEVICE_TYPE` in JSON payload |
| 7 | `heartbeat/windows/heartbeat.ps1` | Added `Win32_ComputerSystem.Model` VM detection; passes `device_type` in payload |
| 8 | `frontend/src/lib/types.ts` | Added `DeviceType` type; added `device_type: DeviceType` to `EndpointStatus` |
| 9 | `frontend/src/lib/endpoints.ts` | Imported `DeviceType`; mapped `device_type` from API response |
| 10 | `LiveStatusPage.tsx` | Added Device Type filter chip; VM badge in hostname cell |
| 11 | `InventoryPage.tsx` | Added `deviceType` filter + Type column with VM badge |
| 12 | `PowerManagementPage.tsx` | Disabled Wake button for VMs with tooltip; updated WoL status text |
| 13 | `EndpointDetailPage.tsx` | VM badge in header; Wake-on-LAN "Not applicable (VM)" row in Network section |
