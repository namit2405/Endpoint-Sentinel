# =============================================================================
# health-monitor-agent.ps1 - Endpoint Dashboard Real-Time Health Monitoring
#
# Runs once per invocation - scheduled every 2 minutes via Task Scheduler.
# Sends health data directly to Supabase PostgreSQL.
# =============================================================================

$ErrorActionPreference = "SilentlyContinue"
New-Item -ItemType Directory -Path "C:\ProgramData\EndpointAgent\Logs" -Force | Out-Null
try { Stop-Transcript 2>$null } catch {}
Start-Transcript -Path "C:\ProgramData\EndpointAgent\Logs\health.log" -Force | Out-Null

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
$PythonPath = '__PYTHON_PATH__'

function Log-Msg { param([string]$Msg) Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $Msg" }

function Get-MacVal {
    $adapter = Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq "Up" } | Select-Object -First 1
    if ($adapter) { return ($adapter.MacAddress -replace '-', ':') }
    return ""
}

function Get-IpVal {
    $ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
        Select-Object -First 1 -ExpandProperty IPAddress)
    if (-not $ip) { $ip = "0.0.0.0" }
    return $ip
}

$hostnameValue = $env:COMPUTERNAME
$macValue = Get-MacVal
$ipValue = Get-IpVal

if (-not $macValue) {
    Log-Msg "x MAC address could not be determined"
    exit 1
}

$cpuPercent = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
if (-not $cpuPercent) { $cpuPercent = 0.0 }

$os = Get-CimInstance Win32_OperatingSystem
$memPercent = if ($os.TotalVisibleMemorySize) {
    [math]::Round((($os.TotalVisibleMemorySize - $os.FreePhysicalMemory) / $os.TotalVisibleMemorySize) * 100, 1)
} else { 0.0 }

$sysDrive = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$($env:SystemDrive)'"
$diskPercent = if ($sysDrive.Size) {
    [math]::Round((($sysDrive.Size - $sysDrive.FreeSpace) / $sysDrive.Size) * 100, 1)
} else { 0.0 }

$uptimeSeconds = if ($os.LastBootUpTime) {
    [math]::Floor(((Get-Date) - $os.LastBootUpTime).TotalSeconds)
} else { 0 }

if (-not (Test-Path $SupabaseHelper)) {
    Log-Msg "x Supabase helper not found: $SupabaseHelper"
    exit 1
}

Log-Msg "Sending health to Supabase (CPU: ${cpuPercent}%, MEM: ${memPercent}%, DISK: ${diskPercent}%, UPTIME: ${uptimeSeconds}s)"

& $PythonPath $SupabaseHelper insert_health `
    --mac $macValue `
    --cpu $cpuPercent `
    --mem $memPercent `
    --disk $diskPercent `
    --uptime $uptimeSeconds `
    --hostname $hostnameValue `
    --ip $ipValue 2>$null

if ($LASTEXITCODE -eq 0) {
    Log-Msg "* Health data sent"
} else {
    Log-Msg "x Health data send failed"
}

Log-Msg "* Health monitoring run finished"
