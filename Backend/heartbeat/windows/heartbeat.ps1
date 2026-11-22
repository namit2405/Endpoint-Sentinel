# =============================================================================
# heartbeat.ps1  —  Endpoint Heartbeat Agent (Windows)
# Runs every 1 minute via Task Scheduler.
# Collects host info, sends heartbeat, fetches & executes commands.
#
# Phase 2: Sends heartbeat to Django API
# Phase 3: Collects MAC address, reports WoL status, polls for commands
# =============================================================================

# ── Configuration (edit these two lines) ─────────────────────────────────────
$Server  = "${env:LOCAL_BASE_URL}/api/heartbeat/"
if (-not $env:LOCAL_BASE_URL) { $Server = "http://192.168.8.10:8000/api/heartbeat/" }
$ApiKey  = $env:HEARTBEAT_API_KEY
if (-not $ApiKey) { throw "HEARTBEAT_API_KEY is not set" }
# ─────────────────────────────────────────────────────────────────────────────

$AgentVersion = "1.1"
$CommandServer = "http://192.168.8.10:8000/api/agent/commands"

# Collect host info
$Hostname = $env:COMPUTERNAME
$Username = $env:USERNAME
$OS       = (Get-CimInstance -ClassName Win32_OperatingSystem).Caption

# Pick the first non-APIPA, non-loopback IPv4 address
$IP = (
    Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object {
        $_.IPAddress -notlike "169.254.*" -and
        $_.IPAddress -ne "127.0.0.1"      -and
        $_.InterfaceAlias -notmatch "Loopback"
    } |
    Select-Object -First 1 -ExpandProperty IPAddress
)

if (-not $IP) { $IP = "0.0.0.0" }

# ── Collect MAC address (Phase 3) ────────────────────────────────────────
$MAC = $null
try {
    $MACObj = Get-NetAdapter -Physical |
              Where-Object { $_.Status -eq 'Up' } |
              Select-Object -First 1 -ExpandProperty MacAddress
    if ($MACObj) {
        # Normalize: convert dashes to colons
        $MAC = $MACObj -replace '-', ':'
    }
} catch {
    # Silent fail — MAC is optional
}

# ── Check WoL capability (Phase 3) ───────────────────────────────────────
$WolEnabled = $false
try {
    $NIC = Get-NetAdapter -Physical | Where-Object { $_.Status -eq 'Up' } | Select-Object -First 1
    if ($NIC) {
        # Try to get WoL setting from NIC
        $WolSettings = Get-NetAdapterAdvancedProperty -Name $NIC.Name -RegistryKeyword "WakeOnMagicPacket" -ErrorAction SilentlyContinue
        if ($WolSettings -and "$($WolSettings.RegistryValue)" -match 'Enabled|True|1') {
            $WolEnabled = $true
        }
    }
} catch {
    # Silent fail — WoL_enabled is optional
}

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

# ── Detect firewall products ───────────────────────────────────────────────
$fwProductsForJson = @()
$wscFWAvailable = $false
try {
    $wscFWs = Get-CimInstance -Namespace "root\SecurityCenter2" -ClassName "FirewallProduct" -ErrorAction Stop
    $wscFWAvailable = $true
    foreach ($fw in $wscFWs) {
        $state = [int]$fw.productState
        $fwEnabled = (($state -shr 16) -band 0xFF) -eq 0x11
        $fwUpToDate = (($state -shr 8) -band 0xFF) -ne 0x10
        $fwProductsForJson += [PSCustomObject]@{ name = $fw.displayName; enabled = $fwEnabled; up_to_date = $fwUpToDate }
    }
} catch { }

