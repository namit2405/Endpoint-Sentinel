# Implementation Plan — Named Security Product Detection

## Overview

Add `firewall_products` and `antivirus_products` JSON arrays (list of `{name, enabled, up_to_date}` objects) to the full Endpoint Sentinel stack. The existing `firewall_active` and `antivirus_active` boolean fields are kept; the new arrays complement them. The boolean flags are derived from the product lists when lists are present.

The 13 changes are grouped into 4 ordered stages:
- **Stage A** (items 1–2): database — model + migration
- **Stage B** (items 3–5): Django backend — accept, store, and serialize
- **Stage C** (items 6–9): agents — collect and transmit
- **Stage D** (items 10–13): frontend — types, mapper, UI

Each item leaves the codebase buildable. Stages B and D each depend on the item immediately before them.

---

## Stage A — Database

- [ ] 1. **Add `firewall_products` and `antivirus_products` to `EndpointStatus` in `models.py`.**

  After the existing `antivirus_active` field (line ~186 of models.py, inside the `# ── Security status ──` block), insert:

  ```python
  firewall_products = models.JSONField(default=list, blank=True)
  antivirus_products = models.JSONField(default=list, blank=True)
  ```

  Do not change any other field. `firewall_active` and `antivirus_active` remain on lines just above the two new fields.

  **Files:** `Backend/dashboard/models.py`

  **Verify:** `python manage.py check --deploy 2>&1 | head` — no errors. (Run from `Backend/` with the Django settings env var set.)

---

- [ ] 2. **Create migration `0021_endpointstatus_product_lists.py`.**

  Depends on item 1. Create the file by hand (do not run `makemigrations` in production — the migration must be deterministic):

  ```python
  # Generated manually
  from django.db import migrations, models

  class Migration(migrations.Migration):

      dependencies = [
          ("dashboard", "0020_endpointdevice_device_type"),
      ]

      operations = [
          migrations.AddField(
              model_name="endpointstatus",
              name="firewall_products",
              field=models.JSONField(default=list, blank=True),
          ),
          migrations.AddField(
              model_name="endpointstatus",
              name="antivirus_products",
              field=models.JSONField(default=list, blank=True),
          ),
      ]
  ```

  **Files:** `Backend/dashboard/migrations/0021_endpointstatus_product_lists.py`

  **Verify:** `python manage.py migrate --plan` — migration 0021 appears as not yet applied; `python manage.py migrate` — applies cleanly with no errors.

---

## Stage B — Django Backend

