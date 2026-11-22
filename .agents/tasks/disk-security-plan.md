# Implementation Plan — Disk Detail View + Always-Visible Security Products

Two independent features. Feature 1 (security products) is frontend-only.
Feature 2 (disk details) is full-stack. Both are independent of each other and
can be implemented in either order. Feature 2 items within the backend must be
completed before the frontend items for Feature 2.

---

## Feature 1 — Always-visible security product rows

**Goal:** Remove the conditional that hides Firewall/Antivirus product lists when arrays are empty. Always show both sections; show per-product rows when data exists, fall back to the boolean chip when it does not.

---

- [ ] 1. Rewrite the Live Security Products block in `EndpointDetailPage.tsx`.

  **What:** Replace the outer conditional `{((endpoint.firewall_products && ...) || ...) && (...)}` (currently around line 540–568) with an unconditional block. Replace `<ProductBadgeList>` with an inline per-product row layout. Each product row shows: product name (text), an Enabled/Disabled chip, and an Up-to-date/Outdated chip. When the array is empty, render one chip using `endpoint.firewall_active` / `endpoint.antivirus_active` as the boolean fallback — identical to the current `ProductBadgeList` fallback path.

  **Exact location:** The block to replace starts at the line:
  ```tsx
  {((endpoint.firewall_products && endpoint.firewall_products.length > 0) ||
  ```
  and ends at the closing `)}` three lines after `</div>` (the outer conditional wrapper). The existing `ProductBadgeList` component can be left in place for now — it is no longer called by the Security Controls section but causes no harm.

  The replacement block (always rendered, no outer conditional):
  ```tsx
  <div className="mt-4 space-y-3 border-t border-border pt-4">
    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      Live Security Products
    </p>
    <div className="flex flex-col gap-3">
      {/* Firewall */}
      <div>
        <p className="mb-1.5 text-xs text-muted-foreground">Firewall</p>
        {(endpoint.firewall_products && endpoint.firewall_products.length > 0) ? (
          <div className="flex flex-col gap-1.5">
            {endpoint.firewall_products.map((p) => (
              <div key={p.name} className="flex items-center justify-between rounded-md border border-border bg-background/60 px-3 py-2">
                <span className="text-sm font-medium text-foreground">{p.name}</span>
                <div className="flex items-center gap-2">
                  <Badge className={cn("rounded-full text-xs", p.enabled ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive")}>
                    {p.enabled ? "Enabled" : "Disabled"}
                  </Badge>
                  <Badge className={cn("rounded-full text-xs", p.up_to_date ? "bg-success/15 text-success" : "bg-warning/15 text-warning")}>
                    {p.up_to_date ? "Up to date" : "Outdated"}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Badge className={cn("rounded-full text-xs", endpoint.firewall_active ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive")}>
            {endpoint.firewall_active ? "Enabled" : "Disabled"}
          </Badge>
        )}
      </div>
      {/* Antivirus */}
      <div>
        <p className="mb-1.5 text-xs text-muted-foreground">Antivirus</p>
        {(endpoint.antivirus_products && endpoint.antivirus_products.length > 0) ? (
          <div className="flex flex-col gap-1.5">
            {endpoint.antivirus_products.map((p) => (
              <div key={p.name} className="flex items-center justify-between rounded-md border border-border bg-background/60 px-3 py-2">
                <span className="text-sm font-medium text-foreground">{p.name}</span>
                <div className="flex items-center gap-2">
                  <Badge className={cn("rounded-full text-xs", p.enabled ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive")}>
                    {p.enabled ? "Enabled" : "Disabled"}
                  </Badge>
                  <Badge className={cn("rounded-full text-xs", p.up_to_date ? "bg-success/15 text-success" : "bg-warning/15 text-warning")}>
                    {p.up_to_date ? "Up to date" : "Outdated"}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Badge className={cn("rounded-full text-xs", endpoint.antivirus_active ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive")}>
            {endpoint.antivirus_active ? "Enabled" : "Disabled"}
          </Badge>
        )}
      </div>
    </div>
  </div>
  ```

  `cn` is already imported via `import { cn } from "@/lib/utils"` (line 16). `Badge` is already imported from `@/components/ui/badge` (line 1). No new imports are needed.

  **Files:** `frontend/src/frontend/src/pages/EndpointDetailPage.tsx`

  **Verify:** `cd frontend/src/frontend && pnpm run build` — exits 0 with no TypeScript errors.
  Then load the endpoint detail page in the browser for an endpoint that has product data and confirm per-product rows with two chips each; load an endpoint with no product data and confirm the fallback chip still appears.

