# VM Support — Implementation Plan

Generated after reading every file listed in the scope. Each item references exact files, functions, and line numbers.

---

## Overview of changes

| Layer | Files |
|---|---|
| Backend model | `dashboard/models.py` |
| Migration | `dashboard/migrations/0020_endpointdevice_device_type.py` (new) |
| Heartbeat API | `dashboard/views.py` — `heartbeat()` |
| Health monitoring API | `dashboard/views_health_monitoring.py` — `health_monitoring()` |
| Serializer | `dashboard/views.py` — `endpoints_status()` and `api_views.py` — `_serialize_endpoint_status()` |
| Linux agent | `heartbeat/linux/heartbeat.sh` |
| Windows agent | `heartbeat/windows/heartbeat.ps1` |
| TS types | `frontend/src/frontend/src/lib/types.ts` |
| API mapping | `frontend/src/frontend/src/lib/endpoints.ts` — `fetchEndpoints()` |
| Live Status page | `frontend/src/frontend/src/pages/LiveStatusPage.tsx` |
| Inventory page | `frontend/src/frontend/src/pages/InventoryPage.tsx` |
| Power Management page | `frontend/src/frontend/src/pages/PowerManagementPage.tsx` |
| Endpoint Detail page | `frontend/src/frontend/src/pages/EndpointDetailPage.tsx` |

---

## Plan

- [ ] 1. **Add `device_type` field to `EndpointDevice` model**

  In `Backend/dashboard/models.py`, inside the `EndpointDevice` class (which starts at line ~115), add the following two lines **before** `is_active` (currently around line 128):

  ```python
  DEVICE_TYPE_CHOICES = [('physical', 'Physical'), ('vm', 'Virtual Machine'), ('container', 'Container')]
  device_type = models.CharField(max_length=20, choices=DEVICE_TYPE_CHOICES, default='physical')
  ```

  No other model changes are needed.

  **Files:** `Backend/dashboard/models.py`

  **Verify:** `cd Backend && python manage.py check` — must exit with "System check identified no issues."

---

- [ ] 2. **Create migration `0020_endpointdevice_device_type.py`**

  Create the file at `Backend/dashboard/migrations/0020_endpointdevice_device_type.py` with the exact content below. The dependency is `0019_endpointstatus_uptime_seconds_and_more`, which is the current head.

  ```python
  # Generated manually

  from django.db import migrations, models


  class Migration(migrations.Migration):

      dependencies = [
          ("dashboard", "0019_endpointstatus_uptime_seconds_and_more"),
      ]

      operations = [
          migrations.AddField(
              model_name="endpointdevice",
              name="device_type",
              field=models.CharField(
                  choices=[
                      ("physical", "Physical"),
                      ("vm", "Virtual Machine"),
                      ("container", "Container"),
                  ],
                  default="physical",
                  max_length=20,
              ),
          ),
      ]
  ```

  **Files:** `Backend/dashboard/migrations/0020_endpointdevice_device_type.py` (new)

  **Verify:** `cd Backend && python manage.py migrate --run-syncdb` — migration `0020` applies without errors.

---

- [ ] 3. **Update the heartbeat API to accept and store `device_type`**

  File: `Backend/dashboard/views.py`, function `heartbeat()`.

  **Change A — read `device_type` from the payload** (insert after the `mac_address` normalization block, around line 85 in the current file, before the `endpoint_device, _ = EndpointDevice.objects.update_or_create(...)` call):

  ```python
  device_type = data.get("device_type", "physical")
  if device_type not in ("physical", "vm", "container"):
      device_type = "physical"
  ```

  **Change B — pass `device_type` to `EndpointDevice.objects.update_or_create`** (the `defaults=` dict for `EndpointDevice`, currently around line 90). Add `"device_type": device_type` to that dict:

  ```python
  endpoint_device, _ = EndpointDevice.objects.update_or_create(
      mac_address=mac_address,
      defaults={
          "hostname": data["hostname"],
          "os": data["os"],
          "ip_address": ip_address,
          "device_type": device_type,          # ← new
      },
  )
  ```

  **Change C — force `wol_enabled = False` for VMs** (insert after the existing `if "wol_enabled" in data` block, around line 110). The existing block sets `wol_enabled` from the payload. Add an override immediately after:

  ```python
  if device_type == "vm":
      defaults["wol_enabled"] = False
  ```

  **Files:** `Backend/dashboard/views.py`

  **Verify:** `cd Backend && python manage.py check` — no errors. (Full end-to-end tested in item 12.)

