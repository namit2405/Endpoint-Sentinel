<#
============================================================
 Windows Endpoint Security & IT Audit Script (v2)

 Recommended Run (elevated):
   powershell -ExecutionPolicy Bypass -File windows_audit.ps1

 Output:
   HTML Audit Report with a pass/fail security scorecard

 NOTE: This script intentionally keeps going on individual
 check failures (wrapped in try/catch with fallback text) -
 a missing feature (no TPM, no BitLocker, etc.) is a valid
 audit finding, not a fatal error.
============================================================
#>

$ErrorActionPreference = "SilentlyContinue"

Write-Host "=================================================="
Write-Host " WINDOWS SECURITY AUDIT STARTED"
Write-Host "=================================================="

# ============================================================
# Load Configuration from EnvironmentFile-equivalent
# ============================================================
# Linux used /etc/default/endpoint-heartbeat (a sourced shell
# EnvironmentFile). Windows equivalent: a simple KEY=VALUE file
# loaded into environment variables for this process.

$ConfigFile = "C:\ProgramData\EndpointAgent\endpoint-heartbeat.env"
if (Test-Path $ConfigFile) {
    Get-Content $ConfigFile | ForEach-Object {
        if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
        $kv = $_ -split '=', 2
        if ($kv.Length -eq 2) {
            $key = $kv[0].Trim()
            $val = $kv[1].Trim().Trim('"')
            [System.Environment]::SetEnvironmentVariable($key, $val, "Process")
        }
    }
}

# ============================================================
# Report Configuration
# ============================================================

$HostnameVal = $env:COMPUTERNAME

# Try network share first, fall back to local temp if share is down
$ReportDir = "\\AuditReports\Reports\Windows"
if (-not (Test-Path $ReportDir)) {
    try {
        New-Item -ItemType Directory -Path $ReportDir -Force -ErrorAction Stop | Out-Null
    } catch {
        Write-Host "WARNING: Network share \\AuditReports is down, using local directory"
        $ReportDir = "$env:TEMP\AuditReports\Reports\Windows"
        New-Item -ItemType Directory -Path $ReportDir -Force | Out-Null
    }
}

$ReportFile = Join-Path $ReportDir "$HostnameVal.html"
$CsvDir = Join-Path $ReportDir "${HostnameVal}_CSV"

# -------------------------------
# Cleanup: Delete only this machine's previous report
# -------------------------------
Write-Host "Cleaning previous report for $HostnameVal ..."

Remove-Item -Path $ReportFile -Force -ErrorAction SilentlyContinue
Remove-Item -Path $CsvDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $CsvDir -Force | Out-Null

# -------------------------------
# Administrator check
# -------------------------------
$CurrentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
$IsAdmin = $CurrentPrincipal.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
if (-not $IsAdmin) {
    Write-Warning "Not running as Administrator."
    Write-Warning "Several checks (BitLocker, SUID-equivalent perms, failed logins, full service list) will be incomplete."
    Write-Warning "Re-run from an elevated PowerShell prompt."
}
$IsAdminStr = if ($IsAdmin) { "Yes" } else { "No" }

# -------------------------------
# Helpers
# -------------------------------

function HtmlEscape {
    param([string]$Text)
    if ($null -eq $Text) { return "" }
    return [System.Web.HttpUtility]::HtmlEncode($Text)
}
Add-Type -AssemblyName System.Web

function SafeRun {
    param([scriptblock]$Block, [string]$Fallback = "No data found")
    try {
        $out = & $Block 2>$null | Out-String
        $out = $out.Trim()
        if ([string]::IsNullOrWhiteSpace($out)) { return $Fallback }
        return $out
    } catch {
        return $Fallback
    }
}

$Script:ScorecardRows = ""
function Add-Score {
    param([string]$Check, [string]$Result, [string]$Detail)
    $cls = switch ($Result) {
        "Pass" { "success" }
        "Fail" { "fail" }
        "Warn" { "warn" }
        "Info" { "warn" }
        default { "warn" }
    }
    $checkEsc = HtmlEscape $Check
    $detailEsc = (HtmlEscape $Detail) -replace "[\r\n]+", " " -replace "  +", " "
    $Script:ScorecardRows += "<tr><td>$checkEsc</td><td><span class=`"$cls`">$Result</span></td><td>$detailEsc</td></tr>`n"
    # Track for CSV export
    $Script:ScorecardCsvRows += ,"`"$Check`",`"$Result`",`"$($Detail -replace '"','""')`""
}
$Script:ScorecardCsvRows = @()

# ============================================================
# SYSTEM INFORMATION
# ============================================================
$OSInfo = Get-CimInstance Win32_OperatingSystem
$CSInfo = Get-CimInstance Win32_ComputerSystem
$CPUInfo = Get-CimInstance Win32_Processor | Select-Object -First 1
$BiosInfo = Get-CimInstance Win32_BIOS