---

## Feature 2 — Per-drive disk storage breakdown

### Step A — Backend model

- [ ] 2. Add `disk_details` field to `EndpointStatus` model.

  **What:** In `models.py`, inside the `EndpointStatus` class, add one field immediately after `disk_percent`:
  ```python
  disk_details = models.JSONField(default=list, blank=True)   # Per-drive breakdown [{"drive": "C:", "total_gb": 237.9, "used_gb": 115.4, "free_gb": 122.5, "percent": 48.5}]
  ```
  The existing field order in the Real-time health metrics section is:
  `cpu_percent`, `memory_percent`, `disk_percent`, `uptime_seconds`, `process_count`.
  Insert `disk_details` after `disk_percent` and before `uptime_seconds`.

  **Files:** `Backend/dashboard/models.py`

  **Verify:** `cd Backend && python manage.py check` — exits 0 with no errors.

---

- [ ] 3. Create migration `0022_endpointstatus_disk_details.py`.

  **What:** Create the file at `Backend/dashboard/migrations/0022_endpointstatus_disk_details.py`.
  Dependency is `("dashboard", "0021_endpointstatus_security_products")`.
  Use `migrations.AddField` for the JSONField (matching the pattern in `0021`), then add a `migrations.RunSQL` operation to set the column default at the database level:
  ```python
  migrations.RunSQL(
      sql="ALTER TABLE dashboard_endpointstatus ALTER COLUMN disk_details SET DEFAULT '[]'::jsonb;",
      reverse_sql="ALTER TABLE dashboard_endpointstatus ALTER COLUMN disk_details DROP DEFAULT;",
  )
  ```

  Full file content:
  ```python
  from django.db import migrations, models


  class Migration(migrations.Migration):

      dependencies = [("dashboard", "0021_endpointstatus_security_products")]

      operations = [
          migrations.AddField(
              model_name="endpointstatus",
              name="disk_details",
              field=models.JSONField(blank=True, default=list),
          ),
          migrations.RunSQL(
              sql="ALTER TABLE dashboard_endpointstatus ALTER COLUMN disk_details SET DEFAULT '[]'::jsonb;",
              reverse_sql="ALTER TABLE dashboard_endpointstatus ALTER COLUMN disk_details DROP DEFAULT;",
          ),
      ]
  ```

  **Files:** `Backend/dashboard/migrations/0022_endpointstatus_disk_details.py`

  **Verify:** `cd Backend && python manage.py migrate --run-syncdb 2>&1` — migration 0022 appears in output with "OK".

---

- [ ] 4. Accept and store `disk_details` in the health monitoring POST handler.

  **What:** In `views_health_monitoring.py`, in the `health_monitoring` view, after the existing block that handles `antivirus_products` (around line 109–117), add:
  ```python
  disk_details = health_data.get("disk_details") or data.get("disk_details") or []
  if isinstance(disk_details, str):
      import json as _json; disk_details = _json.loads(disk_details)
  endpoint.disk_details = disk_details
  ```
  This mirrors the exact pattern used for `firewall_products` / `antivirus_products` three lines above. Place it before the `endpoint.health_score` calculation line.

  **Files:** `Backend/dashboard/views_health_monitoring.py`

  **Verify:** `cd Backend && python manage.py check` — exits 0.

---