---

- [ ] 4. **Update the health monitoring API to accept and store `device_type`**

  File: `Backend/dashboard/views_health_monitoring.py`, function `health_monitoring()`.

  **Change A — read `device_type`** (insert after the `os_type = data.get(...)` line, around line 56):

  ```python
  device_type = data.get("device_type", "physical")
  if device_type not in ("physical", "vm", "container"):
      device_type = "physical"
  ```

  **Change B — pass `device_type` to `EndpointDevice.objects.update_or_create`** (the `defaults=` dict, around line 61). Add:

  ```python
  endpoint_device, _ = EndpointDevice.objects.update_or_create(
      mac_address=mac_address,
      defaults={
          "hostname": hostname,
          "os": os_type or "unknown",
          "ip_address": data.get("ip_address", "").strip() or None,
          "device_type": device_type,          # ← new
      },
  )
  ```

  **Change C — force `wol_enabled = False` for VMs** (insert just before `endpoint.save()`, around line 97):

  ```python
  if device_type == "vm":
      endpoint.wol_enabled = False
  ```

  **Files:** `Backend/dashboard/views_health_monitoring.py`

  **Verify:** `cd Backend && python manage.py check` — no errors.

---

- [ ] 5. **Expose `device_type` in both API serialisers**

  **A. `api_views.py` — `_serialize_endpoint_status(ep)`** (around line 130, inside the `return { ... }` dict). Add one field:

  ```python
  "device_type": getattr(ep.endpoint_device, "device_type", "physical") if ep.endpoint_device else "physical",
  ```

  Place it after the `"antivirus_active"` entry.

  **B. `views.py` — `endpoints_status()` row dict** (around line 165, inside `rows.append({ ... })`). Add the same field after `"antivirus_active"`:

  ```python
  "device_type": getattr(ep.endpoint_device, "device_type", "physical") if ep.endpoint_device else "physical",
  ```

  Note: `ep` here is an `EndpointStatus` object; `ep.endpoint_device` is the related `EndpointDevice` (already selected via `.select_related("endpoint_device")`).

  **Files:** `Backend/dashboard/api_views.py`, `Backend/dashboard/views.py`

  **Verify:** `cd Backend && python manage.py check` — no errors.

---