- [ ] 3. **`views_health_monitoring.py` — accept product lists in `health_monitoring()` and derive booleans from them.**

  Depends on item 1. In `health_monitoring()`, after the block that reads `health_data` (around line 110 where `endpoint.firewall_active` and `endpoint.antivirus_active` are set), make these changes:

  **a)** Read the two new fields from `health_data` (or fall back to the top-level `data` dict, same pattern used for all other fields):

  ```python
  firewall_products = health_data.get("firewall_products") or data.get("firewall_products") or []
  antivirus_products = health_data.get("antivirus_products") or data.get("antivirus_products") or []
  ```

  **b)** Derive the booleans **only when the product list is non-empty**; otherwise fall back to the existing boolean sent by older agents:

  ```python
  if firewall_products:
      endpoint.firewall_active = any(p.get("enabled") for p in firewall_products)
  else:
      endpoint.firewall_active = health_data.get("firewall_active")

  if antivirus_products:
      endpoint.antivirus_active = any(p.get("enabled") for p in antivirus_products)
  else:
      endpoint.antivirus_active = health_data.get("antivirus_active")
  ```

  **c)** Store the product lists on the endpoint:

  ```python
  endpoint.firewall_products = firewall_products
  endpoint.antivirus_products = antivirus_products
  ```

  Place lines (b) and (c) **before** the `calculate_health_score(...)` call so the derived booleans feed the score calculation. Remove the two original lines `endpoint.firewall_active = health_data.get("firewall_active")` and `endpoint.antivirus_active = health_data.get("antivirus_active")` that are now superseded by the conditional logic in (b).

  Also pass `firewall_products` and `antivirus_products` to the `EndpointMetricsHistory.objects.create(...)` call at the bottom of the function. The `EndpointMetricsHistory` model does **not** store product lists (they would bloat the time-series table); the boolean fields that are already there (`firewall_active`, `antivirus_active`) continue to be set from the derived values, which is now automatic because `endpoint.firewall_active` is already derived correctly.

  **Files:** `Backend/dashboard/views_health_monitoring.py`

  **Verify:** `python manage.py test dashboard.tests` (or the project's test runner). Send a test POST to `/api/agent/health-monitoring/` with `"firewall_products": [{"name":"Windows Defender","enabled":true,"up_to_date":true}]` and confirm the row in `dashboard_endpointstatus` has the JSON column populated.

---

- [ ] 4. **`api_views.py` — add product lists to `_serialize_endpoint_status()`.**

  Depends on item 1. In `_serialize_endpoint_status(ep)` (around line 145), after the existing `"antivirus_active": ep.antivirus_active,` line, add:

  ```python
  "firewall_products": ep.firewall_products if ep.firewall_products is not None else [],
  "antivirus_products": ep.antivirus_products if ep.antivirus_products is not None else [],
  ```

  **Files:** `Backend/dashboard/api_views.py`

  **Verify:** `python manage.py test dashboard.tests` — no regressions. `GET /api/dashboard/machine/<id>/` response includes `firewall_products` and `antivirus_products` keys.

---

- [ ] 5. **`views.py` — add product lists to the `rows.append({...})` dict inside `endpoints_status()`.**

  Depends on item 1. In `endpoints_status()`, find the `rows.append({...})` block (lines ~185–210). After `"antivirus_active": ep.antivirus_active,`, add:

  ```python
  "firewall_products": ep.firewall_products if ep.firewall_products is not None else [],
  "antivirus_products": ep.antivirus_products if ep.antivirus_products is not None else [],
  ```

  **Files:** `Backend/dashboard/views.py`

  **Verify:** `python manage.py test dashboard.tests` — no regressions. `GET /api/endpoints/status/` response for any endpoint includes `firewall_products` and `antivirus_products` keys.

---

## Stage C — Agents

- [ ] 6. **`install_endpoint_agent.ps1` — replace the simple firewall/AV check in `Collect-And-Send-Health` with WSC CIM-based detection.**

  Depends on nothing (independent of Stage B but deployed together). The function body starts at line 768 of `install_endpoint_agent.ps1`. Replace the `# FIREWALL` block (currently lines ~804–820) and add a new `# ANTIVIRUS` block immediately after it, then serialize both lists to JSON and pass them to `supabase_agent.py`.

  **Exact replacement for the firewall block (lines ~804–820):**

  ```powershell
  # FIREWALL — WSC SecurityCenter2
  $firewallActive = $false
  $FwProducts = @()
  try {
      $WscFWs = Get-CimInstance -Namespace "root\SecurityCenter2" -ClassName "FirewallProduct" -ErrorAction Stop
      foreach ($fw in $WscFWs) {
          $state   = [int]$fw.productState
          $enabled = (($state -shr 16) -band 0xFF) -eq 0x11
          $upToDate = (($state -shr  8) -band 0xFF) -ne 0x10
          $FwProducts += @{ name = $fw.displayName; enabled = $enabled; up_to_date = $upToDate }
          if ($enabled) { $firewallActive = $true }
      }
  } catch { }
  if ($FwProducts.Count -eq 0) {
      # WSC unavailable — fall back to Windows Defender Firewall profiles
      try {
          $profiles = Get-NetFirewallProfile -ErrorAction Stop
          $allEnabled = -not ($profiles | Where-Object { -not $_.Enabled })
          $FwProducts += @{ name = "Windows Defender Firewall"; enabled = $allEnabled; up_to_date = $true }
          if ($allEnabled) { $firewallActive = $true }
      } catch { }
  }
  # Serialize: ConvertTo-Json wraps a single-item array as an object — force array
  if ($FwProducts.Count -eq 1) { $fwJson = "[" + ($FwProducts[0] | ConvertTo-Json -Compress) + "]" }
  elseif ($FwProducts.Count -gt 1) { $fwJson = $FwProducts | ConvertTo-Json -Compress }
  else { $fwJson = "[]" }
  ```

  **New antivirus block (insert immediately after the firewall block):**

  ```powershell
  # ANTIVIRUS — WSC SecurityCenter2
  $antivirusActive = $false
  $AvProducts = @()
  try {
      $WscAVs = Get-CimInstance -Namespace "root\SecurityCenter2" -ClassName "AntiVirusProduct" -ErrorAction Stop
      foreach ($av in $WscAVs) {
          $state    = [int]$av.productState
          $enabled  = (($state -shr 16) -band 0xFF) -eq 0x11
          $upToDate = (($state -shr  8) -band 0xFF) -ne 0x10
          $AvProducts += @{ name = $av.displayName; enabled = $enabled; up_to_date = $upToDate }
          if ($enabled) { $antivirusActive = $true }
      }
  } catch { }
  if ($AvProducts.Count -eq 0) {
      # Fall back to Windows Defender via Get-MpComputerStatus
      try {
          $mp = Get-MpComputerStatus -ErrorAction Stop
          $enabled  = $mp.AntivirusEnabled
          $upToDate = $mp.AntivirusSignatureAge -le 7
          $AvProducts += @{ name = "Windows Defender"; enabled = $enabled; up_to_date = $upToDate }
          if ($enabled) { $antivirusActive = $true }
      } catch { }
  }
  if ($AvProducts.Count -eq 1) { $avJson = "[" + ($AvProducts[0] | ConvertTo-Json -Compress) + "]" }
  elseif ($AvProducts.Count -gt 1) { $avJson = $AvProducts | ConvertTo-Json -Compress }
  else { $avJson = "[]" }
  ```

  **Replace the `& $PythonPath $SupabaseHelper insert_health ...` call** (currently passing `--firewall`) with:

  ```powershell
  Log-Msg "Sending health to Supabase (CPU: ${cpuPercent}%, MEM: ${memPercent}%, DISK: ${diskPercent}%, UPTIME: ${uptimeSeconds}s, FW: ${firewallActive}, AV: ${antivirusActive})"

  & $PythonPath $SupabaseHelper insert_health `
      --mac $macValue `
      --cpu $cpuPercent `
      --mem $memPercent `
      --disk $diskPercent `
      --uptime $uptimeSeconds `
      --hostname $hostnameValue `
      --ip $ipValue `
      --firewall-products $fwJson `
      --av-products $avJson 2>$null
  ```

  Remove the old `--firewall $(if ($firewallActive) { "true" } else { "false" })` argument. The boolean will now be derived server-side from the product list.

  **Files:** `Backend/Installer/Windows/install_endpoint_agent.ps1`

  **Verify:** In a test PowerShell session, dot-source just the function block and call `Collect-And-Send-Health` (with mock `$PythonPath` and `$SupabaseHelper` overridden). Confirm `$fwJson` and `$avJson` are well-formed JSON arrays. Full end-to-end: reinstall on a VM and check the DB row.

---

- [ ] 7. **`Backend/Installer/Windows/supabase_agent.py` — add `--firewall-products` and `--av-products` CLI args to `insert_health`, accept them in the method, and write them to the database.**

  Depends on item 1 (new DB columns must exist).

  **a) `insert_health` method signature** — add two optional parameters after `firewall_active`:

  ```python
  def insert_health(
      self,
      mac_address: str,
      cpu_percent: float,
      memory_percent: float,
      disk_percent: float,
      uptime_seconds: int,
      hostname: Optional[str] = None,
      ip_address: Optional[str] = None,
      firewall_active: Optional[bool] = None,
      firewall_products: Optional[list] = None,
      antivirus_products: Optional[list] = None,
  ) -> bool:
  ```

  **b) Derive booleans from product lists** — after the `endpoint_row` fetch (line that reads `stored_firewall, antivirus_active`), add:

  ```python
  if firewall_products:
      effective_firewall = any(p.get("enabled") for p in firewall_products)
  else:
      effective_firewall = firewall_active if firewall_active is not None else stored_firewall

  if antivirus_products:
      effective_antivirus = any(p.get("enabled") for p in antivirus_products)
  else:
      effective_antivirus = antivirus_active  # the stored value
  ```

  Update the `calculate_health_score(...)` call to use `effective_firewall` and `effective_antivirus`.

  **c) Update the SQL `UPDATE` statement** — replace both existing conditional branches (the `if firewall_active is not None:` / `else:` split) with a single query that always sets all security columns:

  ```python
  update_query = sql.SQL(
      """
      UPDATE dashboard_endpointstatus
      SET cpu_percent = %s, memory_percent = %s, disk_percent = %s, uptime_seconds = %s,
          firewall_active = %s, antivirus_active = %s,
          firewall_products = %s, antivirus_products = %s,
          health_score = %s, health_status = %s, last_health_check = NOW()
      WHERE mac_address = %s
      """
  )
  self.cursor.execute(update_query, (
      cpu_percent, memory_percent, disk_percent, uptime_seconds,
      effective_firewall, effective_antivirus,
      json.dumps(firewall_products or []),
      json.dumps(antivirus_products or []),
      health_score, health_status, mac_address,
  ))
  ```

  **d) argparse `insert_health` subparser** — add after the existing `--firewall` argument:

  ```python
  health_parser.add_argument("--firewall-products", default=None,
      help="JSON array of firewall product objects")
  health_parser.add_argument("--av-products", default=None,
      help="JSON array of AV product objects")
  ```

  **e) CLI dispatch** — in the `elif args.command == "insert_health":` block, parse both new args before calling `insert_health`:

  ```python
  fw_products = None
  if getattr(args, "firewall_products", None):
      try:
          fw_products = json.loads(args.firewall_products)
      except (json.JSONDecodeError, ValueError):
          fw_products = []

  av_products = None
  if getattr(args, "av_products", None):
      try:
          av_products = json.loads(args.av_products)
      except (json.JSONDecodeError, ValueError):
          av_products = []

  # Remove fw (old --firewall bool) derivation; pass new args instead:
  success = agent.insert_health(
      mac_address=args.mac,
      cpu_percent=args.cpu,
      memory_percent=args.mem,
      disk_percent=args.disk,
      uptime_seconds=args.uptime,
      hostname=args.hostname,
      ip_address=args.ip,
      firewall_products=fw_products,
      antivirus_products=av_products,
  )
  ```

  Remove the old `fw = None; if hasattr(args, 'firewall') ...` block; `--firewall` arg is no longer added in step 6 and can be dropped from the parser too.

  **Files:** `Backend/Installer/Windows/supabase_agent.py`

  **Verify:** `python supabase_agent.py insert_health --mac "AA:BB:CC:DD:EE:FF" --cpu 10 --mem 20 --disk 30 --uptime 3600 --firewall-products '[{"name":"Windows Defender Firewall","enabled":true,"up_to_date":true}]' --av-products '[{"name":"Windows Defender","enabled":true,"up_to_date":true}]'` — exits 0 and the DB row has the JSON columns populated.

---

- [ ] 8. **`Backend/heartbeat/linux/heartbeat.sh` — add firewall and AV product detection, include both arrays in the heartbeat JSON payload.**

  Depends on nothing (independent). Insert a new detection block just before the `# Build heartbeat JSON safely` section (around line 65 of the active code). Insert this bash section:

  ```bash
  # =============================================================================
  # Detect firewall products
  # =============================================================================

  FW_PRODUCTS="[]"
  FW_ACTIVE="false"
  _fw_entries=""

  # ufw
  if command -v ufw >/dev/null 2>&1; then
      _status=$(ufw status 2>/dev/null | head -1)
      _enabled="false"; [[ "$_status" == *"active"* ]] && _enabled="true"
      [[ "$_enabled" == "true" ]] && FW_ACTIVE="true"
      _fw_entries="${_fw_entries}{\"name\":\"ufw\",\"enabled\":${_enabled},\"up_to_date\":true},"
  fi
  # firewalld
  if command -v firewall-cmd >/dev/null 2>&1; then
      _enabled="false"
      systemctl is-active --quiet firewalld 2>/dev/null && _enabled="true"
      [[ "$_enabled" == "true" ]] && FW_ACTIVE="true"
      _fw_entries="${_fw_entries}{\"name\":\"firewalld\",\"enabled\":${_enabled},\"up_to_date\":true},"
  fi
  # nftables
  if command -v nft >/dev/null 2>&1; then
      _enabled="false"
      systemctl is-active --quiet nftables 2>/dev/null && _enabled="true"
      [[ "$_enabled" == "true" ]] && FW_ACTIVE="true"
      _fw_entries="${_fw_entries}{\"name\":\"nftables\",\"enabled\":${_enabled},\"up_to_date\":true},"
  fi
  # iptables (only if none of the above detected it active)
  if command -v iptables >/dev/null 2>&1 && [ -z "$_fw_entries" ]; then
      _rules=$(iptables -n --list 2>/dev/null | grep -c "^[A-Z]" || echo 0)
      _enabled="false"; [ "$_rules" -gt 3 ] && _enabled="true"
      [[ "$_enabled" == "true" ]] && FW_ACTIVE="true"
      _fw_entries="${_fw_entries}{\"name\":\"iptables\",\"enabled\":${_enabled},\"up_to_date\":true},"
  fi
  # Build JSON array (strip trailing comma)
  if [ -n "$_fw_entries" ]; then
      FW_PRODUCTS="[${_fw_entries%,}]"
  fi

  # =============================================================================
  # Detect AV products
  # =============================================================================

  AV_PRODUCTS="[]"
  AV_ACTIVE="false"
  _av_entries=""

  # ClamAV
  if command -v clamscan >/dev/null 2>&1 || command -v clamdscan >/dev/null 2>&1; then
      _enabled="false"
      systemctl is-active --quiet clamav-daemon 2>/dev/null && _enabled="true"
      _version=$(clamscan --version 2>/dev/null | head -1 || echo "")
      [[ "$_enabled" == "true" ]] && AV_ACTIVE="true"
      _av_entries="${_av_entries}{\"name\":\"ClamAV\",\"enabled\":${_enabled},\"up_to_date\":true},"
  fi
  # Sophos
  if [ -f /opt/sophos-av/bin/savdstatus ] || command -v savscan >/dev/null 2>&1; then
      _enabled="false"
      /opt/sophos-av/bin/savdstatus 2>/dev/null | grep -q "running" && _enabled="true"
      [[ "$_enabled" == "true" ]] && AV_ACTIVE="true"
      _av_entries="${_av_entries}{\"name\":\"Sophos AV\",\"enabled\":${_enabled},\"up_to_date\":true},"
  fi
  # Bitdefender
  if command -v bdscan >/dev/null 2>&1 || [ -d /opt/bitdefender-security-tools ]; then
      _enabled="false"
      systemctl is-active --quiet bd-product-security-tools 2>/dev/null && _enabled="true"
      [[ "$_enabled" == "true" ]] && AV_ACTIVE="true"
      _av_entries="${_av_entries}{\"name\":\"Bitdefender\",\"enabled\":${_enabled},\"up_to_date\":true},"
  fi
  # ESET
  if command -v /opt/eset/esets/sbin/esets_daemon >/dev/null 2>&1 || [ -d /opt/eset ]; then
      _enabled="false"
      systemctl is-active --quiet esets 2>/dev/null && _enabled="true"
      [[ "$_enabled" == "true" ]] && AV_ACTIVE="true"
      _av_entries="${_av_entries}{\"name\":\"ESET\",\"enabled\":${_enabled},\"up_to_date\":true},"
  fi
  if [ -n "$_av_entries" ]; then
      AV_PRODUCTS="[${_av_entries%,}]"
  fi
  ```

  Then update the Python heredoc that builds `JSON` to pass the two new variables and include them in the payload dict:

  Change the `python3 -` invocation to pass `"$FW_PRODUCTS" "$AV_PRODUCTS"` as additional positional args, update the Python `sys.argv` destructuring, and add:

  ```python
  import json as _json
  try:
      data["firewall_products"] = _json.loads(fw_products_raw)
      data["antivirus_products"] = _json.loads(av_products_raw)
  except Exception:
      data["firewall_products"] = []
      data["antivirus_products"] = []
  data["firewall_active"] = fw_active == "true"
  data["antivirus_active"] = av_active == "true"
  ```

  The heartbeat endpoint (`POST /api/heartbeat/`) does not currently read `firewall_products` from the payload — that is handled in item 10. The heartbeat.sh payload simply needs to carry the data so the server can store it.

  **Files:** `Backend/heartbeat/linux/heartbeat.sh`

  **Verify:** Run `bash -n Backend/heartbeat/linux/heartbeat.sh` — no syntax errors. On a Linux VM, run the script manually and verify the sent JSON contains `firewall_products` and `antivirus_products` keys.

---

- [ ] 9. **`Backend/heartbeat/windows/heartbeat.ps1` — add WSC-based firewall and AV detection, include product arrays in the heartbeat JSON payload.**

  Depends on nothing (independent). Insert a new detection block after the `# ── Detect virtualisation` block and before the `# ── Build heartbeat payload` section. Use the same WSC CIM logic from item 6:

  ```powershell
  # ── Detect firewall products (WSC) ─────────────────────────────────────
  $FwProducts = @()
  $FirewallActive = $false
  try {
      $WscFWs = Get-CimInstance -Namespace "root\SecurityCenter2" -ClassName "FirewallProduct" -ErrorAction Stop
      foreach ($fw in $WscFWs) {
          $state   = [int]$fw.productState
          $enabled = (($state -shr 16) -band 0xFF) -eq 0x11
          $upToDate = (($state -shr  8) -band 0xFF) -ne 0x10
          $FwProducts += @{ name = $fw.displayName; enabled = $enabled; up_to_date = $upToDate }
          if ($enabled) { $FirewallActive = $true }
      }
  } catch { }
  if ($FwProducts.Count -eq 0) {
      try {
          $profiles = Get-NetFirewallProfile -ErrorAction Stop
          $allEnabled = -not ($profiles | Where-Object { -not $_.Enabled })
          $FwProducts += @{ name = "Windows Defender Firewall"; enabled = $allEnabled; up_to_date = $true }
          if ($allEnabled) { $FirewallActive = $true }
      } catch { }
  }

  # ── Detect AV products (WSC) ───────────────────────────────────────────
  $AvProducts = @()
  $AntivirusActive = $false
  try {
      $WscAVs = Get-CimInstance -Namespace "root\SecurityCenter2" -ClassName "AntiVirusProduct" -ErrorAction Stop
      foreach ($av in $WscAVs) {
          $state    = [int]$av.productState
          $enabled  = (($state -shr 16) -band 0xFF) -eq 0x11
          $upToDate = (($state -shr  8) -band 0xFF) -ne 0x10
          $AvProducts += @{ name = $av.displayName; enabled = $enabled; up_to_date = $upToDate }
          if ($enabled) { $AntivirusActive = $true }
      }
  } catch { }
  if ($AvProducts.Count -eq 0) {
      try {
          $mp = Get-MpComputerStatus -ErrorAction Stop
          $enabled  = $mp.AntivirusEnabled
          $upToDate = $mp.AntivirusSignatureAge -le 7
          $AvProducts += @{ name = "Windows Defender"; enabled = $enabled; up_to_date = $upToDate }
          if ($enabled) { $AntivirusActive = $true }
      } catch { }
  }
  ```

  Then in the `$HeartbeatBody = @{...}` block, add two more entries:

  ```powershell
  firewall_active   = $FirewallActive
  antivirus_active  = $AntivirusActive
  firewall_products = $FwProducts
  antivirus_products = $AvProducts
  ```

  `ConvertTo-Json -Compress` serializes nested hashtable arrays correctly. If `$FwProducts` has only one entry, PowerShell's `ConvertTo-Json` by default unwraps single-item arrays; pass `-Depth 3` to avoid object-flattening:

  ```powershell
  $HeartbeatJson = $HeartbeatBody | ConvertTo-Json -Compress -Depth 3
  ```

  **Files:** `Backend/heartbeat/windows/heartbeat.ps1`

  **Verify:** In a test PowerShell session, run the script with `$ApiKey` set to a dummy and `$Server` pointed at a local netcat listener. Confirm the JSON body contains `firewall_products` as an array.

---

## Stage D — Frontend

- [ ] 10. **`views.py` — `heartbeat()` view: accept `firewall_products` and `antivirus_products` from POST body and store them on the `EndpointStatus` row.**

  Depends on item 1 (new DB columns). In the `heartbeat()` function (starting around line 65 of views.py), the `defaults` dict is built and passed to `EndpointStatus.objects.update_or_create(...)`. After the existing `if "wol_enabled" in data ...` block (~line 148), add:

  ```python
  if "firewall_products" in data:
      fw_products = data.get("firewall_products") or []
      defaults["firewall_products"] = fw_products
      if fw_products:
          defaults["firewall_active"] = any(p.get("enabled") for p in fw_products)
      elif "firewall_active" in data:
          defaults["firewall_active"] = data["firewall_active"]

  if "antivirus_products" in data:
      av_products = data.get("antivirus_products") or []
      defaults["antivirus_products"] = av_products
      if av_products:
          defaults["antivirus_active"] = any(p.get("enabled") for p in av_products)
      elif "antivirus_active" in data:
          defaults["antivirus_active"] = data["antivirus_active"]
  ```

  When `firewall_products`/`antivirus_products` are absent from the request (older heartbeat agents that only send `firewall_active`/`antivirus_active` booleans), the existing behavior is unchanged because neither new key is present in `defaults`.

  **Files:** `Backend/dashboard/views.py`

  **Verify:** `python manage.py test dashboard.tests` — no regressions. POST to `/api/heartbeat/` with `"firewall_products": [{"name":"ufw","enabled":true,"up_to_date":true}]` and verify the DB row has the JSON column populated and `firewall_active = true`.

---

- [ ] 11. **`frontend/src/frontend/src/lib/types.ts` — add `SecurityProduct` interface and product list fields to `EndpointStatus`.**

  Add a new interface before `EndpointStatus`:

  ```typescript
  export interface SecurityProduct {
    name: string;
    enabled: boolean;
    up_to_date: boolean;
  }
  ```

  Then inside the `EndpointStatus` interface, after `antivirus_active: boolean;`, add:

  ```typescript
  firewall_products: SecurityProduct[];
  antivirus_products: SecurityProduct[];
  ```

  **Files:** `frontend/src/frontend/src/lib/types.ts`

  **Verify:** `cd frontend/src/frontend && npm run build` (or `npm run type-check` / `tsc --noEmit`) — no TypeScript errors.

---

- [ ] 12. **`frontend/src/frontend/src/lib/endpoints.ts` — map `firewall_products` and `antivirus_products` from API response.**

  Depends on item 11. In the `fetchEndpoints()` function, inside the `.map((ep: any) => ({...}))` block, after `antivirus_active: ep.antivirus_active ?? false,`, add:

  ```typescript
  firewall_products: (ep.firewall_products ?? []) as import("./types").SecurityProduct[],
  antivirus_products: (ep.antivirus_products ?? []) as import("./types").SecurityProduct[],
  ```

  **Files:** `frontend/src/frontend/src/lib/endpoints.ts`

  **Verify:** `cd frontend/src/frontend && npm run build` — no TypeScript errors.

---

- [ ] 13. **`EndpointDetailPage.tsx` — replace simple boolean Firewall/Antivirus display with named product Badge chips; fall back to boolean `StatusBadge` when product list is empty.**

  Depends on items 11 and 12. This change affects only the Security Controls section of the page. The strategy: keep `ControlToggle` for all controls except `firewall` and `antivirus`; render those two specially when product lists are non-empty.

  **a)** Add a new component `ProductList` near the top of the file (after `ControlToggle`):

  ```tsx
  function ProductList({
    label,
    description,
    products,
    fallbackEnabled,
  }: {
    label: string;
    description: string;
    products: import("@/lib/types").SecurityProduct[];
    fallbackEnabled: boolean | null;
  }) {
    if (products.length === 0) {
      // No product data — fall back to boolean display
      return (
        <ControlToggle
          label={label}
          description={description}
          enabled={fallbackEnabled}
          applicable={true}
        />
      );
    }
    return (
      <div className="rounded-lg border border-border bg-background/60 p-3">
        <div className="mb-2">
          <p className="text-sm font-medium text-foreground">{label}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {products.map((p) => (
            <Badge
              key={p.name}
              className={
                p.enabled
                  ? "bg-success/15 text-success"
                  : "bg-destructive/15 text-destructive"
              }
              title={p.up_to_date ? "Definitions up to date" : "Definitions out of date"}
            >
              {p.name}
              {!p.up_to_date && (
                <span className="ml-1 opacity-60" aria-label="out of date">⚠</span>
              )}
            </Badge>
          ))}
        </div>
      </div>
    );
  }
  ```

  **b)** In the Security Controls `SectionCard`, replace the generic `CONTROL_DEFS.filter(...).map(...)` block so that `firewall` and `antivirus` entries use `ProductList` and all others continue to use `ControlToggle`:

  ```tsx
  <div className="grid gap-3 sm:grid-cols-2">
    {CONTROL_DEFS.filter(
      (c) => !c.applicableOs || c.applicableOs.includes(endpoint.os),
    ).map((c) => {
      if (c.key === "firewall") {
        return (
          <ProductList
            key="firewall"
            label={c.label}
            description={c.description}
            products={endpoint.firewall_products}
            fallbackEnabled={audit.security.firewall}
          />
        );
      }
      if (c.key === "antivirus") {
        return (
          <ProductList
            key="antivirus"
            label={c.label}
            description={c.description}
            products={endpoint.antivirus_products}
            fallbackEnabled={audit.security.antivirus}
          />
        );
      }
      return (
        <ControlToggle
          key={c.key}
          label={c.label}
          description={c.description}
          enabled={audit.security[c.key]}
          applicable={!c.applicableOs || c.applicableOs.includes(endpoint.os)}
        />
      );
    })}
  </div>
  ```

  Add `import type { SecurityProduct } from "@/lib/types";` to the imports at the top of the file (or use the inline import already in the component above — choose one style).

  **Files:** `frontend/src/frontend/src/pages/EndpointDetailPage.tsx`

  **Verify:** `cd frontend/src/frontend && npm run build` — no TypeScript errors, no build errors. Load the endpoint detail page in a browser; for an endpoint that has product data, the Security Controls section shows named Badge chips; for one that does not, it falls back to the Enabled/Disabled badge.

---

## Dependency Order Summary

```
1 (models) → 2 (migration) → [3, 4, 5, 7, 10] (all read new columns)
6 (ps1 installer) → 7 (Windows supabase_agent)   [independent of 1 at collection time, but
8 (linux heartbeat.sh)                             supabase_agent needs columns in DB]
9 (windows heartbeat.ps1)
11 (types.ts) → 12 (endpoints.ts) → 13 (EndpointDetailPage.tsx)
```

Items 6, 8, 9 do not read the Django models directly — their only database dependency is the new DB columns (item 2 must be migrated before the agents write product data). Items 3–5 and 10 must be deployed before or at the same time as items 6–9 so that inbound data is not silently dropped.
