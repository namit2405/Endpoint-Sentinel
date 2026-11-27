# Agent Version: 1.4
# Auto-generated from install_endpoint_agent.ps1 — do not edit directly
# =============================================================================
# health-monitor-agent.ps1 - Endpoint Dashboard Real-Time Health Monitoring
#
# Runs once per invocation - scheduled every 2 minutes via Task Scheduler
# (Windows Task Scheduler has no reliable long-running "loop with sleep"
# equivalent to a systemd service; a short-interval task is used instead).
#
# Sends health data to Django REST API (no direct Supabase connection)
# =============================================================================

$ErrorActionPreference = "SilentlyContinue"
New-Item -ItemType Directory -Path "C:\ProgramData\EndpointAgent\Logs" -Force | Out-Null
try { Stop-Transcript 2>$null } catch {}
Start-Transcript -Path "C:\ProgramData\EndpointAgent\Logs\health.log" -Force | Out-Null

# =============================================================================
# LOAD CONFIGURATION
# =============================================================================

$ConfigFile = "C:\ProgramData\EndpointAgent\endpoint-heartbeat.env"

if (-not (Test-Path $ConfigFile)) {
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] x Configuration file not found"
    exit 1
}

Get-Content $ConfigFile | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
    $kv = $_ -split '=', 2
    if ($kv.Length -eq 2) {
        [System.Environment]::SetEnvironmentVariable($kv[0].Trim(), $kv[1].Trim().Trim('"'), "Process")
    }
}

$AgentDir = "C:\Program Files\EndpointAgent"
$SupabaseHelper = Join-Path $AgentDir "supabase_agent.py"
# Python path is loaded from config file below

function Log-Msg { param([string]$Msg) Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $Msg" }

# =============================================================================
# ENDPOINT IDENTITY
# =============================================================================

function Get-HostnameVal { return $env:COMPUTERNAME }

function Get-IpVal {
    $ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
        Select-Object -First 1 -ExpandProperty IPAddress)
    if (-not $ip) { $ip = "0.0.0.0" }
    return $ip
}

function Get-MacVal {
    $adapter = Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq "Up" } | Select-Object -First 1
    if ($adapter) { return ($adapter.MacAddress -replace '-', ':') }
    return ""
}

# =============================================================================
# HEALTH COLLECTION
# =============================================================================

