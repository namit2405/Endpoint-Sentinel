# Agent Version: 1.4
# Auto-generated from install_endpoint_agent.ps1 — do not edit directly
# =============================================================================
# heartbeat-agent.ps1 - Endpoint Heartbeat Agent (Windows)
#
# Runs every 1 minute via Task Scheduler.
#
# Behavior:
#   - Sends heartbeat directly to Supabase PostgreSQL
#   - Updates EndpointStatus via MAC address
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
# Send heartbeat to Supabase
# =============================================================================

Write-Host "=================================================="
Write-Host " Sending heartbeat to Supabase"
Write-Host "=================================================="
Write-Host "Hostname: $HostnameVal"
Write-Host "IP: $IpVal"
Write-Host "MAC: $MacVal"
Write-Host "Device type: $DeviceType"

if (-not (Test-Path $SupabaseHelper)) {
    Write-Host "x Supabase helper not found: $SupabaseHelper"
    exit 1
}

$PyArgs = @(
    $SupabaseHelper, "insert_heartbeat",
    "--hostname", $HostnameVal,
    "--os", $OsVal,
    "--ip", $IpVal,
    "--mac", $MacVal,
    "--username", $UsernameVal,
    "--version", $AgentVersion,
    "--device-type", $DeviceType
)
if ($WolEnabled) { $PyArgs += "--wol" }

& $PythonPath @PyArgs
if ($LASTEXITCODE -eq 0) {
    Write-Host "* Heartbeat sent to Supabase successfully"
} else {
    Write-Host "x Heartbeat failed"
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
# Fetch and execute pending power commands
# =============================================================================

try {
    $PendingCommands = & $PythonPath $SupabaseHelper poll_commands --mac $MacVal 2>$null | ConvertFrom-Json
    foreach ($Command in @($PendingCommands)) {
        if ($Command.command -eq "restart") {
            & $PythonPath $SupabaseHelper complete_command --id $Command.id --status success --message "Restart initiated" 2>$null
            Restart-Computer -Force
        } elseif ($Command.command -eq "shutdown") {
            & $PythonPath $SupabaseHelper complete_command --id $Command.id --status success --message "Shutdown initiated" 2>$null
            Stop-Computer -Force
        } elseif ($Command.command -eq "update_scripts") {
            $BaseUrl = $env:LOCAL_BASE_URL
            if (-not $BaseUrl) { $BaseUrl = "http://192.168.8.10:8000" }
            $ManifestUrl = "$BaseUrl/api/agent/manifest/"
            try {
                $Manifest = Invoke-RestMethod -Uri $ManifestUrl -Method GET `
                    -Headers @{ Authorization = "Bearer $($env:HEARTBEAT_API_KEY)" } `
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
                foreach ($Key in $FileMap.Keys) {
                    $Url2 = $FileMap[$Key].Url; $Dest2 = $FileMap[$Key].Dest
                    $Tmp2 = Join-Path $TempDir "$Key"
                    if ($Url2) {
                        try {
                            Invoke-WebRequest -Uri $Url2 -OutFile $Tmp2 `
                                -Headers @{ Authorization = "Bearer $($env:HEARTBEAT_API_KEY)" } `
                                -TimeoutSec 30 -ErrorAction Stop
                            if ((Get-Item $Tmp2 -ErrorAction SilentlyContinue).Length -gt 0) {
                                Move-Item -Path $Tmp2 -Destination $Dest2 -Force
                                Write-Host "* Updated $Key script"
                            } else { $UpdateOk = $false; $UpdateMsg += " Empty: $Key." }
                        } catch { $UpdateOk = $false; $UpdateMsg += " Fail ${Key}: " + $_.Exception.Message }
                    }
                }
                Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue
                if ($UpdateOk) {
                    & $PythonPath $SupabaseHelper complete_command --id $Command.id --status success `
                        --message "Scripts updated to version $ServerVersion" 2>$null
                    Write-Host "* Scripts updated to version $ServerVersion"
                    exit 0
                } else {
                    & $PythonPath $SupabaseHelper complete_command --id $Command.id --status failed `
                        --message ("Partial update:" + $UpdateMsg) 2>$null
                }
            } catch {
                & $PythonPath $SupabaseHelper complete_command --id $Command.id --status failed `
                    --message ("Manifest fetch failed: " + $_.Exception.Message) 2>$null
            }
        } else {
            & $PythonPath $SupabaseHelper complete_command --id $Command.id --status failed --message "Unsupported command: $($Command.command)" 2>$null
        }
    }
} catch {
    Write-Host "Power command polling failed: $($_.Exception.Message)"
}

exit 0