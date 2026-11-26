# Investigation Report: Running Applications & Audit Report Fields

**Date:** 2024  
**Investigated by:** Kiro Investigation Agent  
**Task:** Analyze real-time running applications capability and audit report field coverage gaps

---

## Executive Summary

### Question 1: Real-time Running Applications
**Current State:** The health monitor does NOT collect running processes/applications. The `process_count` field exists in the backend model but is never populated by agents.

**What's Missing:** A complete solution would require:
1. Agent scripts to collect process data (name, PID, CPU%, memory%)
2. Backend API updates to accept process lists
3. Database storage strategy (inline JSON vs separate table)
4. Frontend UI to display the live process list

### Question 2: Audit Report Fields Not Shown in Portal
**Gap Analysis:** The Windows and Linux parsers extract rich data that is stored in the `raw_data` JSON field but NOT displayed in the frontend:

**Windows parser extracts but frontend doesn't show:**
- Running services (name, display name, status)
- Open listening ports (address, port, process)
- Installed software inventory (name, version, publisher)
- Browser extensions (browser, extension ID)
- Local administrator accounts
- All local user accounts (enabled status, password policy)
- Scheduled tasks (name, path, state)
- Installed patches (HotFixID, description, installed date)

**Linux parser extracts but frontend doesn't show:**
- World-writable directories count
- Network shares (Samba/NFS)
- Running services list
- Network listeners (open ports)
- Installed packages count

---

## Question 1: Real-time Running Applications

### 1.1 Health Monitor Collection

**Windows Health Monitor** (`Backend/Installer/Windows/install_endpoint_agent.ps1`, lines 760-1050):

**What it DOES collect:**
- CPU percent (line ~820)
- Memory percent (line ~827)
- Disk percent (line ~834)
- Uptime seconds (line ~841)
- Firewall products with enabled status (lines ~850-920)
- Antivirus products with enabled status (lines ~925-990)
- Disk details per drive (lines ~995-1020)

**What it DOES NOT collect:**
- Process count
- Running applications list
- Per-process CPU/memory metrics

**Code evidence:**
```powershell
# Lines 820-841 show the metrics collected
$cpuPercent = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
$memPercent = ...
$diskPercent = ...
$uptimeSeconds = ...
# No Get-Process or Win32_Process calls
```

**Linux Health Monitor** (`Backend/heartbeat/linux/heartbeat.sh`):

**What it collects:**
- Firewall products detection (lines 90-100)
- Antivirus products detection (lines 105-115)
- Basic heartbeat identity data

**What it DOES NOT collect:**
- Process count
- Running applications
- Per-process metrics

**Code evidence:**
```bash
# No ps or top commands to collect process data
# Only sends: hostname, os, ip_address, username, agent_version, mac_address, wol_enabled, device_type, firewall_products, antivirus_products
```

### 1.2 Backend Storage

**EndpointStatus Model** (`Backend/dashboard/models.py`, lines 230-260):

**Fields present:**
```python
cpu_percent = models.FloatField(null=True, blank=True)          # CPU usage %
memory_percent = models.FloatField(null=True, blank=True)       # Memory usage %
disk_percent = models.FloatField(null=True, blank=True)         # Disk usage %
disk_details = models.JSONField(default=list, blank=True)       # Per-drive breakdown
uptime_seconds = models.BigIntegerField(null=True, blank=True)  # Device uptime
process_count = models.IntegerField(null=True, blank=True)      # Active processes — NEVER POPULATED
```

**Analysis:** The `process_count` field exists but is never set by the agents or the heartbeat API. No field exists for a detailed process list (name, PID, CPU%, memory%).

### 1.3 Backend API

**Heartbeat API** (`Backend/dashboard/views.py`, lines 1-100):

The heartbeat endpoint (`POST /api/heartbeat/`) accepts:
- hostname, os, ip_address, username, agent_version, mac_address
- wol_enabled, device_type
- firewall_products, antivirus_products

**What it does NOT accept:**
- process_count
- running_apps / process_list

**Endpoints Status API** (`Backend/dashboard/views.py`, lines 160-230):

The `GET /api/endpoints/status/` endpoint returns `process_count` in the JSON response (line ~198), but this field is always `None` because no agent populates it.

### 1.4 Frontend Display

**EndpointStatus Type** (`frontend/src/lib/types.ts`, lines 71-94):