if (-not $wscFWAvailable -or $fwProductsForJson.Count -eq 0) {
    $knownFW = @(
        @{pattern="SophosFirewall|swi_service"; name="Sophos Firewall"},
        @{pattern="CsFalconService"; name="CrowdStrike (network control)"},
        @{pattern="WatchGuardEndpoint"; name="WatchGuard Endpoint Firewall"},
        @{pattern="FortiESNAC|FortiClient"; name="FortiClient Firewall"}
    )
    foreach ($entry in $knownFW) {
        try {
            $svc = Get-Service -Name $entry.pattern -ErrorAction Stop
            if ($svc -and $svc.Status -eq 'Running') {
                $fwProductsForJson += [PSCustomObject]@{ name = $entry.name; enabled = $true; up_to_date = $true }
            }
        } catch { }
    }
    if ($fwProductsForJson.Count -eq 0) {
        try {
            $profiles = Get-NetFirewallProfile -ErrorAction Stop
            $allEnabled = -not ($profiles | Where-Object { -not $_.Enabled })
            if ($allEnabled) {
                $fwProductsForJson += [PSCustomObject]@{ name = "Windows Defender Firewall"; enabled = $true; up_to_date = $true }
            }
        } catch { }
    }
}

# ── Detect antivirus products ──────────────────────────────────────────────
$avProductsForJson = @()
$wscAVAvailable = $false
try {
    $wscAVs = Get-CimInstance -Namespace "root\SecurityCenter2" -ClassName "AntiVirusProduct" -ErrorAction Stop
    $wscAVAvailable = $true
    foreach ($av in $wscAVs) {
        $state = [int]$av.productState
        $avEnabled = (($state -shr 16) -band 0xFF) -eq 0x11
        $avUpToDate = (($state -shr 8) -band 0xFF) -ne 0x10
        $avProductsForJson += [PSCustomObject]@{ name = $av.displayName; enabled = $avEnabled; up_to_date = $avUpToDate }
    }
} catch { }

if (-not $wscAVAvailable -or $avProductsForJson.Count -eq 0) {
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
            $svc = Get-Service -Name $entry.pattern -ErrorAction Stop
            if ($svc -and $svc.Status -eq 'Running') {
                $avProductsForJson += [PSCustomObject]@{ name = $entry.name; enabled = $true; up_to_date = $true }
            }
        } catch { }
    }
    if ($avProductsForJson.Count -eq 0) {
        try {
            $mpStatus = Get-MpComputerStatus -ErrorAction Stop
            if ($mpStatus.AntivirusEnabled) {
                $avProductsForJson += [PSCustomObject]@{ name = "Windows Defender Antivirus"; enabled = $true; up_to_date = (-not $mpStatus.AntivirusSignatureOutOfDate) }
            }
        } catch { }
    }
}

# ── Build heartbeat payload ──────────────────────────────────────────────
$HeartbeatBody = @{
    hostname           = $Hostname
    os                 = $OS
    ip_address         = $IP
    username           = $Username
    agent_version      = $AgentVersion
    device_type        = $DeviceType
    firewall_products  = $fwProductsForJson
    antivirus_products = $avProductsForJson
}

# Phase 3: optional fields
if ($MAC) { $HeartbeatBody.mac_address = $MAC }
if ($WolEnabled) { $HeartbeatBody.wol_enabled = $WolEnabled }

$HeartbeatJson = $HeartbeatBody | ConvertTo-Json -Compress