- [ ] 6. **Add `device_type` detection to the Linux heartbeat agent**

  File: `Backend/heartbeat/linux/heartbeat.sh`.

  Insert the following block **after the `WOL_ENABLED` detection block** (after line ~60, before the `# Build heartbeat JSON` section):

  ```bash
  # =============================================================================
  # Detect virtualisation
  # =============================================================================

  DEVICE_TYPE="physical"
  if command -v systemd-detect-virt >/dev/null 2>&1; then
      _virt=$(systemd-detect-virt 2>/dev/null)
      if [ "$_virt" != "none" ] && [ -n "$_virt" ]; then
          DEVICE_TYPE="vm"
      fi
  fi
  ```

  Then, in the `python3` heredoc that builds the JSON (the `JSON=$(python3 - ... <<'PY'` block), pass `$DEVICE_TYPE` as an additional argument and include it in the payload. The current invocation is:

  ```bash
  JSON=$(python3 - "$HOSTNAME_VAL" "$OS_VAL" "$IP_VAL" "$USERNAME_VAL" "$AGENT_VERSION" "$MAC_VAL" "$WOL_ENABLED" <<'PY'
  import json, sys
  hostname, os_name, ip, username, agent_version, mac, wol_enabled = sys.argv[1:]
  data = {
      "hostname": hostname,
      "os": os_name,
      "ip_address": ip,
      "username": username,
      "agent_version": agent_version,
  }
  if mac:
      data["mac_address"] = mac
  if wol_enabled == "true":
      data["wol_enabled"] = True
  print(json.dumps(data))
  PY
  )
  ```

  Replace it with:

  ```bash
  JSON=$(python3 - "$HOSTNAME_VAL" "$OS_VAL" "$IP_VAL" "$USERNAME_VAL" "$AGENT_VERSION" "$MAC_VAL" "$WOL_ENABLED" "$DEVICE_TYPE" <<'PY'
  import json, sys
  hostname, os_name, ip, username, agent_version, mac, wol_enabled, device_type = sys.argv[1:]
  data = {
      "hostname": hostname,
      "os": os_name,
      "ip_address": ip,
      "username": username,
      "agent_version": agent_version,
      "device_type": device_type,
  }
  if mac:
      data["mac_address"] = mac
  if wol_enabled == "true":
      data["wol_enabled"] = True
  print(json.dumps(data))
  PY
  )
  ```

  Note: The script contains a **duplicate section** after `exit 0` (a copy of the endpoint collection and JSON build code that is dead because of the earlier `exit 0`). Do **not** modify that dead copy — it is unreachable. The changes above apply only to the first (live) section.

  **Files:** `Backend/heartbeat/linux/heartbeat.sh`

  **Verify:** Run `bash -n Backend/heartbeat/linux/heartbeat.sh` — no syntax errors.

---

- [ ] 7. **Add `device_type` detection to the Windows heartbeat agent**

  File: `Backend/heartbeat/windows/heartbeat.ps1`.

  **Change A — detect VM** (insert after the `$WolEnabled` block, around line 55, before `# Build heartbeat payload`):

  ```powershell
  # ── Detect virtualisation ──────────────────────────────────────────────────
  $DeviceType = "physical"
  try {
      $Model = (Get-CimInstance -ClassName Win32_ComputerSystem).Model
      if ($Model -match "Virtual|VMware|VirtualBox|KVM|Hyper-V|QEMU|innotek") {
          $DeviceType = "vm"
      }
  } catch {
      # Silent fail — device_type defaults to physical
  }
  ```

  **Change B — add `device_type` to the heartbeat payload** (in the `$HeartbeatBody = @{ ... }` block, around line 65). Add:

  ```powershell
  $HeartbeatBody = @{
      hostname      = $Hostname
      os            = $OS
      ip_address    = $IP
      username      = $Username
      agent_version = $AgentVersion
      device_type   = $DeviceType       # ← new
  }
  ```

  **Files:** `Backend/heartbeat/windows/heartbeat.ps1`

  **Verify:** `powershell -NoProfile -NonInteractive -Command "& { . 'Backend\heartbeat\windows\heartbeat.ps1' }"` — this will fail to connect (no server in test), but PowerShell should **not** throw a parse or variable error at the detection block; check that the only error is about the missing API key or connection refused.

  Alternatively: `powershell -NoProfile -Command "Get-Content Backend\heartbeat\windows\heartbeat.ps1 | Out-Null"` — no syntax error output.

---

- [ ] 8. **Add `DeviceType` to the TypeScript type definitions**

  File: `frontend/src/frontend/src/lib/types.ts`.

  After the existing `export type ConnectionStatus = ...` line (line 7), add:

  ```typescript
  export type DeviceType = "physical" | "vm" | "container";
  ```

  Then in the `EndpointStatus` interface (starting at line 48), add the following field after `wol_enabled`:

  ```typescript
  device_type: DeviceType;
  ```

  **Files:** `frontend/src/frontend/src/lib/types.ts`

  **Verify:** `cd frontend/src/frontend && npm run build` — TypeScript compilation succeeds (the new field is used in item 9 so it will be referenced once items 9–13 are done; at this stage it may show "declared but never used" which is not an error).

---