```typescript
export interface EndpointStatus {
  hostname: string;
  mac_address: string;
  cpu_percent: number;
  memory_percent: number;
  disk_percent: number;
  uptime_seconds: number | null;
  // No process_count or running_apps field
}
```

**EndpointDetailPage** (`frontend/src/pages/EndpointDetailPage.tsx`):

Shows:
- CPU cores, CPU model, RAM, architecture
- Disk usage (with expandable per-drive breakdown)
- Security controls
- Uptime

**Does NOT show:**
- Process count
- Running applications list

**LiveMonitoring page** (`frontend/src/pages/LiveMonitoring.tsx`):

Shows KPIs for CPU, memory, disk utilization across the fleet. Does NOT show process metrics.

### 1.5 What Would Be Needed

To show a live list of running applications (name, PID, CPU%, memory%), you would need:

#### A. Agent Changes

**Windows** (`health-monitor-agent.ps1`):
```powershell
# Add after line 841 (uptime collection)
$processCount = (Get-Process).Count
$topProcesses = Get-Process | Sort-Object CPU -Descending | Select-Object -First 20 | ForEach-Object {
    @{
        name = $_.ProcessName
        pid = $_.Id
        cpu_percent = [math]::Round($_.CPU, 2)
        memory_mb = [math]::Round($_.WorkingSet64 / 1MB, 1)
    }
}
```

**Linux** (`heartbeat.sh` or separate health script):
```bash
# Collect top 20 processes by CPU
PROCESS_COUNT=$(ps aux | wc -l)
TOP_PROCESSES=$(ps aux --sort=-%cpu | head -n 21 | tail -n 20 | awk '{print $11, $2, $3, $4}')
```

#### B. Backend API Changes

**Update heartbeat handler** (`Backend/dashboard/views.py`):
```python
# Accept process_count and running_apps in the POST body
data = json.loads(request.body)
process_count = data.get("process_count")
running_apps = data.get("running_apps", [])  # list of {name, pid, cpu_percent, memory_mb}

# Store in EndpointStatus
defaults["process_count"] = process_count
# Option 1: Store in JSONField
defaults["running_apps"] = running_apps
# Option 2: Create separate ProcessSnapshot model with foreign key to EndpointStatus
```

**Model change** (`Backend/dashboard/models.py`):
```python
class EndpointStatus(models.Model):
    # ... existing fields ...
    process_count = models.IntegerField(null=True, blank=True)
    running_apps = models.JSONField(default=list, blank=True)  # [{name, pid, cpu_percent, memory_mb}]
```

**API serialization** (`Backend/dashboard/api_views.py`, line ~220):
```python
def _serialize_endpoint_status(ep):
    return {
        # ... existing fields ...
        "process_count": ep.process_count,
        "running_apps": ep.running_apps,  # Add this
    }
```

#### C. Frontend Changes

**Type definition** (`frontend/src/lib/types.ts`):
```typescript
export interface ProcessInfo {
  name: string;
  pid: number;
  cpu_percent: number;
  memory_mb: number;
}

export interface EndpointStatus {
  // ... existing fields ...
  process_count: number | null;
  running_apps: ProcessInfo[];
}
```

**UI Component** (new section in `EndpointDetailPage.tsx`):
```tsx
<SectionCard
  icon={<MonitorCog className="size-4" />}
  title="Running Applications"
  description="Top processes by CPU usage"
>
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>Process</TableHead>
        <TableHead>PID</TableHead>
        <TableHead>CPU %</TableHead>
        <TableHead>Memory (MB)</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {endpoint.running_apps.map((proc) => (
        <TableRow key={proc.pid}>
          <TableCell className="font-mono">{proc.name}</TableCell>
          <TableCell>{proc.pid}</TableCell>
          <TableCell>{proc.cpu_percent}%</TableCell>
          <TableCell>{proc.memory_mb} MB</TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
</SectionCard>
```

---

## Question 2: Audit Report Fields Not Shown in Portal

### 2.1 Windows Parser Output

**File:** `Backend/parsers/windows_parser.py`

**ALL fields returned** (lines 550-650):

**Identity:**
- hostname, os_type, os_name, os_version, architecture, ip_address, report_date, report_file

**Hardware:**
- cpu, ram, bios_version