- [ ] 5. Expose `disk_details` in the `endpoints_status` API response.

  **What:** In `views.py`, inside the `endpoints_status` view, in the `rows.append({...})` dict (around line 160–183), add `"disk_details"` after the existing `"antivirus_products"` key:
  ```python
  "disk_details": ep.disk_details if hasattr(ep, 'disk_details') and ep.disk_details else [],
  ```

  **Files:** `Backend/dashboard/views.py`

  **Verify:** `cd Backend && python manage.py check` — exits 0. Then hit `GET /api/endpoints/status/` and confirm `disk_details` appears in the JSON response (it will be `[]` until an agent sends data).

---

### Step B — Agent (PowerShell + Python)

- [ ] 6. Collect per-drive data in `install_endpoint_agent.ps1` and pass it to `supabase_agent.py`.

  **What:** In `install_endpoint_agent.ps1`, inside the `Collect-And-Send-Health` function, after the existing `# DISK (system drive)` block (which captures `$diskPercent` for `$env:SystemDrive` only), add a new block that collects all fixed drives:

  ```powershell
  # DISK DETAILS — per-drive breakdown
  $diskDetails = @()
  try {
      $fixedDrives = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3"
      foreach ($drv in $fixedDrives) {
          if ($drv.Size -gt 0) {
              $totalGb  = [math]::Round($drv.Size / 1GB, 1)
              $freeGb   = [math]::Round($drv.FreeSpace / 1GB, 1)
              $usedGb   = [math]::Round(($drv.Size - $drv.FreeSpace) / 1GB, 1)
              $pct      = [math]::Round((($drv.Size - $drv.FreeSpace) / $drv.Size) * 100, 1)
              $diskDetails += @{
                  drive    = $drv.DeviceID
                  total_gb = $totalGb
                  used_gb  = $usedGb
                  free_gb  = $freeGb
                  percent  = $pct
              }
          }
      }
  } catch { }
  ```

  Then serialize `$diskDetails` to a temp JSON file using the same `ConvertTo-ProductJson`-style manual serialization (to avoid PowerShell's `True`/`False` boolean problem). Add a dedicated serializer for disk entries:

  ```powershell
  function ConvertTo-DiskDetailsJson {
      param([array]$drives)
      if ($drives.Count -eq 0) { return "[]" }
      $items = $drives | ForEach-Object {
          $drive   = $_.drive -replace '"', '\"'
          $total   = $_.total_gb
          $used    = $_.used_gb
          $free    = $_.free_gb
          $pct     = $_.percent
          "{`"drive`":`"$drive`",`"total_gb`":$total,`"used_gb`":$used,`"free_gb`":$free,`"percent`":$pct}"
      }
      return "[" + ($items -join ",") + "]"
  }
  ```

  Add this function definition immediately after `ConvertTo-ProductJson` in the script.

  Then, in the section that creates temp files and calls `supabase_agent.py`:
  - Add `$diskJson = ConvertTo-DiskDetailsJson -drives $diskDetails`
  - Add `$diskTempFile = [System.IO.Path]::GetTempFileName() + ".json"`
  - Add `$diskJson | Set-Content $diskTempFile -Encoding UTF8 -NoNewline`
  - Add `--disk-details "@$diskTempFile" `` to the `& $PythonPath $SupabaseHelper insert_health ...` call (after `--av-products`)
  - Add `$diskTempFile` to the existing `Remove-Item $fwTempFile, $avTempFile -ErrorAction SilentlyContinue` cleanup line so it becomes:
    `Remove-Item $fwTempFile, $avTempFile, $diskTempFile -ErrorAction SilentlyContinue`

  The `Collect-And-Send-Health` function is embedded as a here-string inside `$HealthAgentContent` in `install_endpoint_agent.ps1`, starting around line 768. All edits must be made inside that here-string block.

  **Files:** `Backend/Installer/Windows/install_endpoint_agent.ps1`

  **Verify:** No automated test; reviewer should manually confirm the here-string is syntactically correct PowerShell by checking for balanced `@'...'@` delimiters.

---

- [ ] 7. Add `--disk-details` argument to `supabase_agent.py` and include it in the SQL UPDATE.

  **What:** Three changes to `Backend/Installer/Windows/supabase_agent.py`:

  **A. Argument parser** (around line 523, after the `--av-products` line):
  ```python
  health_parser.add_argument("--disk-details", default="[]", help="JSON array of per-drive disk info")
  ```

  **B. `insert_health` method signature** (line 247, after `antivirus_products`):
  ```python
  disk_details: Optional[list] = None,
  ```
  Add at the top of the method body, after `if antivirus_products is None:`:
  ```python
  if disk_details is None:
      disk_details = []
  ```

  **C. SQL UPDATE** — extend the SET clause (around line 299–304). After `antivirus_products = %s,` add:
  ```python
  disk_details = %s,
  ```
  And add `json.dumps(disk_details),` to the `self.cursor.execute(update_query, (...))` tuple, in position after `json.dumps(antivirus_products)`.

  **D. Call site in `main()`** (around line 583–594) — after `antivirus_products = load_json_arg(args.av_products)` add:
  ```python
  disk_details = load_json_arg(args.disk_details)
  ```
  And pass `disk_details=disk_details` to `agent.insert_health(...)`.

  **Files:** `Backend/Installer/Windows/supabase_agent.py`

  **Verify:** Run `python Backend/Installer/Windows/supabase_agent.py insert_health --help` and confirm `--disk-details` appears in the output.

---

### Step C — Frontend

- [ ] 8. Add `DiskDetail` interface and `disk_details` field to `types.ts`.

  **What:** In `frontend/src/frontend/src/lib/types.ts`, after the `SecurityProduct` interface (line 10–14), add:
  ```typescript
  export interface DiskDetail {
    drive: string;
    total_gb: number;
    used_gb: number;
    free_gb: number;
    percent: number;
  }
  ```
  Then in the `EndpointStatus` interface (line 65–81), add after `disk_percent: number;`:
  ```typescript
  disk_details: DiskDetail[];
  ```

  **Files:** `frontend/src/frontend/src/lib/types.ts`

  **Verify:** `cd frontend/src/frontend && pnpm run build` — exits 0 (TypeScript will catch any references to `disk_details` with a wrong type elsewhere).

---

- [ ] 9. Map `disk_details` in the `fetchEndpoints` mapper.

  **What:** In `frontend/src/frontend/src/lib/endpoints.ts`, in the `fetchEndpoints` function, inside the `.map((ep: any) => ({...}))` call, add after the `antivirus_products` line:
  ```typescript
  disk_details: (ep.disk_details ?? []) as DiskDetail[],
  ```
  Also add `DiskDetail` to the import from `"./types"` at the top of the file.

  Current import block (lines 2–9):
  ```typescript
  import type {
    DashboardSummary,
    DeviceType,
    EndpointStatus,
    HealthTrendPoint,
    OSDistribution,
    QuickAlert,
    SecurityProduct,
  } from "./types";
  ```
  Change to add `DiskDetail`:
  ```typescript
  import type {
    DashboardSummary,
    DeviceType,
    DiskDetail,
    EndpointStatus,
    HealthTrendPoint,
    OSDistribution,
    QuickAlert,
    SecurityProduct,
  } from "./types";
  ```

  **Files:** `frontend/src/frontend/src/lib/endpoints.ts`

  **Verify:** `cd frontend/src/frontend && pnpm run build` — exits 0.

---

- [ ] 10. Add the expandable per-drive breakdown panel to the disk usage section in `EndpointDetailPage.tsx`.

  **What:** The disk usage section is currently inside the Hardware `<SectionCard>` (around offset 450–490 in the file). It renders a label row and a `<Progress>` bar with no interactivity.

  Add a `useState` toggle and a collapsible panel below the existing progress bar.

  **New imports to add:**

  1. Add `useState` to the React import. The file currently has no explicit React import; add:
     ```tsx
     import { useState } from "react";
     ```
     at the top of the file (before the existing `import { Button }` line).

  2. Add `ChevronDown, ChevronUp` to the existing lucide-react import block (lines 29–42). The current last entry before `} from "lucide-react"` is `Wrench`; add:
     ```tsx
     ChevronDown,
     ChevronUp,
     ```
     before the closing `}`.

  3. Add `DiskDetail` to the type import from `"@/lib/types"` (line 20–27). Current imports:
     ```tsx
     import type {
       EndpointStatus,
       OS,
       RiskFinding,
       SecurityControls,
       SecurityProduct,
     } from "@/lib/types";
     ```
     Add `DiskDetail` to this list.

  **State:** Add inside `EndpointDetailPage` component body, before the `return` statement:
  ```tsx
  const [diskExpanded, setDiskExpanded] = useState(false);
  ```

  **Disk section replacement:** Replace the entire `<div className="mt-4">` block that contains the disk label + progress bar (around lines 476–490 of the file — search for `HardDrive className="size-4"`) with:

  ```tsx
  <div className="mt-4">
    <button
      type="button"
      className="mb-1.5 flex w-full items-center justify-between text-sm"
      onClick={() => setDiskExpanded((v) => !v)}
      aria-expanded={diskExpanded}
    >
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <HardDrive className="size-4" aria-hidden="true" />
        Disk usage
      </span>
      <span className="flex items-center gap-2">
        <span className="font-mono font-medium text-foreground">
          {formatPercent(audit.hardware.diskPercent)}
        </span>
        {endpoint.disk_details && endpoint.disk_details.length > 0 && (
          diskExpanded
            ? <ChevronUp className="size-3.5 text-muted-foreground" />
            : <ChevronDown className="size-3.5 text-muted-foreground" />
        )}
      </span>
    </button>
    <Progress
      value={audit.hardware.diskPercent}
      indicatorClassName={utilizationBarColor(audit.hardware.diskPercent)}
      aria-label={`Disk usage ${formatPercent(audit.hardware.diskPercent)}`}
    />
    {diskExpanded && endpoint.disk_details && endpoint.disk_details.length > 0 && (
      <div className="mt-3 space-y-2" data-ocid="endpoint_detail.disk_breakdown">
        {endpoint.disk_details.map((d: DiskDetail) => (
          <div key={d.drive} className="rounded-md border border-border bg-background/60 p-3">
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="font-mono font-semibold text-foreground">{d.drive}</span>
              <span className="text-muted-foreground">
                {d.used_gb} GB / {d.total_gb} GB
                <span className="ml-1.5 font-mono font-medium text-foreground">
                  ({d.percent}%)
                </span>
              </span>
            </div>
            <Progress
              value={d.percent}
              indicatorClassName={utilizationBarColor(d.percent)}
              aria-label={`${d.drive} disk usage ${d.percent}%`}
            />
          </div>
        ))}
      </div>
    )}
  </div>
  ```

  When `endpoint.disk_details` is empty or absent, the section looks identical to the current state (progress bar only, no chevron, no panel). When data is present, the entire row is a button that toggles the breakdown panel.

  **Files:** `frontend/src/frontend/src/pages/EndpointDetailPage.tsx`

  **Verify:** `cd frontend/src/frontend && pnpm run build` — exits 0 with no TypeScript errors. Load the endpoint detail page; click the disk usage row to expand it. Confirm drives appear with individual progress bars showing `used_gb / total_gb (percent%)`.

---

## Cross-cutting notes

- The MAC and Linux `supabase_agent.py` files at `Backend/Installer/MAC/supabase_agent.py` and `Backend/Installer/Linux/supabase_agent.py` are stripped-down variants (the MAC one is a 65-line minimalist script). The `--disk-details` argument is only required for the Windows agent (item 7). Do not modify the MAC or Linux variants unless asked.
- Items 2–5 must run against the same Django database. Run `python manage.py migrate` on the deployment database before the updated agent starts sending `disk_details`.
- The `install_endpoint_agent.ps1` file contains the health agent script as an embedded here-string (`$HealthAgentContent = @'...'@`). Item 6 edits are entirely within that string. The file on disk at the agent machine (`C:\Program Files\EndpointAgent\health-monitor-agent.ps1`) is generated by this installer; to deploy the change to existing machines, re-run the installer or manually patch the generated file using the same technique shown in the original user workflow.
