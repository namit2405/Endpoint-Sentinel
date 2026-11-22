# =============================================================================
# heartbeat-agent.ps1 - Endpoint Heartbeat Agent (Windows)
#
# Runs every 1 minute via Task Scheduler.
#
# Behavior:
#   - Sends heartbeat directly to Supabase PostgreSQL
#   - Updates EndpointStatus via MAC address
#   - Polls for commands; handles update_scripts by downloading and replacing
#     the agent scripts, then exiting so Task Scheduler fires the new version.
# =============================================================================

$ErrorActionPreference = "SilentlyContinue"
New-Item -ItemType Directory -Path "C:\ProgramData\EndpointAgent\Logs" -Force | Out-Null
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

$AgentVersion = "1.4"
$AgentDir = "C:\Program Files\EndpointAgent"
$SupabaseHelper = Join-Path $AgentDir "supabase_agent.py"
$PythonPath = '__PYTHON_PATH__'

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

$WolEnabled = $false
if ($Adapter) {
    try {
        $WolCap = Get-NetAdapterPowerManagement -Name $Adapter.Name -ErrorAction Stop
        $WolEnabled = "$($WolCap.WakeOnMagicPacket)" -match "Enabled|True|1"
    } catch { }
}

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

Write-Host "Sending heartbeat to Supabase"
Write-Host "Hostname: $HostnameVal | IP: $IpVal | MAC: $MacVal"

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
    Write-Host "* Heartbeat sent successfully"
} else {
    Write-Host "x Heartbeat failed"
    exit 1
}

# =============================================================================
# Activate device with license key
# =============================================================================

if ($env:LICENSE_KEY) {
    Write-Host "Activating device with license..."
    & $PythonPath $SupabaseHelper activate_license --license-key $env:LICENSE_KEY --mac $MacVal
    if ($LASTEXITCODE -eq 0) {
        Write-Host "* Device activated with license"
    } else {
        Write-Host "! Device activation failed"
    }
}

# =============================================================================
# Fetch and execute pending commands
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
            # ----------------------------------------------------------------
            # Self-update: download new scripts from server manifest, replace
            # the installed files, then exit so Task Scheduler fires the new version
            # ----------------------------------------------------------------
            $BaseUrl = $env:LOCAL_BASE_URL
            if (-not $BaseUrl) { $BaseUrl = "http://192.168.8.10:8000" }
            $ManifestUrl = "$BaseUrl/api/agent/manifest/"

            try {
                $Manifest = Invoke-RestMethod -Uri $ManifestUrl -Method GET `
                    -Headers @{ Authorization = "Bearer $($env:HEARTBEAT_API_KEY)" } `
                    -TimeoutSec 15 -ErrorAction Stop

                $ServerVersion = $Manifest.current_version
                $Scripts = $Manifest.scripts.windows

                $TempDir = Join-Path $env:TEMP "EndpointAgentUpdate"
                New-Item -ItemType Directory -Path $TempDir -Force | Out-Null

                $UpdateOk = $true
                $UpdateMsg = ""

                $FileMap = @{
                    "heartbeat" = @{ Url = $Scripts.heartbeat; Dest = "$AgentDir\heartbeat-agent.ps1" }
                    "health"    = @{ Url = $Scripts.health;    Dest = "$AgentDir\health-monitor-agent.ps1" }
                    "supabase"  = @{ Url = $Scripts.supabase;  Dest = "$AgentDir\supabase_agent.py" }
                }

                foreach ($Key in $FileMap.Keys) {
                    $Url  = $FileMap[$Key].Url
                    $Dest = $FileMap[$Key].Dest
                    $Tmp  = Join-Path $TempDir "$Key"
                    if ($Url) {
                        try {
                            Invoke-WebRequest -Uri $Url -OutFile $Tmp `
                                -Headers @{ Authorization = "Bearer $($env:HEARTBEAT_API_KEY)" } `
                                -TimeoutSec 30 -ErrorAction Stop
                            if ((Get-Item $Tmp).Length -gt 0) {
                                Move-Item -Path $Tmp -Destination $Dest -Force
                                Write-Host "* Updated $Key script"
                            } else {
                                $UpdateOk = $false
                                $UpdateMsg += " Empty download for $Key."
                            }
                        } catch {
                            $UpdateOk = $false
                            $UpdateMsg += " Failed to download ${Key}: $_"
                        }
                    }
                }

                Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue

                if ($UpdateOk) {
                    & $PythonPath $SupabaseHelper complete_command --id $Command.id --status success `
                        --message "Scripts updated to version $ServerVersion" 2>$null
                    Write-Host "* Scripts updated to version $ServerVersion — exiting for reload"
                    exit 0
                } else {
                    & $PythonPath $SupabaseHelper complete_command --id $Command.id --status failed `
                        --message "Partial update:$UpdateMsg" 2>$null
                }
            } catch {
                & $PythonPath $SupabaseHelper complete_command --id $Command.id --status failed `
                    --message "Manifest fetch failed: $_" 2>$null
            }

        } else {
            & $PythonPath $SupabaseHelper complete_command --id $Command.id --status failed `
                --message "Unsupported command: $($Command.command)" 2>$null
        }
    }
} catch {
    Write-Host "Command polling failed: $($_.Exception.Message)"
}

exit 0