**Security controls:**
- firewall_enabled, encryption_enabled, antivirus_installed, antivirus_name, antivirus_realtime, antivirus_updated_at, antivirus_tamper
- secure_boot_enabled, tpm_present
- usb_storage_enabled, screen_lock_enabled, chrome_remote_desktop

**Updates:**
- pending_updates, last_patch_date

**Password policy:**
- pass_max_days, pass_min_days, pass_min_len, lockout_threshold

**Remote access:**
- anydesk_running, teamviewer_running, rdp_open

**raw_data (lines 500-545):**
- running_services: `[{name, display, status}]` (Section 19)
- open_ports: `[{address, port, process}]` (Section 20)
- installed_software: `[{name, version, publisher}]` (Section 23)
- browser_extensions: `[{browser, id}]` (Section 24)
- admin_accounts: `[username_string]` (Section 7)
- all_users: `[{name, enabled, pwd_never_expires}]` (Section 7a)
- scheduled_tasks: `[{name, path, state}]` (Section 22)
- installed_patches: `[{id, description, installed_on}]` (Section 6)

**Code evidence:**
```python
# Lines 500-545
raw_data = {
    "running_services": services,          # [{name, display, status}]
    "open_ports": open_ports,              # [{address, port, process}]
    "installed_software": installed_sw,    # [{name, version, publisher}]
    "browser_extensions": browser_extensions,  # [{browser, id}]
    "admin_accounts": admin_accounts,      # [string]
    "all_users": all_users,                # [{name, enabled, pwd_never_expires}]
    "scheduled_tasks": scheduled_tasks,    # [{name, path, state}]
    "installed_patches": installed_patches,  # [{id, description, installed_on}]
}
```

### 2.2 Linux Parser Output

**File:** `Backend/parsers/linux_parser.py`

**ALL fields returned** (lines 310-350):

**Identity:**
- hostname, os_type, os_name, os_version, kernel, architecture, ip_address, report_date, report_file

**Hardware:**
- cpu, ram

**Security controls:**
- firewall_enabled, encryption_enabled
- antivirus_installed (always empty name for Linux)
- secure_boot_enabled, tpm_present
- ssh_enabled, auditd_enabled, passwordless_sudo

**Updates:**
- pending_updates

**Password policy:**
- pass_max_days, pass_min_days

**Remote access:**
- anydesk_running, teamviewer_running, chrome_remote_desktop

**raw_data (lines 285-305):**
- world_writable_dirs: `int` count
- network_shares: `[share_name_string]`
- running_services: `[service_name_string]` (from systemd)
- network_listeners: `[netstat_line_string]`
- installed_packages_count: `int`

**Code evidence:**
```python
# Lines 285-305
raw_data = {
    "world_writable_dirs": ww_count,       # int
    "network_shares": shares,              # [string]
    "running_services": services,          # [string]
    "network_listeners": listeners,        # [string]
    "installed_packages_count": sw_count,  # int
}
```

### 2.3 EndpointReport Model Storage

**File:** `Backend/dashboard/models.py`, lines 1-120

**Model fields:**
All the top-level fields from the parsers are stored as dedicated columns (firewall_enabled, antivirus_installed, etc.)

**raw_data field:**
```python
raw_data = models.JSONField(default=dict)  # Line ~90
```

This field stores the full `raw_data` dictionary from both parsers, preserving:
- Windows: running_services, open_ports, installed_software, browser_extensions, admin_accounts, all_users, scheduled_tasks, installed_patches
- Linux: world_writable_dirs, network_shares, running_services, network_listeners, installed_packages_count

### 2.4 API Serialization

**File:** `Backend/dashboard/api_views.py`, lines 150-230

**_serialize_report function** returns:

```python
def _serialize_report(report):
    return {
        "id": report.id,
        "hostname": report.hostname,
        "mac_address": report.mac_address,
        "os_type": report.os_type,
        "os_name": report.os_name,
        "os_version": report.os_version,
        "ip_address": report.ip_address,
        "report_date": report.report_date.isoformat(),
        "cpu": report.cpu,
        "cpu_model": report.cpu_model,
        "ram": report.ram,
        "firewall_enabled": report.firewall_enabled,
        "encryption_enabled": report.encryption_enabled,
        "antivirus_installed": report.antivirus_installed,
        "antivirus_name": report.antivirus_name,
        "secure_boot_enabled": report.secure_boot_enabled,
        "tpm_present": report.tpm_present,
        "ssh_enabled": report.ssh_enabled,
        "auditd_enabled": report.auditd_enabled,
        "passwordless_sudo": report.passwordless_sudo,
        "sip_enabled": report.sip_enabled,
        "gatekeeper_enabled": report.gatekeeper_enabled,
        "pending_updates": report.pending_updates,
        "last_patch_date": report.last_patch_date.isoformat() if report.last_patch_date else None,
        "pass_max_days": report.pass_max_days,
        "pass_min_days": report.pass_min_days,
        "pass_min_len": report.pass_min_len,
        "lockout_threshold": report.lockout_threshold,
        "usb_storage_enabled": report.usb_storage_enabled,
        "screen_lock_enabled": report.screen_lock_enabled,
        "chrome_remote_desktop": report.chrome_remote_desktop,
        "antivirus_tamper": report.antivirus_tamper,
        "anydesk_running": report.anydesk_running,
        "teamviewer_running": report.teamviewer_running,
        "rdp_open": report.rdp_open,
        "risk_score": report.risk_score,
        "risk_level": report.risk_level,
        "raw_data": report.raw_data,  # <-- Full raw_data IS returned
    }
```

**Key finding:** The API DOES return `raw_data` (line ~230), so the frontend receives all the extra fields.

### 2.5 Frontend Display

**File:** `frontend/src/pages/EndpointDetailPage.tsx`

**What the frontend SHOWS:**
- Hardware: CPU cores, CPU model, RAM, architecture, disk usage breakdown (lines 180-240)
- Network: IP, MAC, last seen, uptime, connection uptime (lines 243-275)
- Security controls: firewall, encryption, antivirus, secure boot, TPM, SSH, auditd, passwordless sudo, SIP, Gatekeeper (lines 278-370)
- Security products: live firewall_products and antivirus_products from health monitor (lines 372-420)
- Compliance findings: risk findings list (lines 423-460)
- Updates: pending updates, last patch date, password policy (pass_max_days) (lines 463-495)
- Related reports: audit history timeline (lines 498-550)

**What the frontend DOES NOT SHOW from raw_data:**

**Windows:**
- Running services list
- Open listening ports (except boolean flags like rdp_open)
- Installed software inventory
- Browser extensions
- Local administrator accounts list
- All local user accounts
- Scheduled tasks
- Installed patches list

**Linux:**
- World-writable directories count
- Network shares list
- Running services list
- Network listeners
- Installed packages count

**Code evidence:**
The component reads `endpoint.audit` which is mapped from the API response, but only accesses the typed fields like `audit.hardware.cpuCores`, `audit.security.firewall`, etc. There is no code that accesses `audit.raw_data` or iterates over its nested arrays.

### 2.6 Gap Analysis Summary

| **Parser Field (raw_data)** | **Model Stored** | **API Returns** | **Frontend Shows** | **Gap** |
|-----------------------------|------------------|-----------------|-------------------|---------|
| **Windows:** | | | | |
| running_services | ✅ raw_data JSON | ✅ Yes | ❌ No | **Missing UI** |
| open_ports | ✅ raw_data JSON | ✅ Yes | ❌ No | **Missing UI** |
| installed_software | ✅ raw_data JSON | ✅ Yes | ❌ No | **Missing UI** |
| browser_extensions | ✅ raw_data JSON | ✅ Yes | ❌ No | **Missing UI** |
| admin_accounts | ✅ raw_data JSON | ✅ Yes | ❌ No | **Missing UI** |
| all_users | ✅ raw_data JSON | ✅ Yes | ❌ No | **Missing UI** |
| scheduled_tasks | ✅ raw_data JSON | ✅ Yes | ❌ No | **Missing UI** |
| installed_patches | ✅ raw_data JSON | ✅ Yes | ❌ No | **Missing UI** |
| **Linux:** | | | | |
| world_writable_dirs | ✅ raw_data JSON | ✅ Yes | ❌ No | **Missing UI** |
| network_shares | ✅ raw_data JSON | ✅ Yes | ❌ No | **Missing UI** |
| running_services | ✅ raw_data JSON | ✅ Yes | ❌ No | **Missing UI** |
| network_listeners | ✅ raw_data JSON | ✅ Yes | ❌ No | **Missing UI** |
| installed_packages_count | ✅ raw_data JSON | ✅ Yes | ❌ No | **Missing UI** |

