<#
=============================================================================
 Endpoint Dashboard - Windows Endpoint Agent Installer

 Installs LOCAL-ONLY setup:

   1. Heartbeat Agent
      - Every 1 minute (via Scheduled Task)
      - Sends to Supabase directly (bypasses local Django API)

   2. Real-Time Health Monitoring
      - Every 2 minutes (via Scheduled Task)
      - Sends to Supabase directly
      - Includes MAC address as endpoint identity

   3. Daily Windows Security Audit
      - Runs daily at 08:00
      - Generates HTML + CSV audit report
      - Uploads to Filebase S3-compatible storage

 IMPORTANT:
   MAC address is the endpoint identity.
   All data linked to MAC address via EndpointStatus model.

 Run (elevated PowerShell):
   powershell -ExecutionPolicy Bypass -File install_endpoint_agent.ps1

 Expected files beside installer:
   install_endpoint_agent.ps1
   windows_audit.ps1
   supabase_agent.py
=============================================================================
#>

$ErrorActionPreference = "Stop"

# =============================================================================
# INSTALLER CONFIGURATION
# =============================================================================

$AgentDir = "C:\Program Files\EndpointAgent"
$AgentScript = Join-Path $AgentDir "heartbeat-agent.ps1"
$HealthAgentScript = Join-Path $AgentDir "health-monitor-agent.ps1"
$AuditScript = Join-Path $AgentDir "windows_audit.ps1"
$SupabaseHelper = Join-Path $AgentDir "supabase_agent.py"

$ConfigDir = "C:\ProgramData\EndpointAgent"
$ConfigFile = Join-Path $ConfigDir "endpoint-heartbeat.env"

$AgentVersion = "1.2"

# -----------------------------------------------------------------------
# AUDIT REPORT DIRECTORY
# -----------------------------------------------------------------------

$ReportDir = "$env:TEMP\AuditReports\Reports\Windows"

# -----------------------------------------------------------------------
# HEALTH MONITORING INTERVAL (seconds)
# -----------------------------------------------------------------------

$HealthInterval = 120

# -----------------------------------------------------------------------
# Daily audit time
# -----------------------------------------------------------------------

$AuditHour = "08:00"

# Scheduled Task names
$HeartbeatTaskName = "EndpointHeartbeat"
$HealthTaskName = "EndpointHealthMonitor"
$AuditTaskName = "EndpointDailyAudit"

# =============================================================================
# ADMINISTRATOR CHECK
# =============================================================================

$CurrentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $CurrentPrincipal.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)) {
    Write-Host "ERROR: Please run this installer from an elevated (Administrator) PowerShell prompt."
    Write-Host ""
    Write-Host "Example:"
    Write-Host "  Right-click PowerShell -> Run as administrator, then:"
    Write-Host "  powershell -ExecutionPolicy Bypass -File install_endpoint_agent.ps1"
    exit 1
}


# =============================================================================
# LICENSE KEY PROMPT
# =============================================================================

$BackendUrl = "http://localhost:8001"
$LicenseKey = ""
$CompanyName = ""
$DevicesUsed = ""
$DeviceLimit = ""

