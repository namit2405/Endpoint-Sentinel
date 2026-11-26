# Agent Version: 1.4
# Auto-generated from install_endpoint_agent.ps1 — do not edit directly
# =============================================================================
# heartbeat-agent.ps1 - Endpoint Heartbeat Agent (Windows)
#
# Runs every 1 minute via Task Scheduler.
#
# Behavior:
#   - Sends heartbeat to Django REST API
#   - Updates EndpointStatus via MAC address
#   - License activation still uses supabase_agent.py directly
# =============================================================================

$ErrorActionPreference = "SilentlyContinue"
New-Item -ItemType Directory -Path "C:\ProgramData\EndpointAgent\Logs" -Force | Out-Null
# Use a rolling log (overwrite each run) to avoid transcript lock conflicts
# when Task Scheduler fires a new instance before the previous one finishes.
$LogFile = "C:\ProgramData\EndpointAgent\Logs\heartbeat.log"
try { Stop-Transcript 2>$null } catch {}
Start-Transcript -Path $LogFile -Force | Out-Null

# =============================================================================
# Load Configuration
# =============================================================================

$ConfigFile = "C:\ProgramData\EndpointAgent\endpoint-heartbeat.env"
if (Test-Path $ConfigFile) {
    Get-Content $ConfigFile | ForEach-Object {
        if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
        $kv = $_ -split '=', 2
        if ($kv.Length -eq 2) {
            [System.Environment]::SetEnvironmentVariable($kv[0].Trim(), $kv[1].Trim().Trim('"'), "Process")
        }
    }
}

# =============================================================================
# Configuration
# =============================================================================

$AgentVersion = "1.3"
$AgentDir = "C:\Program Files\EndpointAgent"
$SupabaseHelper = Join-Path $AgentDir "supabase_agent.py"
# Python path is loaded from config file below

# =============================================================================
# Endpoint information
# =============================================================================

$HostnameVal = $env:COMPUTERNAME
$UsernameVal = $env:USERNAME

$OSInfo = Get-CimInstance Win32_OperatingSystem
$OsVal = if ($OSInfo.Caption) { $OSInfo.Caption } else { "Windows" }

$IpVal = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
    Select-Object -First 1 -ExpandProperty IPAddress)
if (-not $IpVal) { $IpVal = "0.0.0.0" }

$Adapter = Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq "Up" } | Select-Object -First 1
$MacVal = if ($Adapter) { $Adapter.MacAddress -replace '-', ':' } else { "" }

# Wake-on-LAN status
$WolEnabled = $false
if ($Adapter) {
    try {
        $WolCap = Get-NetAdapterPowerManagement -Name $Adapter.Name -ErrorAction Stop
        $WolState = "$($WolCap.WakeOnMagicPacket)"
        $WolEnabled = $WolState -match "Enabled|True|1"
    } catch { }
}

# VM detection via WMI
$DeviceType = "physical"
try {
    $Model = (Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction Stop).Model
    if ($Model -match "Virtual|VMware|VirtualBox|KVM|Hyper-V|QEMU|innotek") {
        $DeviceType = "vm"
        $WolEnabled = $false
    }
} catch { }

# =============================================================================
# Send heartbeat to Django REST API
# =============================================================================

Write-Host "=================================================="
Write-Host " Sending heartbeat to Django API"
Write-Host "=================================================="
Write-Host "Hostname: $HostnameVal"
Write-Host "IP: $IpVal"
Write-Host "MAC: $MacVal"
Write-Host "Device type: $DeviceType"

$HeartbeatJson = (@{
    hostname      = $HostnameVal
    os            = $OsVal
    ip_address    = $IpVal
    username      = $UsernameVal
    agent_version = $AgentVersion
    device_type   = $DeviceType
    mac_address   = $MacVal
    wol_enabled   = $WolEnabled
} | ConvertTo-Json -Compress)

$ApiBase = $env:LOCAL_BASE_URL
if (-not $ApiBase) { $ApiBase = "https://endpoint-dashboard.pntr.dev" }
$ApiKey = $env:HEARTBEAT_API_KEY
if (-not $ApiKey) { $ApiKey = "a3f9c2e1b8d7" }