**Key Finding:** All the data is already collected, stored, and returned by the API. The gap is purely a **frontend display issue** — the UI does not render the `raw_data` contents.

---

## Recommendations

### For Question 1: Real-time Running Applications

**Recommendation:** Implement process monitoring in phases:

**Phase 1 (simple):**
- Add `process_count` collection to Windows and Linux health monitors
- Update heartbeat API to accept `process_count`
- Display the count in the frontend (no detailed list yet)

**Phase 2 (full):**
- Collect top 20 processes by CPU usage
- Store as `running_apps` JSONField in EndpointStatus
- Create a "Running Applications" card in EndpointDetailPage showing the table
- Consider adding filters (search by name, sort by CPU/memory)

**Phase 3 (advanced):**
- Add historical tracking (separate ProcessSnapshot model with timestamps)
- Alert on suspicious processes (high CPU for >5 min)
- Process baseline learning (detect new/unknown processes)

### For Question 2: Audit Report Fields Not Shown

**Recommendation:** Add UI sections to display the hidden `raw_data` fields:

**High Priority (security-relevant):**
1. **Local admin accounts** (Windows) — shows privilege escalation risk
2. **Open ports** (Windows) — shows attack surface
3. **Scheduled tasks** (Windows) — shows persistence mechanisms
4. **World-writable dirs** (Linux) — shows permission issues
5. **Running services** (both) — shows what's actually active

**Medium Priority (compliance/inventory):**
6. **Installed software** (Windows) — license tracking, vulnerability scanning
7. **Browser extensions** (Windows) — data exfiltration risk
8. **Installed patches** (Windows) — patch history timeline

**Low Priority (informational):**
9. **All users** (Windows) — full user inventory
10. **Network shares** (Linux) — file sharing exposure
11. **Network listeners** (Linux) — alternative to open ports view

**Implementation approach:**
- Add collapsible sections to `EndpointDetailPage.tsx`
- Read fields from `endpoint.audit.raw_data`
- Use Table components for lists (services, software, ports)
- Use Badge components for counts (admin accounts, world-writable dirs)
- Add search/filter for long lists (installed software can be hundreds of entries)

**Example code addition:**
```tsx
{/* Add after the Security Controls section */}
{endpoint.audit.raw_data?.admin_accounts && (
  <SectionCard
    icon={<Users className="size-4" />}
    title="Administrator Accounts"
    description="Local accounts with admin privileges"
  >
    <div className="flex flex-wrap gap-2">
      {endpoint.audit.raw_data.admin_accounts.map((user: string) => (
        <Badge key={user} variant="outline">{user}</Badge>
      ))}
    </div>
  </SectionCard>
)}
```

---

## Verification Evidence

### Files Read
1. ✅ `Backend/Installer/Windows/install_endpoint_agent.ps1` (lines 760-1050) — Windows health monitor
2. ✅ `Backend/heartbeat/linux/heartbeat.sh` (full file) — Linux heartbeat agent
3. ✅ `Backend/dashboard/models.py` (EndpointStatus and EndpointReport models)
4. ✅ `Backend/dashboard/views.py` (heartbeat API and endpoints_status view)
5. ✅ `Backend/dashboard/api_views.py` (_serialize_report function)
6. ✅ `Backend/parsers/windows_parser.py` (full parser, raw_data construction)
7. ✅ `Backend/parsers/linux_parser.py` (full parser, raw_data construction)
8. ✅ `frontend/src/pages/EndpointDetailPage.tsx` (what's displayed)
9. ✅ `frontend/src/pages/LiveMonitoring.tsx` (live metrics display)
10. ✅ `frontend/src/lib/types.ts` (TypeScript type definitions)

### Commands Run
- None (read-only investigation)

### Findings Verified
- ✅ No process collection in Windows health monitor (checked lines 760-1050, no `Get-Process`)
- ✅ No process collection in Linux heartbeat (checked full file, no `ps` commands)
- ✅ `process_count` field exists but never populated (models.py line ~260, views.py never sets it)
- ✅ All `raw_data` fields documented (parsers return them, model stores them, API serializes them)
- ✅ Frontend does not access `raw_data` contents (searched .tsx files for running_services, installed_software, etc. — no matches)

---

**Investigation complete.** Both questions have definitive answers with file/line citations.
