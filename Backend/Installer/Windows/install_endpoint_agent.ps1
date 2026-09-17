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
$AuditRunnerScript = Join-Path $AgentDir "run-audit.ps1"
$SupabaseHelper = Join-Path $AgentDir "supabase_agent.py"

$ConfigDir = "C:\ProgramData\EndpointAgent"
$ConfigFile = Join-Path $ConfigDir "endpoint-heartbeat.env"

$AgentVersion = "1.2"

# -----------------------------------------------------------------------
# AUDIT REPORT DIRECTORY
# -----------------------------------------------------------------------

$ReportDir = "$env:ProgramData\EndpointAgent\Reports\Windows"
$LogDir = "$env:ProgramData\EndpointAgent\Logs"

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
# EMBEDDED DEPLOYMENT CREDENTIALS
# ==========================================================================python -c "import psycopg2; print('psycopg2 import: OK')"

$BackendUrl = ""
$LicenseKey = ""
$CompanyName = ""
$DevicesUsed = ""
$DeviceLimit = ""

$SupabaseHost = "aws-0-ap-southeast-1.pooler.supabase.com"
$SupabasePort = "6543"
$SupabaseDb = "postgres"
$SupabaseUser = "postgres.rzydluzduppsbjvczgfc"
$SupabasePassword = "Nm@2405#kis"
$B2ApplicationKeyId = "005b92fde5a0e0c0000000001"
$B2ApplicationKey = "K0057HU2vqAx/t2RQwJIFevGes8JYjg"
$B2Bucket = "Endpoint-Dashboard"

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
        
        # Validate directly against Supabase, matching the Linux installer.
        Write-Host "Validating license key in Supabase..."
        
        try {
            & $PythonPath $SourceSupabaseHelper validate_license --license-key $LicenseKey
            if ($LASTEXITCODE -eq 0) {
                $script:LicenseKey = $LicenseKey
                
                Write-Host "* License key validated successfully"
                Write-Host ""
                return
            } else {
                Write-Host "x License validation failed"
                Write-Host ""
            }
        } catch {
            Write-Host "x License validation failed: $($_.Exception.Message)"
            Write-Host ""
        }
    }
}

# =============================================================================
# LOCATE AUDIT SCRIPT
# =============================================================================

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SourceAuditScript = Join-Path $ScriptDir "windows_audit.ps1"
$SourceSupabaseHelper = Join-Path $ScriptDir "supabase_agent.py"

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

