# Investigation: VM Support in Endpoint Sentinel

## Summary Answer

Endpoint Sentinel currently supports **physical machines only** (Windows, Linux, macOS). There is no concept of device type — no `device_type`, `is_virtual`, or hypervisor field anywhere in the codebase. VMs can technically send heartbeats today (they have MACs and hostnames just like physical machines), so a VM would already appear in the portal. The gap is not registration — it is **classification, labelling, and VM-aware feature handling** (e.g. Wake-on-LAN is meaningless for a VM; TPM/Secure Boot checks behave differently on a hypervisor guest). Adding proper VM support requires changes in the backend model, the heartbeat/health API, the agent scripts, and the React frontend.

---

## Evidence

### 1. How an endpoint gets added

There are two paths:

**A. Agent heartbeat (primary)** — `POST /api/heartbeat/` handled in `Backend/dashboard/views.py::heartbeat()`. The agent POSTs JSON with `hostname`, `os`, `ip_address`, `mac_address`, `agent_version`, and `wol_enabled`. The view calls:

```python
# views.py lines ~110–140
endpoint_device, _ = EndpointDevice.objects.update_or_create(
    mac_address=mac_address, defaults={...}
)
EndpointStatus.objects.update_or_create(
    mac_address=mac_address, defaults={...}
)
```

The MAC address is the unique identity key. If the MAC is unknown, a new record is auto-created. There is no manual pre-registration step; the first heartbeat creates the device.

**B. Health monitoring** — `POST /api/agent/health-monitoring/` handled in `Backend/dashboard/views_health_monitoring.py::health_monitoring()`. This follows the same `update_or_create(mac_address=...)` pattern, adding CPU/memory/disk metrics to `EndpointStatus` and an `EndpointMetricsHistory` row.

**C. Admin entry** — not wired up; the Django admin exposes `EndpointDevice` and `EndpointStatus`, but there is no portal UI for manually registering a device. `api_views.py` has no `POST /api/endpoints/` creation endpoint.

### 2. Models representing a device

#### `EndpointDevice` (`models.py` lines ~115–145)
Canonical identity record. Fields: `id` (UUID PK), `mac_address` (unique), `hostname`, `ip_address`, `os`, `company` (FK), `is_active`, timestamps.

**No `device_type` or `is_virtual` field.**

#### `EndpointStatus` (`models.py` lines ~150–245)
Live-presence tracking. Fields include: `hostname`, `mac_address`, `os`, `ip_address`, `username`, `agent_version`, `last_seen`, `wol_enabled`, `cpu_percent`, `memory_percent`, `disk_percent`, `uptime_seconds`, `process_count`, `firewall_active`, `antivirus_active`, `health_score`, `health_status`.

**No device type field. `wol_enabled` defaults to null and can be false for any machine — but there is no flag distinguishing "WoL meaningless because VM" from "WoL disabled".**

#### `EndpointReport` (`models.py` lines ~12–105)
Audit report snapshot. Fields: `os_type` choices are `("windows", "Windows"), ("linux", "Linux"), ("macos", "macOS")` — physical machine OS types only. Contains TPM, Secure Boot, BitLocker/LUKS fields — all physical-hardware security concepts.

#### `LicenseDeviceRecord` (`models.py` lines ~380–440)
Tracks MAC addresses activated under a license. No device type.

### 3. Existing device type / is_virtual concept

A `grep` for `device_type`, `vm_type`, `virtual`, `hypervisor`, `is_virtual`, `machine_type` across all Python files returns **zero matches** in the application code. The only hit is a comment in `Installer/MAC/supabase_agent.py` mentioning "virtual environment" (Python venv, unrelated).

The TypeScript types in `frontend/src/frontend/src/lib/types.ts` define:

```typescript
export type OS = "Windows" | "Linux" | "macOS";
export interface EndpointStatus { hostname, mac_address, os: OS, ... }
```

No `deviceType` or VM field in the frontend types.

### 4. Agent installer and heartbeat scripts

`Backend/Installer/Linux/install_endpoint_agent.sh` installs three systemd services:
- **Heartbeat agent** — every 1 minute, sends to `LOCAL_BASE_URL/api/heartbeat/`
- **Health monitoring agent** — every 2 minutes, sends to `LOCAL_BASE_URL/api/agent/health-monitoring/`
- **Daily audit** — runs `linux_audit.sh` at 08:00, uploads HTML report to Backblaze B2

`Backend/heartbeat/linux/heartbeat.sh` builds a JSON payload:

```python
data = {
    "hostname": hostname, "os": os_name,
    "ip_address": ip, "username": username, "agent_version": agent_version,
}
if mac: data["mac_address"] = mac
if wol_enabled == "true": data["wol_enabled"] = True
```

The script detects MAC via `ip -o link` or `ifconfig`. On a VM with a virtualised NIC, this still works — VMs have MACs. It also queries Wake-on-LAN via `ethtool`, which will return an empty/disabled result on most VM NICs.

No field for `is_vm`, `hypervisor`, or `platform_type` is collected or sent.

### 5. API endpoints relevant to registration

From `dashboard/urls.py`:

| Method | URL | Purpose |
|--------|-----|---------|
| POST | `/api/heartbeat/` | Agent heartbeat — creates/updates `EndpointStatus` and `EndpointDevice` |
| POST | `/api/agent/health-monitoring/` | Health metrics — updates `EndpointStatus`, creates `EndpointMetricsHistory` |
| GET | `/api/endpoints/status/` | Frontend polls for live status of owned endpoints |
| GET | `/api/dashboard/inventory/` | Paginated endpoint list for Inventory page |

No endpoint exists for POST-creating an endpoint manually.

### 6. Frontend — what the portal currently shows

Pages and their relevant views:
- **Live Status** (`pages/LiveStatusPage.tsx`) — table of all endpoints, filtered by OS / connection status / risk. OS filter values: `Windows`, `Linux`, `macOS`. No VM option.
- **Inventory** (`pages/InventoryPage.tsx`) — adds firewall, antivirus, CPU model, RAM/disk filters. No device type or VM column.
- **Live Monitoring** (`pages/LiveMonitoring.tsx`) — CPU/memory/disk time-series charts per endpoint.
- **Power Management** (`pages/PowerManagementPage.tsx`) — WoL / shutdown / restart controls per hostname.
- **Endpoint Detail** (`pages/EndpointDetailPage.tsx`) — shows security controls including TPM, Secure Boot, BitLocker/LUKS — fields that are physical-hardware-centric.

The sidebar nav items (`components/Sidebar.tsx`): Overview, Live Status, Live Monitoring, Inventory, Power Management, Compare, Search. No "VMs" or device-type section.

---

## Conclusions and Recommendations

### What would change to add proper VM support

Adding VMs is a data-modelling and UI labelling task more than an architectural change, since the heartbeat/registration mechanism already works for any machine with a NIC. The concrete changes needed are:

#### Backend

1. **Add `device_type` to `EndpointDevice`** (`models.py`)
   Add a `device_type = models.CharField(max_length=20, choices=[('physical', 'Physical'), ('vm', 'Virtual Machine'), ('container', 'Container')], default='physical')` field. Create and apply a migration.

2. **Accept `device_type` in the heartbeat API** (`views.py::heartbeat` and `views_health_monitoring.py::health_monitoring`)
   Read `data.get("device_type", "physical")` and pass it to `EndpointDevice.objects.update_or_create(defaults={..., "device_type": device_type})`.

3. **Expose `device_type` in API responses** (`api_views.py::_serialize_endpoint_status`)
   Add `"device_type": ep.endpoint_device.device_type if ep.endpoint_device else "physical"` to the serialized status.

4. **Handle VM-specific logic**:
   - Set `wol_enabled = False` automatically when `device_type == 'vm'` (WoL packets cannot power on a VM guest).
   - Optionally skip or flag TPM / Secure Boot checks in `risk.py` for VMs, since those controls live on the hypervisor host, not the guest.

#### Agent scripts

5. **Detect virtualisation in `heartbeat.sh`** (`heartbeat/linux/heartbeat.sh`) and in Windows/macOS equivalents.
   On Linux: `systemd-detect-virt` returns the hypervisor name (kvm, vmware, virtualbox, xen, etc.) or `none` for bare metal. Add this to the JSON payload as `"device_type": "vm"` or `"physical"` based on the result. On Windows: `Get-WmiObject Win32_ComputerSystem | Select-Object Model` contains "Virtual" for Hyper-V/VMware.

6. **Update the installer** (`Installer/Linux/install_endpoint_agent.sh`) to pass `device_type` through the config file.

#### Frontend

7. **Add `deviceType` to the TypeScript types** (`lib/types.ts`):
   ```typescript
   export type DeviceType = "physical" | "vm" | "container";
   export interface EndpointStatus { ..., deviceType: DeviceType; }
   ```

8. **Map `device_type` from API response** (`lib/endpoints.ts::fetchEndpoints`):
   Add `deviceType: ep.device_type ?? "physical"` in the mapping block.

9. **Add VM filter to Live Status and Inventory pages**:
   Add a "Device Type" selector (`All / Physical / VM`) alongside the existing OS filter in `pages/LiveStatusPage.tsx` and `pages/InventoryPage.tsx`.

10. **Show a VM badge in the endpoint list and detail view**:
    Render a "VM" badge next to the OS badge when `deviceType === "vm"`. In `EndpointDetailPage.tsx`, suppress or annotate the WoL section for VMs.

11. **Suppress WoL controls for VMs** (`pages/PowerManagementPage.tsx`):
    If `deviceType === "vm"`, disable the Wake-on-LAN button with a tooltip explaining "Wake-on-LAN is not supported for virtual machines."

### Simplest path to "just see VMs in the portal"

A VM with a virtualised NIC **already registers itself** when you install the agent on it. It will appear in Live Status and Inventory. The only issue is it looks identical to a physical machine. If you just want VMs visible without any VM-specific features, install the Linux/Windows/macOS agent on the guest OS — no code changes needed.

If you want proper VM labelling and VM-aware feature handling, implement changes 1–11 above in roughly that order (backend model first, then API, then agent detection, then frontend display).