function Collect-And-Send-Health {
    $hostnameValue = Get-HostnameVal
    $macValue = Get-MacVal
    $ipValue = Get-IpVal

    if (-not $macValue) {
        Log-Msg "x MAC address could not be determined"
        return $false
    }

    # CPU
    $cpuPercent = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
    if (-not $cpuPercent) { $cpuPercent = 0.0 }

    # MEMORY
    $os = Get-CimInstance Win32_OperatingSystem
    $memPercent = if ($os.TotalVisibleMemorySize) {
        [math]::Round((($os.TotalVisibleMemorySize - $os.FreePhysicalMemory) / $os.TotalVisibleMemorySize) * 100, 1)
    } else { 0.0 }

    # DISK (system drive)
    $sysDrive = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$($env:SystemDrive)'"
    $diskPercent = if ($sysDrive.Size) {
        [math]::Round((($sysDrive.Size - $sysDrive.FreeSpace) / $sysDrive.Size) * 100, 1)
    } else { 0.0 }

    # UPTIME
    $uptimeSeconds = if ($os.LastBootUpTime) {
        [math]::Floor(((Get-Date) - $os.LastBootUpTime).TotalSeconds)
    } else { 0 }

    # Collect all running processes — UI handles the app/service split
    $processCount = 0
    $topProcesses = @()
    try {
        $allProcs = Get-Process -ErrorAction SilentlyContinue
        $processCount = $allProcs.Count

        $topProcesses = $allProcs | Sort-Object CPU -Descending | Select-Object -First 100 | ForEach-Object {
            $cpuPct = 0.0
            try {
                if ($_.CPU -and $_.StartTime) {
                    $uptimeSecs = [math]::Max(1, ((Get-Date) - $_.StartTime).TotalSeconds)
                    $cpuPct = [math]::Round($_.CPU / $uptimeSecs * 100 / [System.Environment]::ProcessorCount, 1)
                }
            } catch {}
            $dispName = $_.ProcessName
            try {
                if ($_.Description -and $_.Description -ne '') { $dispName = $_.Description }
                elseif ($_.MainWindowTitle -ne '') { $dispName = $_.MainWindowTitle }
            } catch {}
            @{ name=$_.ProcessName; display_name=$dispName; pid=$_.Id; cpu_percent=$cpuPct; memory_mb=[math]::Round($_.WorkingSet64/1MB,1) }
        }
    } catch {}

    # FIREWALL — check Windows Security Center (covers FortiClient, Sophos, etc.)
    # then fall back to Windows Defender Firewall profiles.
    $firewallActive = $false
    $fwProducts = @()
    # Try WSC FirewallProduct (desktop Windows only — not available on Server)
    $wscFWAvailable = $false
    try {
        $wscFWs = Get-CimInstance -Namespace "root\SecurityCenter2" -ClassName "FirewallProduct" -ErrorAction Stop
        $wscFWAvailable = $true
        foreach ($fw in $wscFWs) {
            $state = [int]$fw.productState
            $fwEnabled = (($state -shr 16) -band 0xFF) -eq 0x11
            $fwUpToDate = (($state -shr 8) -band 0xFF) -ne 0x10
            $fwProducts += @{ name = $fw.displayName; enabled = $fwEnabled; up_to_date = $fwUpToDate }
        }
    } catch { }

    if (-not $wscFWAvailable -or $fwProducts.Count -eq 0) {
        # WSC not available (Server OS) or returned nothing — scan known endpoint security services
        $knownFW = @(
            @{pattern="SophosFirewall|swi_service"; name="Sophos Firewall"},
            @{pattern="CsFalconService"; name="CrowdStrike (network control)"},
            @{pattern="WatchGuardEndpoint"; name="WatchGuard Endpoint Firewall"},
            @{pattern="FortiESNAC|FortiClient"; name="FortiClient Firewall"}
        )
        foreach ($entry in $knownFW) {
            try {
                $svc = Get-Service -ErrorAction SilentlyContinue | Where-Object { $_.Name -match $entry.pattern -or $_.DisplayName -match $entry.pattern } | Where-Object { $_.Status -eq "Running" } | Select-Object -First 1
                if ($svc) {
                    $fwProducts += @{ name = $entry.name; enabled = $true; up_to_date = $true }
                }
            } catch { }
        }
        # If still nothing, check Windows Defender Firewall profiles
        if ($fwProducts.Count -eq 0) {
            try {
                $profiles = Get-NetFirewallProfile -ErrorAction Stop
                $allEnabled = -not ($profiles | Where-Object { -not $_.Enabled })
                if ($allEnabled) {
                    $fwProducts += @{ name = "Windows Defender Firewall"; enabled = $true; up_to_date = $true }
                }
                # If all profiles disabled, leave fwProducts empty (genuinely no host firewall)
            } catch { }
        }
    }

    $firewallActive = ($fwProducts | Where-Object { $_.enabled }) -ne $null

    # ANTIVIRUS — check Windows Security Center first, then known AV/EDR service scan
    $avProducts = @()
    $wscAVAvailable = $false
    try {
        $wscAVs = Get-CimInstance -Namespace "root\SecurityCenter2" -ClassName "AntiVirusProduct" -ErrorAction Stop
        $wscAVAvailable = $true
        foreach ($av in $wscAVs) {
            $state = [int]$av.productState
            $avEnabled = (($state -shr 16) -band 0xFF) -eq 0x11
            $avUpToDate = (($state -shr 8) -band 0xFF) -ne 0x10
            $avProducts += @{ name = $av.displayName; enabled = $avEnabled; up_to_date = $avUpToDate }
        }
    } catch { }

    if (-not $wscAVAvailable -or $avProducts.Count -eq 0) {
        # WSC not available (Server OS) or returned nothing — scan known AV/EDR services
        $knownAV = @(
            @{pattern="PandaAetherAgent|PandaAgent"; name="Panda/WatchGuard Endpoint Security"},
            @{pattern="SophosMCS|SAVService"; name="Sophos"},
            @{pattern="CsFalconService|CrowdStrike"; name="CrowdStrike Falcon"},
            @{pattern="SentinelAgent"; name="SentinelOne"},
            @{pattern="CylanceSVC"; name="Cylance"},
            @{pattern="MsMpEng|WinDefend"; name="Windows Defender Antivirus"},
            @{pattern="QHActiveDefense"; name="Quick Heal"},
            @{pattern="AvastSvc|aswbIDSAgent"; name="Avast"},
            @{pattern="AVP|KAVFS"; name="Kaspersky"},
            @{pattern="McShield|mfefire"; name="McAfee"},
            @{pattern="NortonSecurity|ccSvcHst"; name="Norton"},
            @{pattern="bdagent|bdredline"; name="Bitdefender"}
        )
        foreach ($entry in $knownAV) {
            try {
                $svc = Get-Service -ErrorAction SilentlyContinue | Where-Object { $_.Name -match $entry.pattern -or $_.DisplayName -match $entry.pattern } | Where-Object { $_.Status -eq "Running" } | Select-Object -First 1
                if ($svc) {
                    $avProducts += @{ name = $entry.name; enabled = $true; up_to_date = $true }
                }
            } catch { }
        }
        # Last resort: try Get-MpComputerStatus for Windows Defender
        if ($avProducts.Count -eq 0) {
            try {
                $mpStatus = Get-MpComputerStatus -ErrorAction Stop
                if ($mpStatus.AntivirusEnabled) {
                    $avProducts += @{ name = "Windows Defender Antivirus"; enabled = $true; up_to_date = -not $mpStatus.AntivirusSignatureOutOfDate }
                }
            } catch { }
        }
    }

    $antivirusActive = ($avProducts | Where-Object { $_.enabled }) -ne $null

    # Serialize to JSON manually to guarantee valid JSON (ConvertTo-Json can produce
    # PowerShell-style True/False booleans which are not valid JSON)
    function ConvertTo-ProductJson {
        param([array]$products)
        if ($products.Count -eq 0) { return "[]" }
        $items = $products | ForEach-Object {
            $name    = $_.name -replace '"', '\"'
            $enabled = if ($_.enabled) { "true" } else { "false" }
            $upToDate = if ($_."up_to_date") { "true" } else { "false" }
            "{`"name`":`"$name`",`"enabled`":$enabled,`"up_to_date`":$upToDate}"
        }
        return "[" + ($items -join ",") + "]"
    }

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

    $fwJson = ConvertTo-ProductJson -products $fwProducts
    $avJson = ConvertTo-ProductJson -products $avProducts
    $diskJson = ConvertTo-DiskDetailsJson -drives $diskDetails

    # Build JSON payload with all health data
    $FwProductsJson = if ($fwProducts.Count -eq 0) { '[]' } elseif ($fwProducts.Count -eq 1) { '[' + ($fwProducts[0] | ConvertTo-Json -Compress -Depth 3) + ']' } else { $fwProducts | ConvertTo-Json -Compress -Depth 3 }
    $AvProductsJson = if ($avProducts.Count -eq 0) { '[]' } elseif ($avProducts.Count -eq 1) { '[' + ($avProducts[0] | ConvertTo-Json -Compress -Depth 3) + ']' } else { $avProducts | ConvertTo-Json -Compress -Depth 3 }
    $DiskDetailsJson = if ($diskDetails.Count -eq 0) { '[]' } elseif ($diskDetails.Count -eq 1) { '[' + ($diskDetails[0] | ConvertTo-Json -Compress -Depth 3) + ']' } else { $diskDetails | ConvertTo-Json -Compress -Depth 3 }
    $ProcessDetailsJson = if ($topProcesses.Count -eq 0) { '[]' } elseif ($topProcesses.Count -eq 1) { '[' + ($topProcesses[0] | ConvertTo-Json -Compress -Depth 3) + ']' } else { $topProcesses | ConvertTo-Json -Compress -Depth 3 }

    $HealthPayload = "{`"hostname`":`"$hostnameValue`",`"mac_address`":`"$macValue`",`"os_type`":`"windows`",`"ip_address`":`"$ipValue`",`"cpu_percent`":$cpuPercent,`"memory_percent`":$memPercent,`"disk_percent`":$diskPercent,`"uptime_seconds`":$uptimeSeconds,`"firewall_active`":$(if($firewallActive){'true'}else{'false'}),`"firewall_products`":$FwProductsJson,`"antivirus_products`":$AvProductsJson,`"disk_details`":$DiskDetailsJson,`"process_count`":$processCount,`"running_apps`":$ProcessDetailsJson}"

    $ApiBase2 = $env:LOCAL_BASE_URL; if (-not $ApiBase2) { $ApiBase2 = "https://endpoint-dashboard.pntr.dev" }
    $ApiKey2 = $env:HEARTBEAT_API_KEY; if (-not $ApiKey2) { $ApiKey2 = "a3f9c2e1b8d7" }

    Log-Msg "Sending health to API (CPU: ${cpuPercent}%, MEM: ${memPercent}%, DISK: ${diskPercent}%, UPTIME: ${uptimeSeconds}s, FW: ${firewallActive}, PROCS: ${processCount})"

    try {
        Invoke-RestMethod -Uri "$ApiBase2/api/agent/health-monitoring/" -Method POST `
            -Headers @{ Authorization="Bearer $ApiKey2"; "Content-Type"="application/json" } `
            -Body $HealthPayload -TimeoutSec 20 -ErrorAction Stop | Out-Null
        Log-Msg "* Health data sent via API"
        return $true
    } catch {
        Log-Msg "x Health API failed: $($_.Exception.Message)"
        return $false
    }
}

Log-Msg "* Health monitoring run started"
if (-not (Collect-And-Send-Health)) {
    Log-Msg "Health collection failed"
}
Log-Msg "* Health monitoring run finished"