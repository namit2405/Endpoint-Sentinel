# =============================================================================
# heartbeat.ps1  —  Endpoint Heartbeat Agent (Windows)
# Runs every 1 minute via Task Scheduler.
# Collects host info, sends heartbeat, fetches & executes commands.
#
# Phase 2: Sends heartbeat to Django API
# Phase 3: Collects MAC address, reports WoL status, polls for commands
# =============================================================================

# ── Configuration (edit these two lines) ─────────────────────────────────────
$Server  = "http://192.168.8.10:8000/api/heartbeat/"
$ApiKey  = "a3f9c2e1b8d7"
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

# ── Build heartbeat payload ──────────────────────────────────────────────
$HeartbeatBody = @{
    hostname      = $Hostname
    os            = $OS
    ip_address    = $IP
    username      = $Username
    agent_version = $AgentVersion
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