if (-not (Test-Path $SourceSupabaseHelper)) {
    Write-Host ""
    Write-Host "ERROR: supabase_agent.py was not found."
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

    if (-not (Get-Command powershell -ErrorAction SilentlyContinue)) {
        Write-Host "ERROR: PowerShell was not found."
        exit 1
    }

    # -------------------------------------------------------------------------
    # Python bootstrap
    # -------------------------------------------------------------------------
    # Prefer an existing real Python 3.12/3.13 installation. If Python is
    # missing (or the Microsoft Store execution alias is the only "python"
    # command available), download and install Python automatically.
    # -------------------------------------------------------------------------

    function Get-ValidPythonPath {
        $Candidates = @()

        # PATH candidates (ignore the Microsoft Store execution alias).
        $PathCommands = @(Get-Command python.exe -All -ErrorAction SilentlyContinue)
        foreach ($Command in $PathCommands) {
            if ($Command.Source -and
                $Command.Source -notlike "*\Microsoft\WindowsApps\python.exe") {
                $Candidates += $Command.Source
            }
        }

        # Common per-user and machine-wide installation locations.
        $Candidates += @(
            "$env:LocalAppData\Programs\Python\Python313\python.exe",
            "$env:LocalAppData\Programs\Python\Python312\python.exe",
            "$env:ProgramFiles\Python313\python.exe",
            "$env:ProgramFiles\Python312\python.exe"
        )

        foreach ($Candidate in ($Candidates | Select-Object -Unique)) {
            if (Test-Path $Candidate) {
                $PreviousErrorActionPreference = $ErrorActionPreference
                $ErrorActionPreference = "Continue"
                & $Candidate --version *> $null
                $ExitCode = $LASTEXITCODE
                $ErrorActionPreference = $PreviousErrorActionPreference

                if ($ExitCode -eq 0) {
                    return $Candidate
                }
            }
        }

        return $null
    }

    function Install-PythonAutomatically {
        # Python 3.12 is deliberately used because the existing installer
        # requires psycopg2-binary and already documents 3.12/3.13 as supported.
        $PythonVersion = "3.12.10"
        $PythonInstallerUrl = "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-amd64.exe"
        $PythonInstaller = Join-Path $env:TEMP "python-$PythonVersion-amd64.exe"

        Write-Host ""
        Write-Host "Python 3.12 was not found."
        Write-Host "Downloading Python $PythonVersion automatically..."
        Write-Host "URL: $PythonInstallerUrl"

        try {
            $ProgressPreference = "SilentlyContinue"
            Invoke-WebRequest -Uri $PythonInstallerUrl -OutFile $PythonInstaller -UseBasicParsing
        } catch {
            Write-Host "ERROR: Failed to download Python."
            Write-Host $_.Exception.Message
            exit 1
        }

        if (-not (Test-Path $PythonInstaller)) {
            Write-Host "ERROR: Python installer was not downloaded."
            exit 1
        }

        Write-Host "Installing Python $PythonVersion silently..."

        try {
            # Install machine-wide, include pip, and do not require user input.
            $InstallArgs = "/quiet InstallAllUsers=1 PrependPath=1 Include_pip=1 Include_test=0"
            $Process = Start-Process -FilePath $PythonInstaller -ArgumentList $InstallArgs -Wait -PassThru

            if ($Process.ExitCode -ne 0) {
                Write-Host "ERROR: Python installation failed with exit code $($Process.ExitCode)."
                exit 1
            }
        } catch {
            Write-Host "ERROR: Failed to start the Python installer."
            Write-Host $_.Exception.Message
            exit 1
        } finally {
            if (Test-Path $PythonInstaller) {
                Remove-Item $PythonInstaller -Force -ErrorAction SilentlyContinue
            }
        }

        # Do not depend on the current PowerShell PATH being refreshed by the
        # installer. Locate the actual executable directly.
        $InstalledPython = Get-ValidPythonPath
        if (-not $InstalledPython) {
            $InstalledPython = "$env:ProgramFiles\Python312\python.exe"
        }

        if (-not (Test-Path $InstalledPython)) {
            Write-Host "ERROR: Python was installed but python.exe could not be located."
            exit 1
        }

        Write-Host "* Python installed successfully:"
        Write-Host "  $InstalledPython"

        return $InstalledPython
    }

    $PythonPath = Get-ValidPythonPath

    if (-not $PythonPath) {
        $PythonPath = Install-PythonAutomatically
    }

    # pip is invoked as 'python -m pip' throughout this script rather than as a
    # bare 'pip' command, since pip.exe is frequently missing from PATH on
    # Windows even when the pip module itself is present. Verify it works.
    $PreviousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    & $PythonPath -m pip --version
    $PipCheckExitCode = $LASTEXITCODE
    $ErrorActionPreference = $PreviousErrorActionPreference
    if ($PipCheckExitCode -ne 0) {
        Write-Host "pip module not available - attempting to bootstrap it..."
        $ErrorActionPreference = "Continue"
        & $PythonPath -m ensurepip --upgrade
        $EnsurePipExitCode = $LASTEXITCODE
        & $PythonPath -m pip --version
        $PipCheckExitCode = $LASTEXITCODE
        $ErrorActionPreference = $PreviousErrorActionPreference
        if ($EnsurePipExitCode -ne 0 -or $PipCheckExitCode -ne 0) {
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

    $ErrorActionPreference = "Continue"
    & $PythonPath -m pip install psycopg2-binary
    $Psycopg2ExitCode = $LASTEXITCODE
    $ErrorActionPreference = $PreviousErrorActionPreference
    if ($Psycopg2ExitCode -ne 0) {
        Write-Host "ERROR: Failed to install psycopg2-binary"
        exit 1
    }

    $ErrorActionPreference = "Continue"
    & $PythonPath -c "import psycopg2; print('psycopg2 import: OK')"
    $Psycopg2ImportExitCode = $LASTEXITCODE
    $ErrorActionPreference = $PreviousErrorActionPreference
    if ($Psycopg2ImportExitCode -ne 0) {
        Write-Host "ERROR: psycopg2-binary is installed but cannot be imported by this Python runtime."
        Write-Host "Python 3.14 is not supported reliably by all psycopg2-binary builds. Install Python 3.12 or 3.13, then run this installer again."
        exit 1
    }

    Write-Host "* psycopg2-binary installed"

    # The helper reads connection details from process environment variables.
    # Load the embedded values before direct license validation.
    [System.Environment]::SetEnvironmentVariable("SUPABASE_HOST", $SupabaseHost, "Process")
    [System.Environment]::SetEnvironmentVariable("SUPABASE_PORT", $SupabasePort, "Process")
    [System.Environment]::SetEnvironmentVariable("SUPABASE_DB", $SupabaseDb, "Process")
    [System.Environment]::SetEnvironmentVariable("SUPABASE_USER", $SupabaseUser, "Process")
    [System.Environment]::SetEnvironmentVariable("SUPABASE_PASSWORD", $SupabasePassword, "Process")

    # Prompt and validate the license only after psycopg2 and the direct
    # Supabase helper are available, matching the Linux installation order.
    Prompt-For-LicenseKey

    # =========================================================================
    # INSTALL B2 CLI
    # =========================================================================

    Write-Host ""
    Write-Host "Installing B2 CLI for audit report uploads..."

    $ErrorActionPreference = "Continue"
    & $PythonPath -m pip install b2
    $B2InstallExitCode = $LASTEXITCODE
    $ErrorActionPreference = $PreviousErrorActionPreference

    $B2Available = $false
    $B2Path = Join-Path (Split-Path $PythonPath -Parent) "Scripts\b2.exe"

    if (Test-Path $B2Path) {
        $ErrorActionPreference = "Continue"
        & $B2Path version
        $B2VersionExitCode = $LASTEXITCODE
        $ErrorActionPreference = $PreviousErrorActionPreference

        if ($B2VersionExitCode -eq 0) {
            $B2Available = $true
        }
    }

    if ($B2Available) {
        Write-Host "* B2 CLI installed"
        Write-Host "  $B2Path"
    } else {
        Write-Host "! B2 CLI not installed - audit uploads will fail"
    }

    # =========================================================================
    # CREATE CONFIGURATION
    # =========================================================================

    Write-Host "Creating agent configuration..."

    New-Item -ItemType Directory -Path $ConfigDir -Force | Out-Null
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null

    @"
# Endpoint agent configuration
# Agents connect directly to Supabase PostgreSQL (no local API needed)

REPORT_DIR=$ReportDir
HEALTH_INTERVAL=$HealthInterval
AUDIT_HOUR=$AuditHour
PYTHON_PATH=$PythonPath

# License Configuration
LICENSE_KEY=$LicenseKey
COMPANY_NAME=$CompanyName
DEVICES_USED=$DevicesUsed
DEVICE_LIMIT=$DeviceLimit
BACKEND_URL=$BackendUrl

# Supabase PostgreSQL connection (direct, no API gateway)
SUPABASE_HOST=$SupabaseHost
SUPABASE_PORT=$SupabasePort
SUPABASE_DB=$SupabaseDb
SUPABASE_USER=$SupabaseUser
SUPABASE_PASSWORD=$SupabasePassword

# B2 credentials for audit report uploads
B2_APPLICATION_KEY_ID=$B2ApplicationKeyId
B2_APPLICATION_KEY=$B2ApplicationKey
B2_BUCKET=$B2Bucket
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

    $AuditRunnerContent = @'
$ErrorActionPreference = "Continue"
$LogDir = "C:\ProgramData\EndpointAgent\Logs"
$LogFile = Join-Path $LogDir "audit.log"
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
"[$(Get-Date -Format o)] Audit runner started as $([System.Security.Principal.WindowsIdentity]::GetCurrent().Name)" | Out-File -FilePath $LogFile -Append -Encoding UTF8
try {
    & "C:\Program Files\EndpointAgent\windows_audit.ps1" *>&1 | Tee-Object -FilePath $LogFile -Append
    $ExitCode = $LASTEXITCODE
    "[$(Get-Date -Format o)] Audit script exit code: $ExitCode" | Out-File -FilePath $LogFile -Append -Encoding UTF8
    exit $ExitCode
} catch {
    "[$(Get-Date -Format o)] Audit runner error: $($_.Exception.Message)" | Out-File -FilePath $LogFile -Append -Encoding UTF8
    exit 1
}
'@
    Set-Content -Path $AuditRunnerScript -Value $AuditRunnerContent -Encoding UTF8
    Write-Host "Audit runner installed:"
    Write-Host "  $AuditRunnerScript"

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
New-Item -ItemType Directory -Path "C:\ProgramData\EndpointAgent\Logs" -Force | Out-Null
Start-Transcript -Path "C:\ProgramData\EndpointAgent\Logs\heartbeat.log" -Append | Out-Null

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
        } else {
            & $PythonPath $SupabaseHelper complete_command --id $Command.id --status failed --message "Unsupported command: $($Command.command)" 2>$null
        }
    }
} catch {
    Write-Host "Power command polling failed: $($_.Exception.Message)"
}