try {
    Invoke-RestMethod -Uri "$ApiBase/api/heartbeat/" -Method POST `
        -Headers @{ Authorization = "Bearer $ApiKey"; "Content-Type" = "application/json" } `
        -Body $HeartbeatJson -TimeoutSec 15 -ErrorAction Stop | Out-Null
    Write-Host "* Heartbeat sent to API successfully"
} catch {
    Write-Host "x Heartbeat failed: $($_.Exception.Message)"
    exit 1
}

# =============================================================================
# Activate device with license key directly in Supabase
# =============================================================================

if ($env:LICENSE_KEY) {
    Write-Host ""
    Write-Host "Activating device with license..."
    & $PythonPath $SupabaseHelper activate_license --license-key $env:LICENSE_KEY --mac $MacVal
    if ($LASTEXITCODE -eq 0) {
        Write-Host "* Device activated with license $($env:LICENSE_KEY)"
    } else {
        Write-Host "! Device activation failed"
    }
}

# =============================================================================
# Fetch and execute pending commands from Django API
# =============================================================================

try {
    $CmdResp = Invoke-RestMethod -Uri "$ApiBase/api/agent/commands/$HostnameVal/" -Method GET `
        -Headers @{ Authorization = "Bearer $ApiKey" } -TimeoutSec 10 -ErrorAction Stop
    foreach ($cmd in @($CmdResp.commands)) {
        $CmdId = $cmd.id; $CmdType = $cmd.command
        $Success = $false; $ResultMsg = ""
        switch ($CmdType) {
            "shutdown"  { try { Stop-Computer -Force; $Success=$true; $ResultMsg="Shutdown initiated" } catch { $ResultMsg=$_.Exception.Message } }
            "restart"   { try { Restart-Computer -Force; $Success=$true; $ResultMsg="Restart initiated" } catch { $ResultMsg=$_.Exception.Message } }
            "update_scripts" {
                # Download manifest and update scripts
                try {
                    $Manifest = Invoke-RestMethod -Uri "$ApiBase/api/agent/manifest/" -Headers @{ Authorization="Bearer $ApiKey" } -TimeoutSec 15 -ErrorAction Stop
                    $ServerVer = $Manifest.current_version
                    if ($ServerVer -and $ServerVer -ne $AgentVersion) {
                        $Scripts = $Manifest.scripts.windows
                        foreach ($entry in @(
                            @{url=$Scripts.heartbeat; dest="C:\Program Files\EndpointAgent\heartbeat-agent.ps1"},
                            @{url=$Scripts.health;    dest="C:\Program Files\EndpointAgent\health-monitor-agent.ps1"},
                            @{url=$Scripts.supabase;  dest="C:\Program Files\EndpointAgent\supabase_agent.py"}
                        )) {
                            $tmp = [IO.Path]::GetTempFileName()
                            Invoke-WebRequest -Uri $entry.url -Headers @{Authorization="Bearer $ApiKey"} -OutFile $tmp -UseBasicParsing
                            if ((Get-Item $tmp).Length -gt 100) { Move-Item $tmp $entry.dest -Force }
                        }
                        $Success=$true; $ResultMsg="Updated to $ServerVer"
                    } else { $Success=$true; $ResultMsg="Already current" }
                } catch { $ResultMsg=$_.Exception.Message }
            }
            default { $ResultMsg="Unknown: $CmdType" }
        }
        $Status = if ($Success) { "success" } else { "failed" }
        $ResultBody = (@{status=$Status; message=$ResultMsg} | ConvertTo-Json -Compress)
        try { Invoke-RestMethod -Uri "$ApiBase/api/agent/commands/$CmdId/result/" -Method POST -Headers @{Authorization="Bearer $ApiKey"; "Content-Type"="application/json"} -Body $ResultBody -TimeoutSec 10 | Out-Null } catch {}
    }
} catch { }

exit 0