$OS = if ($OSInfo.Caption) { "$($OSInfo.Caption) (Build $($OSInfo.BuildNumber))" } else { "Unknown" }
$KERNEL = $OSInfo.Version
$ARCH = $OSInfo.OSArchitecture
$UPTIME = if ($OSInfo.LastBootUpTime) {
    $ts = (Get-Date) - $OSInfo.LastBootUpTime
    "{0}d {1}h {2}m" -f $ts.Days, $ts.Hours, $ts.Minutes
} else { "Unavailable" }
$LAST_BOOT = if ($OSInfo.LastBootUpTime) { $OSInfo.LastBootUpTime.ToString("yyyy-MM-dd HH:mm:ss") } else { "Unavailable" }
$CPU = if ($CPUInfo.Name) { $CPUInfo.Name.Trim() } else { "Unavailable" }
$RAM = if ($CSInfo.TotalPhysicalMemory) { "{0:N1} GB" -f ($CSInfo.TotalPhysicalMemory / 1GB) } else { "Unavailable" }
$IPADDR = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
    Select-Object -First 1 -ExpandProperty IPAddress)
if (-not $IPADDR) { $IPADDR = "Not found" }

$DISK_USAGE = (Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object {
    $freePct = if ($_.Size) { [math]::Round((($_.Size - $_.FreeSpace) / $_.Size) * 100, 1) } else { 0 }
    "{0} {1:N1}GB total {2:N1}GB used {3:N1}GB free ({4}% used)" -f $_.DeviceID, ($_.Size/1GB), (($_.Size-$_.FreeSpace)/1GB), ($_.FreeSpace/1GB), $freePct
}) -join "`n"

# ============================================================
# PENDING WINDOWS UPDATES
# ============================================================

$PENDING_UPDATES = "Unknown (Windows Update COM interface unavailable)"
try {
    $Searcher = New-Object -ComObject Microsoft.Update.Session
    $UpdSearcher = $Searcher.CreateUpdateSearcher()
    $SearchResult = $UpdSearcher.Search("IsInstalled=0 and Type='Software'")
    $PENDING_UPDATES = $SearchResult.Updates.Count
} catch {
    $PENDING_UPDATES = "Unknown (search failed - requires network/WU service)"
}

if ($PENDING_UPDATES -match '^\d+$') {
    if ([int]$PENDING_UPDATES -eq 0) {
        Add-Score "Pending OS Updates" "Pass" "System is up to date"
    } else {
        Add-Score "Pending OS Updates" "Warn" "$PENDING_UPDATES update(s) pending"
    }
} else {
    Add-Score "Pending OS Updates" "Info" "$PENDING_UPDATES"
}

# ============================================================
# DISK ENCRYPTION (BitLocker)
# ============================================================

$BL_STATUS = "Unable to determine (requires Administrator / BitLocker module)"
try {
    $BLVols = Get-BitLockerVolume -ErrorAction Stop
    $ProtectedVols = $BLVols | Where-Object { $_.ProtectionStatus -eq "On" }
    if ($ProtectedVols) {
        $BL_STATUS = ($ProtectedVols | ForEach-Object { "$($_.MountPoint): $($_.VolumeStatus), Protection $($_.ProtectionStatus)" }) -join "`n"
        Add-Score "Disk Encryption (BitLocker)" "Pass" "$($ProtectedVols.Count) volume(s) protected"
    } else {
        $BL_STATUS = "No BitLocker-protected volumes detected"
        Add-Score "Disk Encryption (BitLocker)" "Fail" "No encrypted volumes found"
    }
} catch {
    Add-Score "Disk Encryption (BitLocker)" "Warn" "Could not query BitLocker status"
}

# ============================================================
# ANTIVIRUS / EDR
# ============================================================

$AV_STATUS = "No Antivirus/EDR Detected"
try {
    $DefenderStatus = Get-MpComputerStatus -ErrorAction Stop
    if ($DefenderStatus) {
        $AVEnabled = $DefenderStatus.AntivirusEnabled
        $RTP = $DefenderStatus.RealTimeProtectionEnabled
        $AV_STATUS = "Windows Defender - AV Enabled: $AVEnabled, Real-Time Protection: $RTP, Signature Age: $($DefenderStatus.AntivirusSignatureAge) day(s)"
    }
} catch {
    try {
        $AVProducts = Get-CimInstance -Namespace "root\SecurityCenter2" -ClassName AntiVirusProduct -ErrorAction Stop
        if ($AVProducts) {
            $AV_STATUS = ($AVProducts | ForEach-Object { $_.displayName }) -join ", "
        }
    } catch { }
}
$AVResult = if ($AV_STATUS -eq "No Antivirus/EDR Detected") { "Warn" } else { "Pass" }
Add-Score "Antivirus / EDR" $AVResult $AV_STATUS

