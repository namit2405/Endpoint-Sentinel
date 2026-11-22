# VM / Container Device-Type Classification

This change adds a `device_type` field (`physical` / `vm` / `container`) to `EndpointDevice`, propagates it through the heartbeat and health-monitoring ingestion paths, surfaces it in the REST API and frontend, and uses it to gate Wake-on-LAN so it is never offered for virtual machines. All thirteen scope items are implemented and the three verification checks (migration applied, Django system check clean, TypeScript typecheck passed) all passed with exit code 0.

**Watch for:** The Linux agent's duplicate-code tail (confirmed dead code after `exit 0`), the Windows agent's hardcoded command-server URL that ignores `LOCAL_BASE_URL`, and the absence of container-type coverage in the frontend filters.

**Verdict**: APPROVED

---

## High-level view

The model and migration are clean. `EndpointDevice.device_type` is a constrained CharField with `default='physical'`, so existing rows and agents that omit the field get the right value without any data migration. Migration 0020 depends on 0019 and applies in isolation with no destructive operations.

Both ingestion views (heartbeat and health-monitoring) validate the incoming `device_type` value against the allowed set and silently fall back to `'physical'` on unknown input. Both force `wol_enabled = False` on the `EndpointStatus` row whenever `device_type == 'vm'`, which prevents the UI from ever offering Wake-on-LAN for a VM regardless of what the agent reported. The API serializer in both `endpoints_status` and `_serialize_endpoint_status` reads `device_type` via `getattr(ep.endpoint_device, "device_type", "physical")`, so endpoints that have no linked `EndpointDevice` fall back cleanly.

The frontend type system, API mapping, and all four pages are updated consistently. `DeviceType` is a union of the three string literals; `EndpointStatus.device_type` is typed accordingly; `endpoints.ts` casts the raw API string with `?? "physical"` as a safe fallback. The VM badge, type column, device-type filter, and WoL suppression are all present in the pages that need them.

The Linux agent correctly detects virtualisation via `systemd-detect-virt`. However, the script contains a large verbatim duplicate of the entire collection and send logic after the `exit 0` line — that code is unreachable, but it inflates the file and will confuse anyone maintaining the agent. The Windows agent correctly uses `Win32_ComputerSystem.Model` for VM detection but hardcodes the command-server URL to `http://192.168.8.10:8000` rather than using `$env:LOCAL_BASE_URL`, meaning command polling does not respect the environment variable for non-default deployments.

---

<details>
<summary>Issues (3)</summary>

1. **Dead code block in heartbeat.sh** — The Linux agent has a full duplicate of its collection and heartbeat logic after the `exit 0` on line ~104. It is unreachable but roughly doubles the file length and will mislead maintainers. Remove everything after the `exit 0`.

2. **Hardcoded command-server URL in heartbeat.ps1** — `$CommandServer` is set to `"http://192.168.8.10:8000/api/agent/commands"` unconditionally and ignores `$env:LOCAL_BASE_URL`. The heartbeat URL correctly checks the env var; the command URL does not. Any deployment that changes the server address will heartbeat correctly but fail to receive commands.

3. **Container type absent from frontend filters** — `DeviceType` includes `"container"` and the backend accepts it, but `DEVICE_TYPE_OPTIONS` in `LiveStatusPage.tsx` and the device-type filter in `InventoryPage.tsx` only offer `physical` and `vm`. An endpoint that registers as `container` will not match either filter, making it invisible to anyone filtering by type. Either add the container option or restrict the backend choices to match the UI.

</details>

---

<details>
<summary>Details</summary>

### Dead code tail in heartbeat.sh

After the `exit 0` that terminates the active script body (line ~104), `heartbeat.sh` contains a full second copy of hostname/IP/MAC collection, a WoL check, a JSON builder, a heartbeat send, a command fetch-and-execute loop, and an S3 report-upload section. None of it runs. This is confirmed by the `exit 0` before it. The duplicate uses a slightly different JSON builder (the old 7-argument version without `device_type`) and references variables like `$ACTIVE_COMMAND_URL` and `$UPLOAD_API` that are never set anywhere in the file, so it would throw errors if it ever ran. The fix is to delete everything from the `exit 0` line onward.

### Command-server URL hardcode in heartbeat.ps1

The first three lines of `heartbeat.ps1` construct the heartbeat URL from `$env:LOCAL_BASE_URL` with a fallback:

```powershell
$Server = "${env:LOCAL_BASE_URL}/api/heartbeat/"
if (-not $env:LOCAL_BASE_URL) { $Server = "http://192.168.8.10:8000/api/heartbeat/" }
```

The command server is set unconditionally two lines later:

```powershell
$CommandServer = "http://192.168.8.10:8000/api/agent/commands"
```

Any deployment that sets `LOCAL_BASE_URL` to a different host gets correct heartbeats but no command delivery. The fix is to derive `$CommandServer` from the same env-var logic.

### Container filter gap

`DeviceType` in `types.ts` is `"physical" | "vm" | "container"` and both backend views accept `"container"`. The `DEVICE_TYPE_OPTIONS` arrays in `LiveStatusPage.tsx` and `InventoryPage.tsx` offer only `physical` and `vm`. An agent that registers with `device_type: "container"` will appear in the "All Types" view but cannot be isolated. The simplest fix is to add a `container` option; alternatively, the backend can restrict choices to `physical` and `vm` and reject `container` until the UI supports it.


</details>

---

<details>
<summary>File map</summary>

| File | Change |
|------|--------|
| `dashboard/models.py` | Added `DEVICE_TYPE_CHOICES` and `device_type` field to `EndpointDevice` |
| `dashboard/migrations/0020_endpointdevice_device_type.py` | New migration adding `device_type` with `default='physical'` |
| `dashboard/views.py` — `heartbeat()` | Reads `device_type` from payload; forces `wol_enabled=False` for VMs; passes `device_type` to `EndpointDevice.update_or_create` |
| `dashboard/views.py` — `endpoints_status()` | Includes `device_type` in the response row via `getattr` fallback |
| `dashboard/views_health_monitoring.py` — `health_monitoring()` | Same `device_type` read/validate/persist/WoL-force pattern as heartbeat |
| `dashboard/api_views.py` — `_serialize_endpoint_status()` | Includes `device_type` for `machine_detail` endpoint_status block |
| `heartbeat/linux/heartbeat.sh` | Adds `systemd-detect-virt` VM detection; passes `$DEVICE_TYPE` in payload. Contains dead code after `exit 0`. |
| `heartbeat/windows/heartbeat.ps1` | Adds `Win32_ComputerSystem.Model` VM detection; passes `device_type` in payload. `$CommandServer` ignores `LOCAL_BASE_URL`. |
| `frontend/src/lib/types.ts` | Added `DeviceType` type; added `device_type: DeviceType` to `EndpointStatus` interface |
| `frontend/src/lib/endpoints.ts` | Maps `ep.device_type ?? "physical"` in `fetchEndpoints()` |
| `frontend/src/pages/LiveStatusPage.tsx` | Added `DeviceType` filter chip; VM badge in hostname cell |
| `frontend/src/pages/InventoryPage.tsx` | Added `deviceType` to `Filters` interface; device-type filter in advanced filters panel; Type column with VM badge |
| `frontend/src/pages/PowerManagementPage.tsx` | Renders disabled Wake button with tooltip for VMs; updates WoL status text |
| `frontend/src/pages/EndpointDetailPage.tsx` | VM badge in header; "Not applicable (VM)" Wake-on-LAN row in Network section |

Full diff: `git diff main` from workspace root.

</details>