exit 0
'@

    $HeartbeatAgentContent = $HeartbeatAgentContent.Replace('__PYTHON_PATH__', $PythonPath)

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
New-Item -ItemType Directory -Path "C:\ProgramData\EndpointAgent\Logs" -Force | Out-Null
Start-Transcript -Path "C:\ProgramData\EndpointAgent\Logs\health.log" -Append | Out-Null

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
$PythonPath = '__PYTHON_PATH__'

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

    if (-not (Test-Path $SupabaseHelper)) {
        Log-Msg "x Supabase helper not found: $SupabaseHelper"
        return $false
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

    $HealthAgentContent = $HealthAgentContent.Replace('__PYTHON_PATH__', $PythonPath)

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
    # Task Scheduler rejects TimeSpan::MaxValue (P99999999...). Ten years is
    # within the scheduler's supported range and keeps these recurring tasks
    # effectively permanent until the installer is run again.
    $TaskRepetitionDuration = New-TimeSpan -Days 3650

    # --- Heartbeat: every 1 minute ---
    $HeartbeatAction = New-ScheduledTaskAction -Execute $PwshPath -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$AgentScript`""
    $HeartbeatTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration $TaskRepetitionDuration
    Register-ScheduledTask -TaskName $HeartbeatTaskName -Action $HeartbeatAction -Trigger $HeartbeatTrigger -Settings $CommonSettings -Principal $Principal -Force | Out-Null
    Write-Host "  * $HeartbeatTaskName (every 1 min)"

    # --- Health monitor: every 2 minutes ---
    $HealthAction = New-ScheduledTaskAction -Execute $PwshPath -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$HealthAgentScript`""
    $HealthTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Seconds $HealthInterval) -RepetitionDuration $TaskRepetitionDuration
    Register-ScheduledTask -TaskName $HealthTaskName -Action $HealthAction -Trigger $HealthTrigger -Settings $CommonSettings -Principal $Principal -Force | Out-Null
    Write-Host "  * $HealthTaskName (every $HealthInterval sec)"

    # --- Daily audit: at AuditHour ---
    $AuditAction = New-ScheduledTaskAction -Execute $PwshPath -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$AuditRunnerScript`""
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

    & $PwshPath -NoProfile -ExecutionPolicy Bypass -File $AuditRunnerScript

    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "* Initial audit completed successfully"
    } else {
        Write-Host ""
        Write-Host "x Initial audit failed with exit code $LASTEXITCODE"
    }

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