# ============================================================
# FIREWALL STATUS
# ============================================================

$FW_PROFILES = Get-NetFirewallProfile -ErrorAction SilentlyContinue
if ($FW_PROFILES) {
    $FIREWALL_STATUS = ($FW_PROFILES | ForEach-Object { "$($_.Name): $(if($_.Enabled){'Enabled'}else{'Disabled'})" }) -join "`n"
    $AllEnabled = -not ($FW_PROFILES | Where-Object { -not $_.Enabled })
    $FIREWALL_ACTIVE = if ($AllEnabled) { "Pass" } else { "Fail" }
} else {
    $FIREWALL_STATUS = "Unable to query Windows Firewall profiles"
    $FIREWALL_ACTIVE = "Fail"
}
Add-Score "Firewall" $FIREWALL_ACTIVE "Tool: Windows Firewall (netsh advfirewall)"

# ============================================================
# NETWORK ADAPTERS & DNS
# ============================================================

$NET_ADAPTERS = SafeRun { Get-NetIPConfiguration | Format-Table InterfaceAlias, InterfaceDescription, IPv4Address, IPv4DefaultGateway -AutoSize } "Unable to determine"
$DEFAULT_GATEWAY = (Get-NetRoute -DestinationPrefix "0.0.0.0/0" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty NextHop)
if (-not $DEFAULT_GATEWAY) { $DEFAULT_GATEWAY = "Not found" }
$DNS_SERVERS = (Get-DnsClientServerAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.ServerAddresses } | Select-Object -First 1 -ExpandProperty ServerAddresses) -join " "
if (-not $DNS_SERVERS) { $DNS_SERVERS = "Not found" }

# ============================================================
# NETWORK SHARES (SMB)
# ============================================================

$SmbShares = Get-SmbShare -ErrorAction SilentlyContinue | Where-Object { $_.Name -notin @("ADMIN$","C$","IPC$") -and $_.Name -notmatch '\$$' }
$SAMBA_SHARES = if ($SmbShares) { ($SmbShares | ForEach-Object { "$($_.Name) -> $($_.Path)" }) -join "`n" } else { "No custom SMB shares configured" }
$CustomShareCount = if ($SmbShares) { $SmbShares.Count } else { 0 }
Add-Score "Non-Default Network Shares" $(if ($CustomShareCount -eq 0) { "Pass" } else { "Info" }) "$CustomShareCount share(s) found"

# ============================================================
# SMB PROTOCOL VERSION (SMBv1)
# ============================================================

try {
    $SmbConfig = Get-SmbServerConfiguration -ErrorAction Stop
    $SMB1Enabled = $SmbConfig.EnableSMB1Protocol
    $SMB_MIN_PROTOCOL = "SMB1 Enabled: $SMB1Enabled"
    if ($SMB1Enabled) {
        Add-Score "SMBv1 Disabled" "Fail" "Legacy SMBv1 protocol is enabled"
    } else {
        Add-Score "SMBv1 Disabled" "Pass" "SMBv1 disabled"
    }
} catch {
    $SMB_MIN_PROTOCOL = "Unable to determine SMB server configuration"
}

# ============================================================
# REMOTE DESKTOP (RDP) EXPOSURE
# ============================================================

$RDPKey = "HKLM:\System\CurrentControlSet\Control\Terminal Server"
$RDPDenied = (Get-ItemProperty -Path $RDPKey -Name fDenyTSConnections -ErrorAction SilentlyContinue).fDenyTSConnections
if ($RDPDenied -eq 0) {
    $REMOTE_ACCESS = "Remote Desktop (RDP) is ENABLED"
    $REMOTE_ACCESS_RISK = "Warn"
} elseif ($RDPDenied -eq 1) {
    $REMOTE_ACCESS = "Remote Desktop (RDP) is disabled"
    $REMOTE_ACCESS_RISK = "Pass"
} else {
    $REMOTE_ACCESS = "Unable to determine RDP state"
    $REMOTE_ACCESS_RISK = "Warn"
}
Add-Score "Remote Desktop Exposure" $REMOTE_ACCESS_RISK $REMOTE_ACCESS

# ============================================================
# UEFI / SECURE BOOT
# ============================================================

try {
    $SecureBootEnabled = Confirm-SecureBootUEFI -ErrorAction Stop
    $BOOT_MODE = "UEFI"
    $SECURE_BOOT = if ($SecureBootEnabled) { "enabled" } else { "disabled" }
} catch {
    $BOOT_MODE = "Legacy BIOS or unsupported"
    $SECURE_BOOT = "N/A - Legacy BIOS (UEFI required for Secure Boot) or access denied"
}