# ── Send heartbeat ──────────────────────────────────────────────────────
try {
    Invoke-RestMethod `
        -Uri         $Server `
        -Method      POST `
        -Headers     @{ Authorization = "Bearer $ApiKey" } `
        -ContentType "application/json" `
        -Body        $HeartbeatJson `
        -TimeoutSec  10 `
        -ErrorAction Stop | Out-Null
} catch {
    $msg = "Heartbeat failed: $_"
    Write-EventLog -LogName Application -Source "EndpointAgent" `
                   -EventId 1001 -EntryType Warning -Message $msg `
                   -ErrorAction SilentlyContinue
    exit 1
}

# ── Fetch and execute pending commands (Phase 3) ───────────────────────
try {
    $CommandResponse = Invoke-RestMethod `
        -Uri     "$CommandServer/$Hostname/" `
        -Method  GET `
        -Headers @{ Authorization = "Bearer $ApiKey" } `
        -TimeoutSec 10 `
        -ErrorAction Stop

    foreach ($cmd in $CommandResponse.commands) {
        $CmdId = $cmd.id
        $CmdType = $cmd.command

        $Success = $false
        $ResultMsg = ""

        # Execute command
        switch ($CmdType) {
            "shutdown" {
                try {
                    Stop-Computer -Force -ErrorAction Stop
                    $Success = $true
                    $ResultMsg = "Shutdown initiated"
                } catch {
                    $ResultMsg = "Shutdown failed: $_"
                }
            }
            "restart" {
                try {
                    Restart-Computer -Force -ErrorAction Stop
                    $Success = $true
                    $ResultMsg = "Restart initiated"
                } catch {
                    $ResultMsg = "Restart failed: $_"
                }
            }
            "update_scripts" {
                $BaseUrl = $env:LOCAL_BASE_URL
                if (-not $BaseUrl) { $BaseUrl = "http://192.168.8.10:8000" }
                $ManifestUrl = "$BaseUrl/api/agent/manifest/"
                try {
                    $Manifest = Invoke-RestMethod -Uri $ManifestUrl -Method GET `
                        -Headers @{ Authorization = "Bearer $ApiKey" } `
                        -TimeoutSec 15 -ErrorAction Stop
                    $ServerVersion = $Manifest.current_version
                    $Scripts = $Manifest.scripts.windows
                    $AgentDir2 = "C:\Program Files\EndpointAgent"
                    $TempDir = Join-Path $env:TEMP "EndpointAgentUpdate"
                    New-Item -ItemType Directory -Path $TempDir -Force | Out-Null
                    $UpdateOk = $true; $UpdateMsg = ""
                    $FileMap = @{
                        "heartbeat" = @{ Url = $Scripts.heartbeat; Dest = "$AgentDir2\heartbeat-agent.ps1" }
                        "health"    = @{ Url = $Scripts.health;    Dest = "$AgentDir2\health-monitor-agent.ps1" }
                        "supabase"  = @{ Url = $Scripts.supabase;  Dest = "$AgentDir2\supabase_agent.py" }
                    }
                    foreach ($K in $FileMap.Keys) {
                        $U = $FileMap[$K].Url; $D = $FileMap[$K].Dest; $T = Join-Path $TempDir $K
                        if ($U) {
                            try {
                                Invoke-WebRequest -Uri $U -OutFile $T `
                                    -Headers @{ Authorization = "Bearer $ApiKey" } `
                                    -TimeoutSec 30 -ErrorAction Stop
                                if ((Get-Item $T -ErrorAction SilentlyContinue).Length -gt 0) {
                                    Move-Item -Path $T -Destination $D -Force
                                } else { $UpdateOk = $false; $UpdateMsg += " Empty: $K." }
                            } catch { $UpdateOk = $false; $UpdateMsg += " Fail $K: $_" }
                        }
                    }
                    Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue
                    if ($UpdateOk) { $Success = $true; $ResultMsg = "Scripts updated to version $ServerVersion" }
                    else { $ResultMsg = "Partial update: $UpdateMsg" }
                } catch { $ResultMsg = "Manifest fetch failed: $_" }
            }
            default {
                $ResultMsg = "Unknown command: $CmdType"
            }
        }

        # Report result
        $ResultBody = @{
            status  = if ($Success) { "success" } else { "failed" }
            message = $ResultMsg
        } | ConvertTo-Json -Compress

        try {
            Invoke-RestMethod `
                -Uri     "$CommandServer/$CmdId/result/" `
                -Method  POST `
                -Headers @{ Authorization = "Bearer $ApiKey" } `
                -ContentType "application/json" `
                -Body    $ResultBody `
                -TimeoutSec 10 `
                -ErrorAction Stop | Out-Null
        } catch {
            # Silent fail — we already attempted the command
        }
    }
} catch {
    # Silent fail — commands are optional
}

exit 0