function Prompt-For-LicenseKey {
    Write-Host ""
    Write-Host "=================================================="
    Write-Host " License Key Configuration"
    Write-Host "=================================================="
    Write-Host ""
    
    while ($true) {
        $input = Read-Host "Enter your license key (format: XX-XXXX-XXXX-XXXX)"
        $LicenseKey = $input.Trim().ToUpper()
        
        # Validate format
        if ($LicenseKey -notmatch '^[A-Z0-9]{2}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$') {
            Write-Host "x Invalid license key format. Please use: XX-XXXX-XXXX-XXXX"
            continue
        }
        
        # Validate with backend
        Write-Host "Validating license key..."
        
        try {
            $Body = @{ license_key = $LicenseKey } | ConvertTo-Json
            $ValidationResponse = Invoke-WebRequest -Uri "$BackendUrl/api/licenses/validate/" `
                -Method POST `
                -Headers @{"Content-Type"="application/json"} `
                -Body $Body `
                -ErrorAction Stop `
                -TimeoutSec 10 | Select-Object -ExpandProperty Content | ConvertFrom-Json
            
            if ($ValidationResponse.valid -eq $true) {
                $script:CompanyName = $ValidationResponse.company_name
                $script:DevicesUsed = $ValidationResponse.devices_used
                $script:DeviceLimit = $ValidationResponse.device_limit
                $script:LicenseKey = $LicenseKey
                
                Write-Host "* License key validated successfully"
                Write-Host "  Company: $($script:CompanyName)"
                Write-Host "  Devices Active: $($script:DevicesUsed) / $($script:DeviceLimit)"
                Write-Host ""
                return
            } else {
                $ErrorMsg = if ($ValidationResponse.error) { $ValidationResponse.error } else { "Unknown error" }
                Write-Host "x License validation failed: $ErrorMsg"
                Write-Host ""
            }
        } catch {
            Write-Host "x License validation failed: $($_.Exception.Message)"
            Write-Host ""
        }
    }
}

# Prompt for license key before installation
Prompt-For-LicenseKey

# =============================================================================
# LOCATE AUDIT SCRIPT
# =============================================================================

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SourceAuditScript = Join-Path $ScriptDir "windows_audit.ps1"

if (-not (Test-Path $SourceAuditScript)) {
    Write-Host ""
    Write-Host "ERROR: windows_audit.ps1 was not found."
    Write-Host ""
    Write-Host "Place all files in the same directory:"
    Write-Host "  install_endpoint_agent.ps1"
    Write-Host "  windows_audit.ps1"
    Write-Host "  supabase_agent.py"
    Write-Host ""
    exit 1
}

# =============================================================================
# INSTALLATION
# =============================================================================

function Install-Agent {

    Write-Host ""
    Write-Host "=================================================="
    Write-Host " Endpoint Dashboard Windows Agent Installer"
    Write-Host "=================================================="
    Write-Host ""

    # =========================================================================
    # REQUIRED COMMANDS
    # =========================================================================

    Write-Host "Checking required commands..."

    $RequiredCmds = @("powershell", "python")
    foreach ($cmd in $RequiredCmds) {
        if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
            Write-Host "ERROR: Required command not found: $cmd"
            Write-Host "Install Python 3 from https://www.python.org/downloads/windows/ (check 'Add python.exe to PATH')."
            exit 1
        }
    }

    # pip is invoked as 'python -m pip' throughout this script rather than as a
    # bare 'pip' command, since pip.exe is frequently missing from PATH on
    # Windows even when the pip module itself is present. Verify it works.
    & python -m pip --version 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "pip module not available - attempting to bootstrap it..."
        & python -m ensurepip --upgrade 2>$null | Out-Null
        & python -m pip --version 2>$null | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Host "ERROR: pip is not available even after 'python -m ensurepip --upgrade'."
            Write-Host "Reinstall Python from https://www.python.org/downloads/windows/ with the 'pip' option checked."
            exit 1
        }
    }

    Write-Host "Required commands: OK"

    # =========================================================================
    # INSTALL PYTHON DEPENDENCIES
    # =========================================================================

    Write-Host ""
    Write-Host "Installing Python dependencies..."

    & python -m pip install psycopg2-binary 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Failed to install psycopg2-binary"
        exit 1
    }

    Write-Host "* psycopg2-binary installed"

    # =========================================================================
    # INSTALL B2 CLI
    # =========================================================================

    Write-Host ""
    Write-Host "Installing B2 CLI for audit report uploads..."

    & python -m pip install b2 2>$null | Out-Null

    $B2Available = $false
    if (Get-Command b2 -ErrorAction SilentlyContinue) {
        $B2Available = $true
    } else {
        & python -m b2 version 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) { $B2Available = $true }
    }

    if ($B2Available) {
        Write-Host "* B2 CLI installed"
    } else {
        Write-Host "! B2 CLI not installed - audit uploads will fail"
        Write-Host "  Install manually: python -m pip install b2"
    }

    # =========================================================================
    # CREATE CONFIGURATION
    # =========================================================================

    Write-Host "Creating agent configuration..."

    New-Item -ItemType Directory -Path $ConfigDir -Force | Out-Null

    @"
# Endpoint agent configuration
# Agents connect directly to Supabase PostgreSQL (no local API needed)

REPORT_DIR=$ReportDir
HEALTH_INTERVAL=$HealthInterval
AUDIT_HOUR=$AuditHour

# License Configuration
LICENSE_KEY=$LicenseKey
COMPANY_NAME=$CompanyName
DEVICES_USED=$DevicesUsed
DEVICE_LIMIT=$DeviceLimit
BACKEND_URL=$BackendUrl

# Supabase PostgreSQL connection (direct, no API gateway)
SUPABASE_HOST=aws-0-ap-southeast-1.pooler.supabase.com
SUPABASE_PORT=6543
SUPABASE_DB=postgres
SUPABASE_USER=postgres.rzydluzduppsbjvczgfc
SUPABASE_PASSWORD=Nm@2405#kis

# B2 credentials for audit report uploads
B2_APPLICATION_KEY_ID=005b92fde5a0e0c0000000001
B2_APPLICATION_KEY=K0057HU2vqAx/t2RQwJIFevGes8JYjg
B2_BUCKET=Endpoint-Dashboard
"@ | Out-File -FilePath $ConfigFile -Encoding UTF8

    # Restrict ACL to Administrators + SYSTEM only (closest equivalent to chmod 600)
    icacls $ConfigFile /inheritance:r | Out-Null
    icacls $ConfigFile /grant:r "SYSTEM:(F)" "BUILTIN\Administrators:(F)" | Out-Null

    Write-Host "Configuration created:"
    Write-Host "  $ConfigFile"

    # =========================================================================
    # CREATE DIRECTORIES
    # =========================================================================

    Write-Host ""
    Write-Host "Creating agent directories..."

    New-Item -ItemType Directory -Path $AgentDir -Force | Out-Null
    New-Item -ItemType Directory -Path $ReportDir -Force | Out-Null

    # =========================================================================
    # INSTALL SUPABASE HELPER
    # =========================================================================

    Write-Host ""
    Write-Host "Installing Supabase connection helper..."

    $SourceSupabaseHelper = Join-Path $ScriptDir "supabase_agent.py"

    if (-not (Test-Path $SourceSupabaseHelper)) {
        Write-Host "WARNING: supabase_agent.py not found, skipping"
    } else {
        Copy-Item $SourceSupabaseHelper $SupabaseHelper -Force
        Write-Host "Supabase helper installed:"
        Write-Host "  $SupabaseHelper"
    }

    # =========================================================================
    # INSTALL AUDIT SCRIPT
    # =========================================================================

    Write-Host ""
    Write-Host "Installing Windows security audit script..."

    Copy-Item $SourceAuditScript $AuditScript -Force

    Write-Host "Audit script installed:"
    Write-Host "  $AuditScript"

    # =========================================================================
    # INSTALL HEARTBEAT AGENT
    # =========================================================================

    Write-Host ""
    Write-Host "Installing heartbeat agent..."

    $HeartbeatAgentContent = @'
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

$AgentVersion = "1.2"
$AgentDir = "C:\Program Files\EndpointAgent"
$SupabaseHelper = Join-Path $AgentDir "supabase_agent.py"

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
        $WolEnabled = [bool]$WolCap.WakeOnMagicPacket -eq "Enabled"
    } catch { }
}

# =============================================================================
# Send heartbeat to Supabase
# =============================================================================

Write-Host "=================================================="
Write-Host " Sending heartbeat to Supabase"
Write-Host "=================================================="
Write-Host "Hostname: $HostnameVal"
Write-Host "IP: $IpVal"
Write-Host "MAC: $MacVal"

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
    "--version", $AgentVersion
)
if ($WolEnabled) { $PyArgs += "--wol" }

& python @PyArgs
if ($LASTEXITCODE -eq 0) {
    Write-Host "* Heartbeat sent to Supabase successfully"
} else {
    Write-Host "x Heartbeat failed"
    exit 1
}

# =============================================================================
# Activate device with license key
# =============================================================================

if ($env:LICENSE_KEY -and $env:BACKEND_URL) {
    Write-Host ""
    Write-Host "Activating device with license..."
    
    try {
        $Body = @{ license_key = $env:LICENSE_KEY; mac_address = $MacVal } | ConvertTo-Json
        $ActivationResponse = Invoke-WebRequest -Uri "$($env:BACKEND_URL)/api/licenses/activate-device/" `
            -Method POST `
            -Headers @{"Content-Type"="application/json"} `
            -Body $Body `
            -ErrorAction Stop `
            -TimeoutSec 10 | Select-Object -ExpandProperty Content | ConvertFrom-Json
        
        if ($ActivationResponse.success -eq $true) {
            Write-Host "* Device activated with license $($env:LICENSE_KEY)"
        } else {
            $ErrorMsg = if ($ActivationResponse.error) { $ActivationResponse.error } else { "Unknown error" }
            Write-Host "! Device activation failed: $ErrorMsg"
        }
    } catch {
        Write-Host "! Device activation failed: $($_.Exception.Message)"
    }
}

exit 0
'@

    Set-Content -Path $AgentScript -Value $HeartbeatAgentContent -Encoding UTF8

    Write-Host "Heartbeat agent installed:"
    Write-Host "  $AgentScript"

    # =========================================================================
    # INSTALL HEALTH MONITOR
    # =========================================================================

    Write-Host ""
    Write-Host "Installing real-time health monitoring agent..."

    $HealthAgentContent = @'
# =============================================================================
# health-monitor-agent.ps1 - Endpoint Dashboard Real-Time Health Monitoring
#
# Runs once per invocation - scheduled every 2 minutes via Task Scheduler
# (Windows Task Scheduler has no reliable long-running "loop with sleep"
# equivalent to a systemd service; a short-interval task is used instead).
#
# Sends health data directly to Supabase PostgreSQL
# =============================================================================

$ErrorActionPreference = "SilentlyContinue"

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

    if (-not (Test-Path $SupabaseHelper)) {
        Log-Msg "x Supabase helper not found: $SupabaseHelper"
        return $false
    }

    Log-Msg "Sending health to Supabase (CPU: ${cpuPercent}%, MEM: ${memPercent}%, DISK: ${diskPercent}%)"

    & python $SupabaseHelper insert_health `
        --mac $macValue `
        --cpu $cpuPercent `
        --mem $memPercent `
        --disk $diskPercent `
        --hostname $hostnameValue `
        --ip $ipValue 2>$null

    if ($LASTEXITCODE -eq 0) {
        Log-Msg "* Health data sent"
        return $true
    } else {
        Log-Msg "x Health data send failed"
        return $false
    }
}