if ($SECURE_BOOT -eq "enabled") {
    Add-Score "Secure Boot" "Pass" "$SECURE_BOOT ($BOOT_MODE)"
} elseif ($BOOT_MODE -eq "Legacy BIOS or unsupported") {
    Add-Score "Secure Boot" "Info" "$SECURE_BOOT"
} else {
    Add-Score "Secure Boot" "Warn" "$SECURE_BOOT ($BOOT_MODE)"
}

# ============================================================
# TPM STATUS
# ============================================================

try {
    $TpmInfo = Get-Tpm -ErrorAction Stop
    if ($TpmInfo.TpmPresent) {
        $TPM_STATUS = "TPM Present - Ready: $($TpmInfo.TpmReady), Enabled: $($TpmInfo.TpmEnabled), Version: $($TpmInfo.ManufacturerVersion)"
        Add-Score "TPM Present" "Pass" $TPM_STATUS
    } else {
        $TPM_STATUS = "TPM Not Detected"
        Add-Score "TPM Present" "Warn" $TPM_STATUS
    }
} catch {
    $TPM_STATUS = "Unable to query TPM (Get-Tpm unavailable)"
    Add-Score "TPM Present" "Warn" $TPM_STATUS
}

# ============================================================
# PASSWORD POLICY (net accounts)
# ============================================================

$PASSWORD_POLICY = SafeRun { net accounts } "Unable to read password policy"
$MaxPwAgeLine = $PASSWORD_POLICY | Select-String "Maximum password age"
$MaxPwAgeDays = if ($MaxPwAgeLine) { ($MaxPwAgeLine -replace '\D+', ' ').Trim().Split(' ')[0] } else { $null }
if ($MaxPwAgeDays -and [int]::TryParse($MaxPwAgeDays, [ref]$null) -and [int]$MaxPwAgeDays -le 90 -and [int]$MaxPwAgeDays -ne 0) {
    Add-Score "Password Max Age" "Pass" "Maximum password age = $MaxPwAgeDays day(s)"
} else {
    Add-Score "Password Max Age" "Warn" "Maximum password age = $(if($MaxPwAgeDays){$MaxPwAgeDays}else{'not set'}) day(s)"
}

# Local Security Policy complexity export (best-effort)
$PWQUALITY_SETTINGS = "Unable to determine (requires secedit export as Administrator)"
try {
    $SecCfgPath = "$env:TEMP\secpol_export.cfg"
    secedit /export /cfg $SecCfgPath /quiet 2>$null | Out-Null
    if (Test-Path $SecCfgPath) {
        $PWQUALITY_SETTINGS = (Get-Content $SecCfgPath | Select-String "PasswordComplexity|MinimumPasswordLength|PasswordHistorySize|LockoutBadCount") -join "`n"
        if (-not $PWQUALITY_SETTINGS) { $PWQUALITY_SETTINGS = "No explicit complexity rules found (defaults apply)" }
        Remove-Item $SecCfgPath -Force -ErrorAction SilentlyContinue
    }
} catch { }

# ============================================================
# LOCAL USER ACCOUNTS - password aging
# ============================================================

$LOCAL_USERS_TABLE = "Username | Enabled | Password Required | Never Expires | Last Logon`n------------------------------------------------------------"
$NeverExpireCount = 0
try {
    $LocalUsers = Get-LocalUser -ErrorAction Stop
    foreach ($u in $LocalUsers) {
        $never = $u.PasswordExpires -eq $null
        if ($never) { $NeverExpireCount++ }
        $lastLogon = if ($u.LastLogon) { $u.LastLogon.ToString("yyyy-MM-dd") } else { "Never" }
        $LOCAL_USERS_TABLE += "`n$($u.Name) | $($u.Enabled) | $($u.PasswordRequired) | $never | $lastLogon"
    }
    if ($IsAdmin) {
        Add-Score "Passwords Never Expire" $(if ($NeverExpireCount -eq 0) { "Pass" } else { "Warn" }) "$NeverExpireCount account(s) with no password expiry"
    } else {
        Add-Score "Passwords Never Expire" "Info" "May be incomplete - run elevated for full accuracy"
    }
} catch {
    $LOCAL_USERS_TABLE += "`nUnable to enumerate local users (Get-LocalUser unavailable)"
    Add-Score "Passwords Never Expire" "Info" "Skipped - Get-LocalUser unavailable"
}

# ============================================================
# SCREEN LOCK POLICY
# ============================================================

$ScreenSaveTimeout = (Get-ItemProperty -Path "HKCU:\Control Panel\Desktop" -Name ScreenSaveTimeOut -ErrorAction SilentlyContinue).ScreenSaveTimeOut
$ScreenSaveSecure = (Get-ItemProperty -Path "HKCU:\Control Panel\Desktop" -Name ScreenSaverIsSecure -ErrorAction SilentlyContinue).ScreenSaverIsSecure
if ($ScreenSaveTimeout) {
    $SCREEN_LOCK = "Screen saver timeout: $([math]::Round($ScreenSaveTimeout/60,1)) minute(s), Password-protected: $(if($ScreenSaveSecure -eq '1'){'Yes'}else{'No/Unknown'})"
} else {
    $SCREEN_LOCK = "No screen saver timeout configured for current user (or headless/server session)"
}