- [ ] 9. **Map `device_type` from the API response in `fetchEndpoints()`**

  File: `frontend/src/frontend/src/lib/endpoints.ts`, function `fetchEndpoints()`.

  In the `.map((ep: any) => ({ ... }))` block (around line 20), add `device_type` after the `wol_enabled` mapping:

  ```typescript
  wol_enabled: ep.wol_enabled ?? null,
  device_type: (ep.device_type ?? "physical") as DeviceType,
  ```

  Also add `DeviceType` to the import at the top of the file:

  ```typescript
  import type {
    DashboardSummary,
    DeviceType,          // ← add
    EndpointStatus,
    HealthTrendPoint,
    OSDistribution,
    QuickAlert,
  } from "./types";
  ```

  **Files:** `frontend/src/frontend/src/lib/endpoints.ts`

  **Verify:** `cd frontend/src/frontend && npm run build` — no TypeScript errors.

---

- [ ] 10. **Add Device Type filter and VM badge to Live Status page**

  File: `frontend/src/frontend/src/pages/LiveStatusPage.tsx`.

  **Change A — add `DeviceType` to the imports** (around line 35, inside the `type { ... }` import from `@/lib/types`):

  ```typescript
  import type {
    ConnectionStatus,
    DeviceType,         // ← add
    EndpointStatus,
    OS,
    RiskLevel,
  } from "@/lib/types";
  ```

  **Change B — add `DEVICE_TYPE_OPTIONS` constant** (after the `RISK_OPTIONS` array, around line 72):

  ```typescript
  const DEVICE_TYPE_OPTIONS: Array<{ value: "all" | DeviceType; label: string }> = [
    { value: "all",       label: "All Types" },
    { value: "physical",  label: "Physical" },
    { value: "vm",        label: "VM" },
  ];
  ```

  **Change C — add `deviceTypeFilter` state** (in `export default function LiveStatusPage()`, after the `riskFilter` state, around line 185):

  ```typescript
  const [deviceTypeFilter, setDeviceTypeFilter] = useState<"all" | DeviceType>("all");
  ```

  **Change D — add `device_type` to the `filtered` memo** (in the `useMemo` callback, inside the `.filter()` predicate, after the `riskFilter` check, around line 198):

  ```typescript
  if (deviceTypeFilter !== "all" && e.device_type !== deviceTypeFilter) return false;
  ```

  Also add `deviceTypeFilter` to the dependency array of the `useMemo`.

  **Change E — add the Device Type `<Select>` to the filter bar** (inside the `<CardContent className="p-4">` filter bar section, after the Risk `<Select>` block, around line 275):

  ```tsx
  <Select
    value={deviceTypeFilter}
    onValueChange={(v) => {
      setDeviceTypeFilter(v as "all" | DeviceType);
      setPage(1);
    }}
  >
    <SelectTrigger
      className="w-40"
      aria-label="Filter by device type"
      data-ocid="live_status.filter_device_type"
    >
      <SelectValue placeholder="All Types" />
    </SelectTrigger>
    <SelectContent>
      {DEVICE_TYPE_OPTIONS.map((o) => (
        <SelectItem key={o.value} value={o.value}>
          {o.label}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
  ```

  **Change F — show a "VM" badge in the hostname cell** (inside `<TableRow>`, in the `<TableCell>` for hostname, around line 320). The current cell renders `{e.hostname}` and `{e.ip_address}`. Add a VM badge after the hostname span:

  ```tsx
  <TableCell>
    <div className="flex min-w-0 flex-col">
      <div className="flex items-center gap-1.5">
        <span className="truncate font-mono text-sm font-semibold text-foreground">
          {e.hostname}
        </span>
        {e.device_type === "vm" && (
          <Badge className="shrink-0 rounded-full border-transparent bg-purple-500/15 text-purple-600 dark:text-purple-400 text-xs px-1.5 py-0">
            VM
          </Badge>
        )}
      </div>
      <span className="truncate font-mono text-xs text-muted-foreground">
        {e.ip_address}
      </span>
    </div>
  </TableCell>
  ```

  **Files:** `frontend/src/frontend/src/pages/LiveStatusPage.tsx`

  **Verify:** `cd frontend/src/frontend && npm run build` — no TypeScript errors.