Log-Msg "* Health monitoring run started"
if (-not (Collect-And-Send-Health)) {
    Log-Msg "Health collection failed"
}
Log-Msg "* Health monitoring run finished"
'@

    Set-Content -Path $HealthAgentScript -Value $HealthAgentContent -Encoding UTF8

    Write-Host "Health monitoring agent installed:"
    Write-Host "  $HealthAgentScript"

    # =========================================================================
    # SCHEDULED TASKS
    # (Windows equivalent of systemd .service + .timer pairs)
    # =========================================================================

    Write-Host ""
    Write-Host "Creating scheduled tasks..."

    $PwshPath = (Get-Command powershell).Source
    $CommonSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
    $Principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

    # --- Heartbeat: every 1 minute ---
    $HeartbeatAction = New-ScheduledTaskAction -Execute $PwshPath -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$AgentScript`""
    $HeartbeatTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration ([TimeSpan]::MaxValue)
    Register-ScheduledTask -TaskName $HeartbeatTaskName -Action $HeartbeatAction -Trigger $HeartbeatTrigger -Settings $CommonSettings -Principal $Principal -Force | Out-Null
    Write-Host "  * $HeartbeatTaskName (every 1 min)"

    # --- Health monitor: every 2 minutes ---
    $HealthAction = New-ScheduledTaskAction -Execute $PwshPath -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$HealthAgentScript`""
    $HealthTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Seconds $HealthInterval) -RepetitionDuration ([TimeSpan]::MaxValue)
    Register-ScheduledTask -TaskName $HealthTaskName -Action $HealthAction -Trigger $HealthTrigger -Settings $CommonSettings -Principal $Principal -Force | Out-Null
    Write-Host "  * $HealthTaskName (every $HealthInterval sec)"

    # --- Daily audit: at AuditHour ---
    $AuditAction = New-ScheduledTaskAction -Execute $PwshPath -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$AuditScript`""
    $AuditTrigger = New-ScheduledTaskTrigger -Daily -At $AuditHour
    Register-ScheduledTask -TaskName $AuditTaskName -Action $AuditAction -Trigger $AuditTrigger -Settings $CommonSettings -Principal $Principal -Force | Out-Null
    Write-Host "  * $AuditTaskName (daily at $AuditHour)"

    # =========================================================================
    # INITIAL RUNS
    # =========================================================================

    Write-Host ""
    Write-Host "=================================================="
    Write-Host " Running initial heartbeat test"
    Write-Host "=================================================="
    Write-Host ""
    Start-ScheduledTask -TaskName $HeartbeatTaskName
    Start-Sleep -Seconds 3

    Write-Host ""
    Write-Host "License key: $LicenseKey"
    Write-Host "Company: $CompanyName"
    Write-Host "Devices: $DevicesUsed / $DeviceLimit"
    Write-Host ""

    Write-Host ""
    Write-Host "=================================================="
    Write-Host " Running initial health monitoring test"
    Write-Host "=================================================="
    Write-Host ""
    Start-ScheduledTask -TaskName $HealthTaskName
    Start-Sleep -Seconds 3

    Write-Host ""
    Write-Host "=================================================="
    Write-Host " Running initial audit test"
    Write-Host "=================================================="
    Write-Host ""
    Start-ScheduledTask -TaskName $AuditTaskName

    # =========================================================================
    # FINAL STATUS
    # =========================================================================

    Write-Host ""
    Write-Host "=================================================="
    Write-Host " Scheduled Task Status"
    Write-Host "=================================================="
    Get-ScheduledTask -TaskName $HeartbeatTaskName, $HealthTaskName, $AuditTaskName |
        Get-ScheduledTaskInfo | Format-Table TaskName, LastRunTime, LastTaskResult, NextRunTime -AutoSize

    Write-Host ""
    Write-Host "=================================================="
    Write-Host " Installation completed"
    Write-Host "=================================================="
}

# =============================================================================
# EXECUTE INSTALLER
# =============================================================================

Install-Agent