# ============================================================
# LOCAL ADMIN GROUP MEMBERSHIP
# ============================================================

try {
    $AdminMembers = Get-LocalGroupMember -Group "Administrators" -ErrorAction Stop | ForEach-Object { $_.Name }
    $ADMIN_GROUP_INFO = "Administrators group: $($AdminMembers -join ', ')"
} catch {
    $ADMIN_GROUP_INFO = "Unable to enumerate Administrators group (requires elevation)"
}

# ============================================================
# SSH CONFIGURATION (OpenSSH Server, if installed)
# ============================================================

$SshService = Get-Service -Name sshd -ErrorAction SilentlyContinue
if ($SshService) {
    $SSH_SUMMARY = "OpenSSH Server (sshd) status: $($SshService.Status), StartType: $($SshService.StartType)"
} else {
    $SSH_SUMMARY = "OpenSSH Server not installed"
}

# ============================================================
# AUDIT POLICY (auditpol) - Windows equivalent of auditd
# ============================================================

$AUDITD_STATUS = SafeRun { auditpol /get /category:* } "Unable to query audit policy (requires elevation)"

# ============================================================
# OPEN PORTS
# ============================================================

$OPEN_PORTS = SafeRun {
    Get-NetTCPConnection -State Listen -ErrorAction Stop |
        Select-Object LocalAddress, LocalPort, OwningProcess |
        Sort-Object LocalPort | Format-Table -AutoSize
} "Unable to determine open ports"

# ============================================================
# RUNNING SERVICES / FAILED (AUTO, STOPPED) SERVICES
# ============================================================

$AllServices = Get-Service -ErrorAction SilentlyContinue
$RUNNING_SERVICES = if ($AllServices) {
    (($AllServices | Where-Object { $_.Status -eq "Running" } | Select-Object -First 50 | Format-Table Name, DisplayName, Status -AutoSize) | Out-String).Trim()
} else { "Unable to determine" }

$FAILED_SERVICES = if ($AllServices) {
    $Stopped = $AllServices | Where-Object { $_.Status -eq "Stopped" -and $_.StartType -eq "Automatic" }
    if ($Stopped) { ($Stopped | Format-Table Name, DisplayName, Status -AutoSize | Out-String).Trim() } else { "No auto-start services in a stopped/failed state" }
} else { "Unable to determine" }

# ============================================================
# SCHEDULED TASKS (Windows equivalent of systemd timers)
# ============================================================

$SCHEDULED_TASKS = SafeRun {
    Get-ScheduledTask | Where-Object { $_.State -ne "Disabled" } |
        Select-Object -First 50 TaskName, TaskPath, State | Format-Table -AutoSize
} "Unable to determine (Get-ScheduledTask unavailable)"

# ============================================================
# STARTUP PROGRAMS
# ============================================================

$STARTUP_ITEMS = SafeRun {
    Get-CimInstance Win32_StartupCommand | Select-Object Name, Command, Location, User | Format-Table -AutoSize
} "Unable to determine startup items"

# ============================================================
# FAILED LOGINS (Security Event Log 4625)
# ============================================================

if ($IsAdmin) {
    $FAILED_LOGINS = SafeRun {
        Get-WinEvent -FilterHashtable @{LogName='Security'; Id=4625} -MaxEvents 20 -ErrorAction Stop |
            Select-Object TimeCreated, @{N='Account';E={$_.Properties[5].Value}}, @{N='SourceIP';E={$_.Properties[19].Value}} |
            Format-Table -AutoSize
    } "No failed logins found in the last 20 Security log entries"
} else {
    $FAILED_LOGINS = "Skipped - requires Administrator to read Security event log"
}

# ============================================================
# USB DEVICES
# ============================================================