---

- [ ] 11. **Add device_type column and filter to Inventory page**

  File: `frontend/src/frontend/src/pages/InventoryPage.tsx`.

  **Change A — import `DeviceType`** (in the `import type { ... }` from `@/lib/types`, around line 33):

  ```typescript
  import type { DeviceType, EndpointStatus, OS, RiskLevel } from "@/lib/types";
  ```

  **Change B — add `deviceType` to `Filters` interface** (around line 54, inside the `interface Filters` block):

  ```typescript
  deviceType: DeviceType | "all";
  ```

  **Change C — add `deviceType: "all"` to `DEFAULT_FILTERS`** (around line 65):

  ```typescript
  const DEFAULT_FILTERS: Filters = {
    os: "all",
    risk: "all",
    firewall: "all",
    antivirus: "all",
    deviceType: "all",   // ← add
    cpuModel: "",
    ramMin: 0,
    ramMax: 256,
    diskMin: 0,
    diskMax: 100,
  };
  ```

  **Change D — add device type check to `matchesFilters()`** (around line 76, inside the `function matchesFilters()` body, after the `antivirus` checks):

  ```typescript
  if (f.deviceType !== "all" && e.device_type !== f.deviceType) return false;
  ```

  **Change E — count `deviceType` as an active filter** (in the `activeFilterCount` `useMemo`, around line 220):

  ```typescript
  if (filters.deviceType !== "all") n++;
  ```

  **Change F — add a Device Type `<Select>` in the advanced filters panel** (inside the filter grid, after the Antivirus `<Select>` block, around line 390). Follow the exact same `<div className="space-y-1.5">` pattern used for OS and Risk:

  ```tsx
  <div className="space-y-1.5">
    <label
      htmlFor="filter-device-type"
      className="text-xs font-medium text-muted-foreground"
    >
      Device type
    </label>
    <Select
      value={filters.deviceType}
      onValueChange={(v) =>
        setFilters((f) => ({ ...f, deviceType: v as Filters["deviceType"] }))
      }
    >
      <SelectTrigger
        id="filter-device-type"
        data-ocid="inventory.filter.device_type"
        className="w-full"
      >
        <SelectValue placeholder="All types" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All types</SelectItem>
        <SelectItem value="physical">Physical</SelectItem>
        <SelectItem value="vm">Virtual Machine</SelectItem>
      </SelectContent>
    </Select>
  </div>
  ```

  **Change G — add a Device Type column to the table** (in `<TableHeader>`, after the OS `<TableHead>`, around line 470):

  ```tsx
  <TableHead>Type</TableHead>
  ```

  And in each `<TableRow>` for a device (after the OS cell), add:

  ```tsx
  <TableCell>
    {e.device_type === "vm" ? (
      <Badge className="rounded-full border-transparent bg-purple-500/15 text-purple-600 dark:text-purple-400">
        VM
      </Badge>
    ) : (
      <span className="text-xs text-muted-foreground">Physical</span>
    )}
  </TableCell>
  ```

  **Files:** `frontend/src/frontend/src/pages/InventoryPage.tsx`

  **Verify:** `cd frontend/src/frontend && npm run build` — no TypeScript errors.

---