$USB_DEVICES = SafeRun { Get-PnpDevice -Class USB -Status OK | Select-Object FriendlyName, InstanceId | Format-Table -AutoSize } "No USB devices found"
$UsbStorPolicy = (Get-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Services\USBSTOR" -Name Start -ErrorAction SilentlyContinue).Start
$USB_STORAGE = switch ($UsbStorPolicy) {
    3 { "USB storage driver set to Manual/Automatic start (allowed)" }
    4 { "USB storage driver DISABLED (blocked)" }
    default { "Unable to determine USB storage policy" }
}

# ============================================================
# BROWSER EXTENSIONS (all users, best-effort)
# ============================================================

$BROWSER_DATA = SafeRun {
    Get-ChildItem "C:\Users\*\AppData\Local\Google\Chrome\User Data\Default\Extensions" -Directory -ErrorAction SilentlyContinue |
        Select-Object -First 20 -ExpandProperty FullName
} "No Chrome extension directories found"

# ============================================================
# WORLD-WRITABLE FILES/DIRS - Windows equivalent: paths granting
# "Everyone" or "Authenticated Users" Modify/FullControl outside
# user profiles (best-effort, common risky roots only)
# ============================================================

$WORLD_WRITABLE_FILES = "N/A on Windows - see 'Everyone-Writable Paths' below for the closest equivalent"
$EVERYONE_WRITABLE = SafeRun {
    $roots = @("C:\Program Files", "C:\Program Files (x86)", "C:\Windows\Temp", "C:\ProgramData")
    foreach ($root in $roots) {
        Get-ChildItem $root -Directory -ErrorAction SilentlyContinue | ForEach-Object {
            $acl = Get-Acl $_.FullName -ErrorAction SilentlyContinue
            if ($acl) {
                $risky = $acl.Access | Where-Object {
                    ($_.IdentityReference -match "Everyone|Authenticated Users") -and
                    ($_.FileSystemRights -match "Modify|FullControl|Write") -and
                    ($_.AccessControlType -eq "Allow")
                }
                if ($risky) { "$($_.FullName)" }
            }
        }
    } | Select-Object -First 20
} "None found in checked roots (Program Files, Windows\Temp, ProgramData)"

# ============================================================
# SUID/SGID EQUIVALENT - N/A on Windows (no such permission bit);
# closest analogue is unquoted service paths / weak service ACLs
# ============================================================

$UNQUOTED_SERVICE_PATHS = SafeRun {
    Get-CimInstance Win32_Service | Where-Object {
        $_.PathName -and $_.PathName -notmatch '^"' -and $_.PathName -match '\s' -and $_.PathName -notmatch '^[^\s]+\.exe$'
    } | Select-Object Name, PathName | Format-Table -AutoSize
} "None found"
if ($UNQUOTED_SERVICE_PATHS -eq "None found") {
    Add-Score "Unquoted Service Paths (priv-esc risk)" "Pass" "0 potential issue(s)"
} else {
    Add-Score "Unquoted Service Paths (priv-esc risk)" "Fail" "Potential unquoted service path(s) found"
}

# ============================================================
# LOG RETENTION
# ============================================================

$LOG_RETENTION = SafeRun {
    Get-WinEvent -ListLog Security, System, Application -ErrorAction Stop |
        Select-Object LogName, @{N='MaxSizeMB';E={[math]::Round($_.MaximumSizeInBytes/1MB,1)}}, RecordCount |
        Format-Table -AutoSize
} "Unable to determine (requires elevation)"

# ============================================================
# HTML REPORT GENERATION
# ============================================================

$H = @{
    Hostname = HtmlEscape $HostnameVal
    OS = HtmlEscape $OS
    Kernel = HtmlEscape $KERNEL
    Arch = HtmlEscape $ARCH
    Cpu = HtmlEscape $CPU
    Ram = HtmlEscape $RAM
    Ip = HtmlEscape $IPADDR
    Uptime = HtmlEscape $UPTIME
    LastBoot = HtmlEscape $LAST_BOOT
    BootMode = HtmlEscape $BOOT_MODE
    DiskUsage = HtmlEscape $DISK_USAGE
    Bitlocker = HtmlEscape $BL_STATUS
    Av = HtmlEscape $AV_STATUS
    PendingUpdates = HtmlEscape "$PENDING_UPDATES"
    Firewall = HtmlEscape $FIREWALL_STATUS
    SecureBoot = HtmlEscape $SECURE_BOOT
    Tpm = HtmlEscape $TPM_STATUS
    NetAdapters = HtmlEscape $NET_ADAPTERS
    Gateway = HtmlEscape $DEFAULT_GATEWAY
    Dns = HtmlEscape $DNS_SERVERS
    Shares = HtmlEscape $SAMBA_SHARES
    Smb1 = HtmlEscape $SMB_MIN_PROTOCOL
    Remote = HtmlEscape $REMOTE_ACCESS
    UsersTable = HtmlEscape $LOCAL_USERS_TABLE
    Tasks = HtmlEscape $SCHEDULED_TASKS
    Startup = HtmlEscape $STARTUP_ITEMS
    PwPolicy = HtmlEscape $PASSWORD_POLICY
    PwQuality = HtmlEscape $PWQUALITY_SETTINGS
    ScreenLock = HtmlEscape $SCREEN_LOCK
    AdminGroup = HtmlEscape $ADMIN_GROUP_INFO
    Ssh = HtmlEscape $SSH_SUMMARY
    Auditd = HtmlEscape $AUDITD_STATUS
    Ports = HtmlEscape $OPEN_PORTS
    RunningSvc = HtmlEscape $RUNNING_SERVICES
    FailedSvc = HtmlEscape $FAILED_SERVICES
    FailedLogins = HtmlEscape $FAILED_LOGINS
    Usb = HtmlEscape $USB_DEVICES
    UsbStorage = HtmlEscape $USB_STORAGE
    Browser = HtmlEscape $BROWSER_DATA
    Everyone = HtmlEscape $EVERYONE_WRITABLE
    UnquotedSvc = HtmlEscape $UNQUOTED_SERVICE_PATHS
    LogRetention = HtmlEscape $LOG_RETENTION
}

$Html = @"
<html>
<head>
<title>Windows Security Audit Report</title>
<style>
body {font-family: Arial, sans-serif; margin: 20px; background: #f4f6f9;}
h1 {color: #1f4e79; border-bottom: 3px solid #1f4e79; padding-bottom: 10px;}
h2 {color: #2f5597; border-bottom: 2px solid #2f5597; margin-top: 35px;}
pre {background: white; padding: 10px; border: 1px solid #ddd; overflow-x: auto; white-space: pre-wrap; word-wrap: break-word;}
table {width:100%; border-collapse: collapse; background:white; margin-bottom: 20px; box-shadow: 0px 2px 6px rgba(0,0,0,0.15);}
th,td {padding:8px; border:1px solid #ddd; text-align: left;}
th {background:#2f75b5; color:white;}
tr:nth-child(even) {background-color: #f9f9f9;}
.success { color: green; font-weight: bold; }
.fail { color: red; font-weight: bold; }
.warn { color: #b8860b; font-weight: bold; }
</style>
</head>
<body>

<h1>Windows Security Audit Report</h1>
<p><b>Generated:</b> $(Get-Date) &nbsp; | &nbsp; <b>Host:</b> $($H.Hostname) &nbsp; | &nbsp; <b>Run as Administrator:</b> $IsAdminStr</p>

<h2>Security Scorecard</h2>
<table>
<tr><th>Security Check</th><th>Result</th><th>Detail</th></tr>
$Script:ScorecardRows
</table>

<h2>System Information</h2>
<table>
<tr><th>Parameter</th><th>Value</th></tr>
<tr><td>Hostname</td><td>$($H.Hostname)</td></tr>
<tr><td>OS</td><td>$($H.OS)</td></tr>
<tr><td>Version</td><td>$($H.Kernel)</td></tr>
<tr><td>Architecture</td><td>$($H.Arch)</td></tr>
<tr><td>Boot Mode</td><td>$($H.BootMode)</td></tr>
<tr><td>CPU</td><td>$($H.Cpu)</td></tr>
<tr><td>RAM</td><td>$($H.Ram)</td></tr>
<tr><td>IP Address</td><td>$($H.Ip)</td></tr>
<tr><td>Uptime</td><td>$($H.Uptime)</td></tr>
<tr><td>Last Boot</td><td>$($H.LastBoot)</td></tr>
</table>

<h2>Disk Usage</h2>
<pre>$($H.DiskUsage)</pre>

<h2>Security Controls</h2>
<pre>
Disk Encryption (BitLocker):
$($H.Bitlocker)

Antivirus / EDR:
$($H.Av)

Pending Updates:
$($H.PendingUpdates)

Firewall:
$($H.Firewall)

Secure Boot / Boot Mode:
$($H.SecureBoot)

TPM:
$($H.Tpm)

Password Policy (net accounts):
$($H.PwPolicy)

Password Complexity (Local Security Policy):
$($H.PwQuality)

Screen Lock:
$($H.ScreenLock)

Admin Group Membership:
$($H.AdminGroup)

SSH Configuration:
$($H.Ssh)

Audit Policy (auditpol):
$($H.Auditd)
</pre>

<h2>Network - Open Ports</h2>
<pre>$($H.Ports)</pre>

<h2>Network Adapters & DNS</h2>
<pre>
$($H.NetAdapters)

Default Gateway: $($H.Gateway)
DNS Servers: $($H.Dns)
</pre>

<h2>Network Shares (SMB)</h2>
<pre>
SMB shares:
$($H.Shares)

SMBv1 status:
$($H.Smb1)
</pre>

<h2>Remote Desktop Exposure</h2>
<pre>$($H.Remote)</pre>

<h2>Local User Accounts & Password Aging</h2>
<pre>$($H.UsersTable)</pre>

<h2>Running Services (first 50)</h2>
<pre>$($H.RunningSvc)</pre>

<h2>Scheduled Tasks (enabled)</h2>
<pre>$($H.Tasks)</pre>

<h2>Startup Programs</h2>
<pre>$($H.Startup)</pre>

<h2>Failed / Stopped Auto-Start Services</h2>
<pre>$($H.FailedSvc)</pre>

<h2>Failed Logins (last 20, Security Event 4625)</h2>
<pre>$($H.FailedLogins)</pre>

<h2>USB Devices</h2>
<pre>$($H.Usb)</pre>

<h2>USB Storage Policy</h2>
<pre>$($H.UsbStorage)</pre>

<h2>Browser Extensions (all users, Chrome)</h2>
<pre>$($H.Browser)</pre>

<h2>Everyone-Writable Paths (common risky roots, first 20)</h2>
<pre>$($H.Everyone)</pre>

<h2>Unquoted Service Paths (privilege escalation risk)</h2>
<pre>$($H.UnquotedSvc)</pre>

<h2>Log Retention (Security / System / Application)</h2>
<pre>$($H.LogRetention)</pre>

</body>
</html>
"@

$Html | Out-File -FilePath $ReportFile -Encoding UTF8

Write-Host ""
Write-Host "=================================================="
Write-Host " SECURITY AUDIT COMPLETED"
Write-Host "=================================================="
Write-Host ""
Write-Host "Hostname    : $HostnameVal"
Write-Host "HTML Report : $ReportFile"
Write-Host "CSV Folder  : $CsvDir"
Write-Host ""

# ============================================================
# CSV EXPORTS (mirrors the Linux script's CSV export feature)
# ============================================================

@("Check,Result,Detail") + $Script:ScorecardCsvRows | Out-File -FilePath (Join-Path $CsvDir "scorecard.csv") -Encoding UTF8

$RUNNING_SERVICES | Out-File -FilePath (Join-Path $CsvDir "running_services.txt") -Encoding UTF8
$OPEN_PORTS | Out-File -FilePath (Join-Path $CsvDir "open_ports.txt") -Encoding UTF8
$SCHEDULED_TASKS | Out-File -FilePath (Join-Path $CsvDir "scheduled_tasks.txt") -Encoding UTF8
$LOCAL_USERS_TABLE -replace '\|', ',' | Out-File -FilePath (Join-Path $CsvDir "local_users.csv") -Encoding UTF8

Write-Host "CSV Exports Saved At:"
Write-Host "$CsvDir"
Write-Host ""

# ============================================================
# UPLOAD HTML REPORT TO FILEBASE S3-COMPATIBLE STORAGE (via b2 CLI)
# ============================================================

# Get MAC address for linking to EndpointStatus
$MacAddress = (Get-NetAdapter -Physical -ErrorAction SilentlyContinue |
    Where-Object { $_.Status -eq "Up" } | Select-Object -First 1 -ExpandProperty MacAddress)
if (-not $MacAddress) { $MacAddress = "N/A" }

Write-Host "=================================================="
Write-Host " UPLOADING REPORT TO FILEBASE"
Write-Host "=================================================="
Write-Host "MAC Address: $MacAddress"
Write-Host ""

Write-Host "[1/1] Uploading to Filebase..."

$B2ApplicationKeyId = $env:B2_APPLICATION_KEY_ID
$B2ApplicationKey = $env:B2_APPLICATION_KEY
$B2Bucket = if ($env:B2_BUCKET) { $env:B2_BUCKET } else { "Endpoint-Dashboard" }

$UploadSuccess = $false

if (-not $B2ApplicationKeyId -or -not $B2ApplicationKey) {
    Write-Host "  x B2 credentials not configured in environment"
    Write-Host "  ! Set B2_APPLICATION_KEY_ID and B2_APPLICATION_KEY in $ConfigFile"
} else {
    # b2.exe is frequently missing from PATH even when installed via pip;
    # fall back to 'python -m b2' if the bare command isn't found.
    $B2Cmd = if (Get-Command b2 -ErrorAction SilentlyContinue) { @("b2") } else { @("python", "-m", "b2") }

    & $B2Cmd[0] $B2Cmd[1..($B2Cmd.Length-1)] account authorize $B2ApplicationKeyId $B2ApplicationKey *> $null
    if ($LASTEXITCODE -eq 0) {
        $RemoteName = "Windows/$HostnameVal/$(Split-Path $ReportFile -Leaf)"
        & $B2Cmd[0] $B2Cmd[1..($B2Cmd.Length-1)] file upload $B2Bucket $ReportFile $RemoteName *> $null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  * Report uploaded to B2: $RemoteName"
            $UploadSuccess = $true
        } else {
            Write-Host "  x B2 file upload failed"
        }
    } else {
        Write-Host "  x B2 account authorization failed (or b2 CLI not available)"
        Write-Host "  ! Install it with: python -m pip install b2"
    }
}

Write-Host ""
Write-Host "=================================================="
Write-Host " AUDIT REPORT UPLOAD SUMMARY"
Write-Host "=================================================="
Write-Host "Machine ID : $HostnameVal"
Write-Host "MAC Address: $MacAddress"
Write-Host "Report File: $(Split-Path $ReportFile -Leaf)"
Write-Host ""
Write-Host "B2 Cloud   : $(if ($UploadSuccess) { '* Success' } else { 'x Failed' })"
Write-Host ""
Write-Host "=================================================="
Write-Host ""