- [ ] 12. **Disable WoL for VM devices on the Power Management page**

  File: `frontend/src/frontend/src/pages/PowerManagementPage.tsx`.

  Add `Tooltip`, `TooltipContent`, `TooltipProvider`, `TooltipTrigger` to the imports (they are available in the project — used in LiveStatusPage). Check if they are already imported; if not, add:

  ```typescript
  import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
  } from "@/components/ui/tooltip";
  ```

  In the render loop for each endpoint (around line 65, inside the `endpoints.map(...)` block), the Wake button is currently:

  ```tsx
  {!online && (
    <Button size="sm" variant="outline" disabled={Boolean(actionBusy) || endpoint.wol_enabled !== true} onClick={() => requestAction(endpoint.hostname, "on")}>
      <Zap className="mr-2 size-4" /> Wake
    </Button>
  )}
  ```

  Replace with:

  ```tsx
  {!online && (
    endpoint.device_type === "vm" ? (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button size="sm" variant="outline" disabled>
                <Zap className="mr-2 size-4" /> Wake
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            Wake-on-LAN is not supported for virtual machines
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    ) : (
      <Button size="sm" variant="outline" disabled={Boolean(actionBusy) || endpoint.wol_enabled !== true} onClick={() => requestAction(endpoint.hostname, "on")}>
        <Zap className="mr-2 size-4" /> Wake
      </Button>
    )
  )}
  ```

  Also update the WoL status text in the info row (currently around line 70):

  ```tsx
  <p className="mt-1 text-xs text-muted-foreground">
    {endpoint.device_type === "vm"
      ? "Wake-on-LAN not applicable (virtual machine)"
      : endpoint.wol_enabled === true
        ? "Wake-on-LAN available"
        : endpoint.wol_enabled === false
          ? "Wake-on-LAN disabled"
          : "Wake-on-LAN status unknown"}
  </p>
  ```

  **Files:** `frontend/src/frontend/src/pages/PowerManagementPage.tsx`

  **Verify:** `cd frontend/src/frontend && npm run build` — no TypeScript errors.

---

- [ ] 13. **Show VM badge and suppress WoL annotation in Endpoint Detail page**

  File: `frontend/src/frontend/src/pages/EndpointDetailPage.tsx`.

  **Change A — add a VM badge in the header** (around line 240, inside the `<div className="flex flex-wrap items-center gap-3">` that already shows the OS badge and risk badge). Add after the OS badge:

  ```tsx
  {endpoint.device_type === "vm" && (
    <Badge
      className="rounded-full border-transparent bg-purple-500/15 text-purple-600 dark:text-purple-400"
      data-ocid="endpoint_detail.vm_badge"
    >
      Virtual Machine
    </Badge>
  )}
  ```

  **Change B — annotate WoL in the Network section** (in the `<SectionCard title="Network">` block, around line 315, inside the `<dl>` list). Add a row after "Connection uptime":

  ```tsx
  {endpoint.device_type === "vm" && (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <dt className="text-sm text-muted-foreground">Wake-on-LAN</dt>
      <dd className="text-sm font-medium text-muted-foreground italic">
        Not applicable (VM)
      </dd>
    </div>
  )}
  ```

  **Files:** `frontend/src/frontend/src/pages/EndpointDetailPage.tsx`

  **Verify:** `cd frontend/src/frontend && npm run build` — no TypeScript errors. Full build must be clean before this plan is considered complete.

---

## Execution order dependency

Items must be executed in order:

1 → 2 (migration needs the field)  
2 → 3, 4 (APIs need the migrated DB column)  
3, 4 → 5 (serialiser exposes what the APIs store)  
5 → 8, 9 (frontend types and mapping consume the API field)  
8, 9 → 10, 11, 12, 13 (pages consume the mapped type)  
6, 7 are independent of each other and of the frontend items; they can be done any time after item 3 is done.

---

## Notes / assumptions

- **Migration number 0020**: the latest migration in the repo at plan time is `0019_endpointstatus_uptime_seconds_and_more`. If a new migration is added before this plan runs, update the `dependencies` list in the migration file accordingly.
- **Dead code in heartbeat.sh**: The script has an entire duplicate section after the first `exit 0`. Modify only the live first section.
- **Frontend build command**: assumed to be `npm run build` inside `frontend/src/frontend/`. If the project uses `npm run dev` or Vite directly, adjust the verify command. TypeScript errors are caught by `tsc --noEmit` which `vite build` runs automatically.
- **WoL enforcement**: WoL is forced to `False` in the backend when `device_type == "vm"` (items 3 and 4), so the frontend check in item 12 is defence-in-depth, not the sole gate.
- **`container` type**: the type is modelled but no detection logic is added for containers. The filter UI shows only Physical / VM to avoid surfacing an undetected category. Add container detection in a later pass when container workloads are relevant.
