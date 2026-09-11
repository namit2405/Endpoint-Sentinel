#!/bin/bash
# ============================================================
# Linux Endpoint Security & IT Audit Script (v2)
# Compatible with: Debian/Ubuntu (apt), RHEL/Fedora/CentOS
#                   (dnf/yum), Arch (pacman), openSUSE (zypper)
#                   - package/update sections auto-detect the
#                   package manager; everything else is
#                   distro-agnostic.
#
# Recommended Run:
#   sudo bash Linux_Endpoints_Security_Script.sh
#
# Output:
#   HTML Audit Report with a pass/fail security scorecard
#
# NOTE: This script intentionally does NOT use `set -e`.
# Many checks below are expected to "fail" on a hardened or
# minimal system (e.g. mokutil not installed, no TPM device,
# no matches for a grep) - that is a valid audit finding, not
# a fatal error, and the script must keep running to report it.
# ============================================================

echo "=================================================="
echo " LINUX SECURITY AUDIT STARTED"
echo "=================================================="

# ============================================================
# Load Configuration from EnvironmentFile
# ============================================================

CONFIG_FILE="/etc/default/endpoint-heartbeat"
if [ -f "$CONFIG_FILE" ]; then
    set -a
    source "$CONFIG_FILE"
    set +a
fi

# ============================================================
# Report Configuration
# ============================================================

HOSTNAME=$(hostname)

# Try Samba mount first, fall back to local /tmp if Samba is down
REPORT_DIR="/mnt/AuditReports/Reports/Linux"
if ! mkdir -p "$REPORT_DIR" 2>/dev/null; then
    echo "WARNING: Samba mount /mnt/AuditReports is down, using local directory"
    REPORT_DIR="/tmp/AuditReports/Reports/Linux"
    mkdir -p "$REPORT_DIR"
fi

REPORT_FILE="$REPORT_DIR/${HOSTNAME}.html"

CSV_DIR="$REPORT_DIR/${HOSTNAME}_CSV"

# -------------------------------
# Cleanup: Delete only this machine's previous report
# -------------------------------
echo "Cleaning previous report for $HOSTNAME ..."

rm -f "$REPORT_FILE"
rm -rf "$CSV_DIR"

mkdir -p "$CSV_DIR"
# -------------------------------
# Root / sudo check
# -------------------------------
if [ "$(id -u)" -ne 0 ]; then
    echo "WARNING: Not running as root." >&2
    echo "Several checks (sudoers, SUID/world-writable scan, failed logins, full service list) will be incomplete." >&2
    echo "Re-run with: sudo bash $0" >&2
    echo ""
fi
IS_ROOT="No"
[ "$(id -u)" -eq 0 ] && IS_ROOT="Yes"

# -------------------------------
# Helpers
# -------------------------------

# Escapes &, <, > so raw command output can never break the HTML structure.
html_escape() {
    printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'
}

# Runs a command safely; never lets a non-zero exit kill the script,
# and returns a clear fallback message instead of blank output.
safe_run() {
    local out
    out=$(eval "$1" 2>/dev/null)
    if [ -z "$out" ]; then
        echo "${2:-No data found}"
    else
        echo "$out"
    fi
}

SCORECARD_ROWS=""
add_score() {
    # $1=Check name  $2=Pass|Fail|Warn|Info  $3=Detail
    local cls="warn"
    case "$2" in
        Pass) cls="success" ;;
        Fail) cls="fail" ;;
        Warn) cls="warn" ;;
        Info) cls="warn" ;;
    esac
    local check_esc detail_esc
    check_esc=$(html_escape "$1")
    detail_esc=$(html_escape "$3")
    # Detail may legitimately contain multiple pieces of info; flatten any
    # embedded newlines to keep each scorecard entry on a single line so
    # later CSV export (which is line-based) never gets corrupted.
    detail_esc=$(echo "$detail_esc" | tr '\n' ' ' | sed 's/  */ /g')
    SCORECARD_ROWS="${SCORECARD_ROWS}<tr><td>${check_esc}</td><td><span class=\"${cls}\">${2}</span></td><td>${detail_esc}</td></tr>
"
}

# ============================================================
# SYSTEM INFORMATION
# ============================================================
OS=$(grep PRETTY_NAME /etc/os-release 2>/dev/null | cut -d= -f2 | tr -d '"')
[ -z "$OS" ] && OS="Unknown"
KERNEL=$(uname -r)
ARCH=$(uname -m)
UPTIME=$(uptime -p 2>/dev/null || echo "Unavailable")
LAST_BOOT=$(who -b 2>/dev/null | awk '{print $3, $4}')
CPU=$(lscpu 2>/dev/null | grep "Model name" | sed 's/Model name:[ \t]*//')
[ -z "$CPU" ] && CPU="Unavailable"
RAM=$(free -h 2>/dev/null | awk '/Mem:/ {print $2}')
IPADDR=$(hostname -I 2>/dev/null | awk '{print $1}')
DISK_USAGE=$(df -h --output=source,size,used,avail,pcent,target -x tmpfs -x devtmpfs 2>/dev/null | tail -n +2)

# ============================================================
# PACKAGE MANAGER DETECTION (for patch status + software list)
# ============================================================

PKG_MGR="unknown"
if command -v apt >/dev/null 2>&1; then PKG_MGR="apt"
elif command -v dnf >/dev/null 2>&1; then PKG_MGR="dnf"
elif command -v yum >/dev/null 2>&1; then PKG_MGR="yum"
elif command -v pacman >/dev/null 2>&1; then PKG_MGR="pacman"
elif command -v zypper >/dev/null 2>&1; then PKG_MGR="zypper"
fi

case "$PKG_MGR" in
    apt)
        PENDING_UPDATES=$(apt list --upgradable 2>/dev/null | tail -n +2 | wc -l)
        SOFTWARE_LIST=$(dpkg -l 2>/dev/null | head -100)
        ;;
    dnf)
        PENDING_UPDATES=$(dnf check-update 2>/dev/null | grep -c '^[a-zA-Z0-9]')
        SOFTWARE_LIST=$(rpm -qa 2>/dev/null | sort | head -100)
        ;;
    yum)
        PENDING_UPDATES=$(yum check-update 2>/dev/null | grep -c '^[a-zA-Z0-9]')
        SOFTWARE_LIST=$(rpm -qa 2>/dev/null | sort | head -100)
        ;;
    pacman)
        PENDING_UPDATES=$(pacman -Qu 2>/dev/null | wc -l)
        SOFTWARE_LIST=$(pacman -Q 2>/dev/null | head -100)
        ;;
    zypper)
        PENDING_UPDATES=$(zypper -q lu 2>/dev/null | grep -c '^v')
        SOFTWARE_LIST=$(rpm -qa 2>/dev/null | sort | head -100)
        ;;
    *)
        PENDING_UPDATES="Unknown (unsupported package manager)"
        SOFTWARE_LIST="Unsupported package manager - cannot enumerate installed software"
        ;;
esac

if [[ "$PENDING_UPDATES" =~ ^[0-9]+$ ]]; then
    if [ "$PENDING_UPDATES" -eq 0 ]; then
        add_score "Pending OS Updates" "Pass" "System is up to date ($PKG_MGR)"
    else
        add_score "Pending OS Updates" "Warn" "$PENDING_UPDATES update(s) pending ($PKG_MGR)"
    fi
else
    add_score "Pending OS Updates" "Info" "$PENDING_UPDATES"
fi

# ============================================================
# DISK ENCRYPTION (LUKS)
# ============================================================

LUKS_STATUS=$(lsblk -o NAME,TYPE 2>/dev/null | grep crypt)
if [ -z "$LUKS_STATUS" ]; then
    LUKS_STATUS="No encrypted LUKS volume detected"
    add_score "Disk Encryption (LUKS)" "Fail" "No encrypted volumes found"
else
    add_score "Disk Encryption (LUKS)" "Pass" "Encrypted LUKS volume(s) present"
fi

# ============================================================
# ANTIVIRUS / EDR
# ============================================================

AV_STATUS="No Antivirus/EDR Detected"
if dpkg -l 2>/dev/null | grep -iq clamav; then
    AV_STATUS="ClamAV Installed"
elif rpm -qa 2>/dev/null | grep -iq clamav; then
    AV_STATUS="ClamAV Installed"
elif systemctl list-units --type=service 2>/dev/null | grep -iq crowdstrike; then
    AV_STATUS="CrowdStrike Detected"
elif systemctl list-units --type=service 2>/dev/null | grep -iq sentinelone; then
    AV_STATUS="SentinelOne Detected"
fi
add_score "Antivirus / EDR" "$([ "$AV_STATUS" = "No Antivirus/EDR Detected" ] && echo Warn || echo Pass)" "$AV_STATUS"

# ============================================================
# FIREWALL STATUS (ufw -> firewalld -> iptables/nftables)
# ============================================================

if command -v ufw >/dev/null 2>&1; then
    FIREWALL_STATUS=$(ufw status 2>/dev/null)
    FIREWALL_ACTIVE=$(echo "$FIREWALL_STATUS" | grep -q "Status: active" && echo Pass || echo Fail)
    FIREWALL_TOOL="ufw"
elif command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active firewalld >/dev/null 2>&1; then
    FIREWALL_STATUS=$(firewall-cmd --state 2>/dev/null; firewall-cmd --list-all 2>/dev/null)
    FIREWALL_ACTIVE="Pass"
    FIREWALL_TOOL="firewalld"
elif command -v nft >/dev/null 2>&1 && [ -n "$(nft list ruleset 2>/dev/null)" ]; then
    FIREWALL_STATUS=$(nft list ruleset 2>/dev/null | head -40)
    FIREWALL_ACTIVE="Pass"
    FIREWALL_TOOL="nftables"
elif command -v iptables >/dev/null 2>&1; then
    FIREWALL_STATUS=$(iptables -L -n 2>/dev/null)
    RULE_COUNT=$(echo "$FIREWALL_STATUS" | grep -c '^ACCEPT\|^DROP\|^REJECT')
    FIREWALL_ACTIVE=$([ "$RULE_COUNT" -gt 0 ] && echo Pass || echo Fail)
    FIREWALL_TOOL="iptables"
else
    FIREWALL_STATUS="No supported firewall tool found (ufw/firewalld/nftables/iptables)"
    FIREWALL_ACTIVE="Fail"
    FIREWALL_TOOL="none"
fi
add_score "Firewall" "$FIREWALL_ACTIVE" "Tool: $FIREWALL_TOOL"

# ============================================================
# NETWORK ADAPTERS & DNS  (Linux equivalent of Windows section 17)
# ============================================================

NET_ADAPTERS=$(ip -brief addr show 2>/dev/null)
[ -z "$NET_ADAPTERS" ] && NET_ADAPTERS=$(ifconfig -a 2>/dev/null)
[ -z "$NET_ADAPTERS" ] && NET_ADAPTERS="Unable to determine (neither ip nor ifconfig available)"

DEFAULT_GATEWAY=$(ip route show default 2>/dev/null | awk '{print $3}' | head -1)
[ -z "$DEFAULT_GATEWAY" ] && DEFAULT_GATEWAY="Not found"

if command -v resolvectl >/dev/null 2>&1; then
    DNS_SERVERS=$(resolvectl status 2>/dev/null | grep "DNS Servers" | head -1 | sed 's/.*DNS Servers: //')
elif [ -f /etc/resolv.conf ]; then
    DNS_SERVERS=$(grep -i "^nameserver" /etc/resolv.conf 2>/dev/null | awk '{print $2}' | tr '\n' ' ')
fi
[ -z "$DNS_SERVERS" ] && DNS_SERVERS="Not found"

# ============================================================
# NETWORK SHARES  (Samba / NFS - Linux equivalent of Windows section 18)
# ============================================================

SAMBA_SHARES="Samba not installed"
if command -v testparm >/dev/null 2>&1; then
    SAMBA_SHARES=$(testparm -s 2>/dev/null | grep '^\[' | grep -v '^\[global\]\|^\[printers\]\|^\[print\$\]')
    [ -z "$SAMBA_SHARES" ] && SAMBA_SHARES="Samba installed, no custom shares configured"
fi

NFS_SHARES="No /etc/exports found (NFS not configured)"
if [ -f /etc/exports ]; then
    NFS_SHARES=$(grep -Ev '^\s*#|^\s*$' /etc/exports 2>/dev/null)
    [ -z "$NFS_SHARES" ] && NFS_SHARES="/etc/exports present but empty"
fi

CUSTOM_SHARE_COUNT=0
[[ "$SAMBA_SHARES" == *"["* ]] && CUSTOM_SHARE_COUNT=$((CUSTOM_SHARE_COUNT + $(echo "$SAMBA_SHARES" | grep -c '^\[')))
[[ "$NFS_SHARES" != "No /etc/exports found"* && "$NFS_SHARES" != *"empty"* ]] && CUSTOM_SHARE_COUNT=$((CUSTOM_SHARE_COUNT + $(echo "$NFS_SHARES" | grep -c .)))
add_score "Non-Default Network Shares" "$([ "$CUSTOM_SHARE_COUNT" -eq 0 ] && echo Pass || echo Info)" "$CUSTOM_SHARE_COUNT share(s) found (Samba + NFS)"

# ============================================================
# SMB PROTOCOL VERSION  (Linux equivalent of Windows SMBv1 check)
# ============================================================

SMB_MIN_PROTOCOL="Samba not installed"
if command -v testparm >/dev/null 2>&1; then
    SMB_MIN_PROTOCOL=$(testparm -s 2>/dev/null | grep -i "min protocol\|server min protocol")
    [ -z "$SMB_MIN_PROTOCOL" ] && SMB_MIN_PROTOCOL="Not explicitly set (check Samba build default - modern Samba defaults to SMB2+)"
    if [[ "$SMB_MIN_PROTOCOL" == *"NT1"* || "$SMB_MIN_PROTOCOL" == *"CORE"* || "$SMB_MIN_PROTOCOL" == *"LANMAN"* ]]; then
        add_score "SMBv1 Disabled" "Fail" "Server min protocol allows legacy SMBv1: $SMB_MIN_PROTOCOL"
    else
        add_score "SMBv1 Disabled" "Pass" "$SMB_MIN_PROTOCOL"
    fi
fi

# ============================================================
# REMOTE DESKTOP ACCESS  (Linux equivalent of Windows RDP check)
# ============================================================

REMOTE_ACCESS="No remote desktop service detected (VNC/xrdp)"
REMOTE_ACCESS_RISK="Pass"
if systemctl is-active xrdp >/dev/null 2>&1; then
    REMOTE_ACCESS="xrdp is active - RDP-compatible remote desktop enabled"
    REMOTE_ACCESS_RISK="Warn"
elif systemctl list-units --type=service 2>/dev/null | grep -iq vnc; then
    REMOTE_ACCESS="A VNC service is active - verify authentication and encryption settings"
    REMOTE_ACCESS_RISK="Warn"
fi
add_score "Remote Desktop Exposure" "$REMOTE_ACCESS_RISK" "$REMOTE_ACCESS"

# ============================================================
# UEFI / SECURE BOOT
# ============================================================

if [ -d /sys/firmware/efi ]; then
    BOOT_MODE="UEFI"
    if command -v mokutil >/dev/null 2>&1; then
        SECURE_BOOT=$(mokutil --sb-state 2>/dev/null)
        [ -z "$SECURE_BOOT" ] && SECURE_BOOT="Unable to determine"
    else
        SECURE_BOOT="mokutil not installed - cannot determine Secure Boot state"
    fi
else
    BOOT_MODE="Legacy BIOS"
    SECURE_BOOT="N/A - Legacy BIOS (UEFI required for Secure Boot)"
fi

if [[ "$SECURE_BOOT" == *"enabled"* ]]; then
    add_score "Secure Boot" "Pass" "$SECURE_BOOT ($BOOT_MODE)"
elif [[ "$BOOT_MODE" == "Legacy BIOS" ]]; then
    add_score "Secure Boot" "Info" "$SECURE_BOOT"
else
    add_score "Secure Boot" "Warn" "$SECURE_BOOT ($BOOT_MODE)"
fi

# ============================================================
# TPM STATUS
# ============================================================

if ls /dev/tpm* >/dev/null 2>&1; then
    TPM_STATUS="TPM Device Present ($(ls /dev/tpm* 2>/dev/null | tr '\n' ' '))"
    add_score "TPM Present" "Pass" "$TPM_STATUS"
else
    TPM_STATUS="TPM Not Detected"
    add_score "TPM Present" "Warn" "$TPM_STATUS"
fi

# ============================================================
# PASSWORD POLICY (login.defs + PAM pwquality if present)
# ============================================================

PASSWORD_POLICY=$(grep -E "^(PASS_MAX_DAYS|PASS_MIN_DAYS|PASS_WARN_AGE|PASS_MIN_LEN)[[:space:]]" /etc/login.defs 2>/dev/null)
[ -z "$PASSWORD_POLICY" ] && PASSWORD_POLICY="Unable to read /etc/login.defs"

PWQUALITY_FILE=""
for f in /etc/security/pwquality.conf /etc/pam.d/common-password /etc/pam.d/system-auth; do
    [ -f "$f" ] && PWQUALITY_FILE="$f" && break
done
if [ -n "$PWQUALITY_FILE" ]; then
    PWQUALITY_SETTINGS=$(grep -Ev '^\s*#|^\s*$' "$PWQUALITY_FILE" 2>/dev/null | grep -Ei 'minlen|pwquality|pwhistory|dcredit|ucredit|lcredit|ocredit')
    [ -z "$PWQUALITY_SETTINGS" ] && PWQUALITY_SETTINGS="No explicit complexity rules found in $PWQUALITY_FILE (defaults apply)"
else
    PWQUALITY_SETTINGS="pwquality/PAM password config not found - complexity may be unmanaged"
fi

MAXDAYS=$(echo "$PASSWORD_POLICY" | grep "^PASS_MAX_DAYS" | awk '{print $2}' | head -1)
if [ -n "$MAXDAYS" ] && [ "$MAXDAYS" -le 90 ] 2>/dev/null; then
    add_score "Password Max Age" "Pass" "PASS_MAX_DAYS=$MAXDAYS"
else
    add_score "Password Max Age" "Warn" "PASS_MAX_DAYS=${MAXDAYS:-not set}"
fi

# ============================================================
# ALL LOCAL USER ACCOUNTS - password aging  (Linux equivalent of
# Windows section 7a: local users with PasswordNeverExpires)
# ============================================================

LOCAL_USERS_TABLE="Username | UID | Shell | Password Max Days | Never Expires
------------------------------------------------------------"
NEVER_EXPIRE_COUNT=0
while IFS=: read -r uname _ uid _ _ _ shell; do
    if [ "$uid" -ge 1000 ] && [ "$shell" != "/usr/sbin/nologin" ] && [ "$shell" != "/bin/false" ]; then
        if [ "$IS_ROOT" = "Yes" ] && command -v chage >/dev/null 2>&1; then
            MAXD=$(chage -l "$uname" 2>/dev/null | grep "Maximum number of days" | awk -F: '{print $2}' | tr -d ' ')
            [ -z "$MAXD" ] && MAXD="unknown"
            NEVER="No"
            [ "$MAXD" = "99999" ] && NEVER="Yes" && NEVER_EXPIRE_COUNT=$((NEVER_EXPIRE_COUNT + 1))
        else
            MAXD="unknown (requires root)"
            NEVER="unknown"
        fi
        LOCAL_USERS_TABLE="${LOCAL_USERS_TABLE}
${uname} | ${uid} | ${shell} | ${MAXD} | ${NEVER}"
    fi
done < /etc/passwd

if [ "$IS_ROOT" = "Yes" ]; then
    add_score "Passwords Never Expire" "$([ "$NEVER_EXPIRE_COUNT" -eq 0 ] && echo Pass || echo Warn)" "$NEVER_EXPIRE_COUNT interactive account(s) with no password expiry"
else
    add_score "Passwords Never Expire" "Info" "Skipped - requires root to read chage data"
fi

# ============================================================
# SCREEN LOCK POLICY (best-effort - desktop-environment dependent)
# ============================================================

SCREEN_LOCK_FILES=$(find /home -maxdepth 4 -type f -path "*/.config/dconf/user" 2>/dev/null)
if [ -n "$SCREEN_LOCK_FILES" ]; then
    SCREEN_LOCK="dconf user profile(s) found for: $(echo "$SCREEN_LOCK_FILES" | sed 's#/home/##;s#/\.config.*##' | tr '\n' ' ')"
    SCREEN_LOCK="$SCREEN_LOCK
Note: this is a desktop GUI session (GNOME/dconf). Exact lock-on-idle timeout requires reading the live dconf database per user and is not reliably determinable from an offline audit."
else
    SCREEN_LOCK="No GUI desktop session config found - likely a headless server (screen lock not applicable)"
fi

# ============================================================
# LOCAL ADMIN / SUDO USERS
# ============================================================

SUDO_USERS=$(getent group sudo 2>/dev/null)
WHEEL_USERS=$(getent group wheel 2>/dev/null)
ADMIN_GROUP_INFO="Sudo group: ${SUDO_USERS:-not present}
Wheel group: ${WHEEL_USERS:-not present}"

ROOT_UID_ACCOUNTS=$(awk -F: '($3 == 0) {print $1}' /etc/passwd 2>/dev/null)
ROOT_COUNT=$(echo "$ROOT_UID_ACCOUNTS" | grep -c .)
add_score "UID 0 Accounts" "$([ "$ROOT_COUNT" -le 1 ] && echo Pass || echo Fail)" "$(echo "$ROOT_UID_ACCOUNTS" | tr '\n' ' ')"

# ============================================================
# PASSWORDLESS SUDO CHECK
# ============================================================

if [ "$IS_ROOT" = "Yes" ]; then
    PASSWORDLESS_SUDO=$(grep -rE "^[^#]*NOPASSWD" /etc/sudoers /etc/sudoers.d/ 2>/dev/null)
    if [ -z "$PASSWORDLESS_SUDO" ]; then
        PASSWORDLESS_SUDO="No passwordless sudo entries found"
        add_score "Passwordless Sudo" "Pass" "None found"
    else
        add_score "Passwordless Sudo" "Warn" "NOPASSWD entries present - review required"
    fi
else
    PASSWORDLESS_SUDO="Skipped - requires root to read /etc/sudoers.d/"
    add_score "Passwordless Sudo" "Info" "$PASSWORDLESS_SUDO"
fi

# ============================================================
# SSH HARDENING
# ============================================================

SSH_STATUS=$(systemctl is-active ssh 2>/dev/null || systemctl is-active sshd 2>/dev/null || echo "SSH Not Installed / Not Running")
SSHD_CONFIG="/etc/ssh/sshd_config"

get_sshd_setting() {
    # Falls back through sshd_config.d includes if not found in main file
    local key="$1"
    local val
    val=$(grep -iE "^\s*${key}\s+" "$SSHD_CONFIG" 2>/dev/null | tail -1 | awk '{print $2}')
    if [ -z "$val" ] && [ -d /etc/ssh/sshd_config.d ]; then
        val=$(grep -irE "^\s*${key}\s+" /etc/ssh/sshd_config.d/ 2>/dev/null | tail -1 | awk -F: '{print $2}' | awk '{print $2}')
    fi
    [ -z "$val" ] && val="Not Explicitly Set (default applies)"
    echo "$val"
}

ROOT_LOGIN=$(get_sshd_setting "PermitRootLogin")
PASSWORD_AUTH=$(get_sshd_setting "PasswordAuthentication")
PUBKEY_AUTH=$(get_sshd_setting "PubkeyAuthentication")
X11_FORWARD=$(get_sshd_setting "X11Forwarding")
SSH_PORT=$(get_sshd_setting "Port")

SSH_SUMMARY="Service Status: $SSH_STATUS
PermitRootLogin: $ROOT_LOGIN
PasswordAuthentication: $PASSWORD_AUTH
PubkeyAuthentication: $PUBKEY_AUTH
X11Forwarding: $X11_FORWARD
Port: $SSH_PORT"

if [ "$SSH_STATUS" = "active" ]; then
    add_score "SSH Root Login" "$([[ "$ROOT_LOGIN" == "no" ]] && echo Pass || echo Warn)" "$ROOT_LOGIN"
    add_score "SSH Password Auth" "$([[ "$PASSWORD_AUTH" == "no" ]] && echo Pass || echo Warn)" "$PASSWORD_AUTH (key-only is stronger)"
else
    add_score "SSH Service" "Info" "$SSH_STATUS"
fi

# ============================================================
# RUNNING / FAILED SERVICES
# ============================================================

RUNNING_SERVICES=$(systemctl list-units --type=service --state=running 2>/dev/null | head -50)
FAILED_SERVICES=$(systemctl --failed 2>/dev/null)
[ -z "$FAILED_SERVICES" ] && FAILED_SERVICES="No failed services"
FAILED_COUNT=$(systemctl --failed --no-legend 2>/dev/null | grep -c .)
add_score "Failed Systemd Services" "$([ "$FAILED_COUNT" -eq 0 ] && echo Pass || echo Warn)" "$FAILED_COUNT failed unit(s)"

# ============================================================
# AUDIT LOGGING
# ============================================================

AUDITD_STATUS=$(systemctl is-active auditd 2>/dev/null || echo "Auditd Not Installed")
add_score "Audit Daemon (auditd)" "$([ "$AUDITD_STATUS" = "active" ] && echo Pass || echo Warn)" "$AUDITD_STATUS"

AUDIT_RULES="Auditd not active - no rules to display"
if [ "$AUDITD_STATUS" = "active" ] && command -v auditctl >/dev/null 2>&1; then
    if [ "$IS_ROOT" = "Yes" ]; then
        AUDIT_RULES=$(auditctl -l 2>/dev/null)
        [ -z "$AUDIT_RULES" ] && AUDIT_RULES="Auditd is active but no audit rules are loaded (logging is on, but nothing specific is being watched)"
    else
        AUDIT_RULES="Skipped - requires root to read active audit rules"
    fi
fi

# ============================================================
# OPEN PORTS
# ============================================================

OPEN_PORTS=$(ss -tulnp 2>/dev/null || netstat -tulnp 2>/dev/null || echo "Neither ss nor netstat available")

# ============================================================
# FAILED LOGINS
# ============================================================

if [ "$IS_ROOT" = "Yes" ] && [ -f /var/log/btmp ]; then
    FAILED_LOGINS=$(lastb 2>/dev/null | head -20)
    [ -z "$FAILED_LOGINS" ] && FAILED_LOGINS="No failed logins recorded"
else
    FAILED_LOGINS="Skipped - requires root to read /var/log/btmp"
fi

# ============================================================
# USB DEVICES
# ============================================================

USB_DEVICES=$(command -v lsusb >/dev/null 2>&1 && lsusb || echo "lsusb not available")
USB_STORAGE=$(lsmod 2>/dev/null | grep usb_storage)
[ -z "$USB_STORAGE" ] && USB_STORAGE="USB storage module not currently loaded"

# ============================================================
# BROWSER EXTENSIONS (ALL USERS)
# ============================================================

BROWSER_DATA=$(find /home -maxdepth 6 -type d -path "*/Extensions" 2>/dev/null | head -20)
[ -z "$BROWSER_DATA" ] && BROWSER_DATA="No browser extensions found"

# ============================================================
# WORLD WRITABLE FILES & DIRECTORIES (single filesystem only)
# ============================================================

WORLD_WRITABLE_FILES=$(find / -xdev -type f -perm -0002 2>/dev/null | head -20)
[ -z "$WORLD_WRITABLE_FILES" ] && WORLD_WRITABLE_FILES="No world-writable files detected"

# Directories that are world-writable AND missing the sticky bit are a
# classic local privilege-escalation vector (anyone can delete/replace
# other users' files in them) - /tmp normally has the sticky bit, so this
# specifically flags the dangerous variant, not every writable dir.
WORLD_WRITABLE_DIRS_NO_STICKY=$(find / -xdev -type d -perm -0002 ! -perm -1000 2>/dev/null | head -20)
[ -z "$WORLD_WRITABLE_DIRS_NO_STICKY" ] && WORLD_WRITABLE_DIRS_NO_STICKY="None found"
add_score "World-Writable Dirs (no sticky bit)" "$([ "$WORLD_WRITABLE_DIRS_NO_STICKY" = "None found" ] && echo Pass || echo Fail)" "$(echo "$WORLD_WRITABLE_DIRS_NO_STICKY" | wc -l) potential issue(s)"

# ============================================================
# SUID / SGID FILES (single filesystem only - was unbounded before)
# ============================================================

SUID_FILES=$(find / -xdev -perm -4000 -type f 2>/dev/null | head -30)
SGID_FILES=$(find / -xdev -perm -2000 -type f 2>/dev/null | head -30)

# ============================================================
# CRON JOBS
# ============================================================

CRON_JOBS=$(crontab -l 2>/dev/null)
[ -z "$CRON_JOBS" ] && CRON_JOBS="No user cron jobs for current user"
SYSTEM_CRON=$(ls -la /etc/cron* 2>/dev/null)
[ -z "$SYSTEM_CRON" ] && SYSTEM_CRON="No system cron directories found"

# ============================================================
# SYSTEMD TIMERS  (Linux equivalent of Windows Scheduled Tasks -
# cron alone misses this on modern systemd-based distros)
# ============================================================

SYSTEMD_TIMERS=$(systemctl list-timers --all 2>/dev/null)
[ -z "$SYSTEMD_TIMERS" ] && SYSTEMD_TIMERS="Unable to determine (systemctl not available)"

# ============================================================
# STARTUP / AUTOSTART PROGRAMS  (Linux equivalent of Windows
# Startup Programs section)
# ============================================================

ENABLED_SERVICES=$(systemctl list-unit-files --type=service --state=enabled 2>/dev/null | head -50)
[ -z "$ENABLED_SERVICES" ] && ENABLED_SERVICES="Unable to determine"

RC_LOCAL="Not present"
[ -f /etc/rc.local ] && RC_LOCAL=$(grep -Ev '^\s*#|^\s*$|^exit 0' /etc/rc.local 2>/dev/null)
[ -z "$RC_LOCAL" ] && RC_LOCAL="Present but empty / only boilerplate"

XDG_AUTOSTART=$(find /home /etc/xdg -maxdepth 5 -path "*/autostart/*.desktop" 2>/dev/null | head -30)
[ -z "$XDG_AUTOSTART" ] && XDG_AUTOSTART="No XDG autostart entries found"

# ============================================================
# LOG RETENTION
# ============================================================

LOG_RETENTION=$(journalctl --disk-usage 2>/dev/null)
[ -z "$LOG_RETENTION" ] && LOG_RETENTION="Unable to determine (journald not in use or insufficient permissions)"

# ============================================================
# HTML REPORT GENERATION (all dynamic values escaped)
# ============================================================

HOSTNAME_E=$(html_escape "$HOSTNAME")
OS_E=$(html_escape "$OS")
KERNEL_E=$(html_escape "$KERNEL")
ARCH_E=$(html_escape "$ARCH")
CPU_E=$(html_escape "$CPU")
RAM_E=$(html_escape "$RAM")
IPADDR_E=$(html_escape "$IPADDR")
UPTIME_E=$(html_escape "$UPTIME")
LAST_BOOT_E=$(html_escape "$LAST_BOOT")
BOOT_MODE_E=$(html_escape "$BOOT_MODE")
DISK_USAGE_E=$(html_escape "$DISK_USAGE")

LUKS_STATUS_E=$(html_escape "$LUKS_STATUS")
AV_STATUS_E=$(html_escape "$AV_STATUS")
PENDING_UPDATES_E=$(html_escape "$PENDING_UPDATES")
FIREWALL_STATUS_E=$(html_escape "$FIREWALL_STATUS")
SECURE_BOOT_E=$(html_escape "$SECURE_BOOT")
TPM_STATUS_E=$(html_escape "$TPM_STATUS")
NET_ADAPTERS_E=$(html_escape "$NET_ADAPTERS")
DEFAULT_GATEWAY_E=$(html_escape "$DEFAULT_GATEWAY")
DNS_SERVERS_E=$(html_escape "$DNS_SERVERS")
SAMBA_SHARES_E=$(html_escape "$SAMBA_SHARES")
NFS_SHARES_E=$(html_escape "$NFS_SHARES")
SMB_MIN_PROTOCOL_E=$(html_escape "$SMB_MIN_PROTOCOL")
REMOTE_ACCESS_E=$(html_escape "$REMOTE_ACCESS")
LOCAL_USERS_TABLE_E=$(html_escape "$LOCAL_USERS_TABLE")
SYSTEMD_TIMERS_E=$(html_escape "$SYSTEMD_TIMERS")
ENABLED_SERVICES_E=$(html_escape "$ENABLED_SERVICES")
RC_LOCAL_E=$(html_escape "$RC_LOCAL")
XDG_AUTOSTART_E=$(html_escape "$XDG_AUTOSTART")
AUDIT_RULES_E=$(html_escape "$AUDIT_RULES")
PASSWORD_POLICY_E=$(html_escape "$PASSWORD_POLICY")
PWQUALITY_SETTINGS_E=$(html_escape "$PWQUALITY_SETTINGS")
SCREEN_LOCK_E=$(html_escape "$SCREEN_LOCK")
ADMIN_GROUP_INFO_E=$(html_escape "$ADMIN_GROUP_INFO")
PASSWORDLESS_SUDO_E=$(html_escape "$PASSWORDLESS_SUDO")
SSH_SUMMARY_E=$(html_escape "$SSH_SUMMARY")
AUDITD_STATUS_E=$(html_escape "$AUDITD_STATUS")
OPEN_PORTS_E=$(html_escape "$OPEN_PORTS")
RUNNING_SERVICES_E=$(html_escape "$RUNNING_SERVICES")
FAILED_SERVICES_E=$(html_escape "$FAILED_SERVICES")
FAILED_LOGINS_E=$(html_escape "$FAILED_LOGINS")
USB_DEVICES_E=$(html_escape "$USB_DEVICES")
USB_STORAGE_E=$(html_escape "$USB_STORAGE")
SOFTWARE_LIST_E=$(html_escape "$SOFTWARE_LIST")
BROWSER_DATA_E=$(html_escape "$BROWSER_DATA")
WORLD_WRITABLE_FILES_E=$(html_escape "$WORLD_WRITABLE_FILES")
WORLD_WRITABLE_DIRS_E=$(html_escape "$WORLD_WRITABLE_DIRS_NO_STICKY")
SUID_FILES_E=$(html_escape "$SUID_FILES")
SGID_FILES_E=$(html_escape "$SGID_FILES")
CRON_JOBS_E=$(html_escape "$CRON_JOBS")
SYSTEM_CRON_E=$(html_escape "$SYSTEM_CRON")
LOG_RETENTION_E=$(html_escape "$LOG_RETENTION")

cat <<EOF > "$REPORT_FILE"
<html>
<head>
<title>Linux Security Audit Report</title>
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

<h1>Linux Security Audit Report</h1>
<p><b>Generated:</b> $(date) &nbsp; | &nbsp; <b>Host:</b> $HOSTNAME_E &nbsp; | &nbsp; <b>Run as root:</b> $IS_ROOT</p>

<h2>Security Scorecard</h2>
<table>
<tr><th>Security Check</th><th>Result</th><th>Detail</th></tr>
$SCORECARD_ROWS
</table>

<h2>System Information</h2>
<table>
<tr><th>Parameter</th><th>Value</th></tr>
<tr><td>Hostname</td><td>$HOSTNAME_E</td></tr>
<tr><td>OS</td><td>$OS_E</td></tr>
<tr><td>Kernel</td><td>$KERNEL_E</td></tr>
<tr><td>Architecture</td><td>$ARCH_E</td></tr>
<tr><td>Boot Mode</td><td>$BOOT_MODE_E</td></tr>
<tr><td>CPU</td><td>$CPU_E</td></tr>
<tr><td>RAM</td><td>$RAM_E</td></tr>
<tr><td>IP Address</td><td>$IPADDR_E</td></tr>
<tr><td>Uptime</td><td>$UPTIME_E</td></tr>
<tr><td>Last Boot</td><td>$LAST_BOOT_E</td></tr>
<tr><td>Package Manager</td><td>$PKG_MGR</td></tr>
</table>

<h2>Disk Usage</h2>
<pre>$DISK_USAGE_E</pre>

<h2>Security Controls</h2>
<pre>
Disk Encryption (LUKS):
$LUKS_STATUS_E

Antivirus / EDR:
$AV_STATUS_E

Pending Updates:
$PENDING_UPDATES_E

Firewall:
$FIREWALL_STATUS_E

Secure Boot / Boot Mode:
$SECURE_BOOT_E

TPM:
$TPM_STATUS_E

Password Policy (login.defs):
$PASSWORD_POLICY_E

Password Complexity (PAM/pwquality):
$PWQUALITY_SETTINGS_E

Screen Lock:
$SCREEN_LOCK_E

Admin Group Membership:
$ADMIN_GROUP_INFO_E

Passwordless Sudo:
$PASSWORDLESS_SUDO_E

SSH Configuration:
$SSH_SUMMARY_E

Auditd:
$AUDITD_STATUS_E
</pre>

<h2>Network - Open Ports</h2>
<pre>$OPEN_PORTS_E</pre>

<h2>Network Adapters & DNS</h2>
<pre>
$NET_ADAPTERS_E

Default Gateway: $DEFAULT_GATEWAY_E
DNS Servers: $DNS_SERVERS_E
</pre>

<h2>Network Shares (Samba / NFS)</h2>
<pre>
Samba shares:
$SAMBA_SHARES_E

NFS exports:
$NFS_SHARES_E

SMB minimum protocol:
$SMB_MIN_PROTOCOL_E
</pre>

<h2>Remote Desktop Exposure</h2>
<pre>$REMOTE_ACCESS_E</pre>

<h2>Local User Accounts &amp; Password Aging</h2>
<pre>$LOCAL_USERS_TABLE_E</pre>

<h2>Running Services (first 50)</h2>
<pre>$RUNNING_SERVICES_E</pre>

<h2>Enabled Services (start on boot)</h2>
<pre>$ENABLED_SERVICES_E</pre>

<h2>Systemd Timers (Scheduled Tasks)</h2>
<pre>$SYSTEMD_TIMERS_E</pre>

<h2>Startup Items - rc.local &amp; XDG Autostart</h2>
<pre>
/etc/rc.local:
$RC_LOCAL_E

XDG autostart entries:
$XDG_AUTOSTART_E
</pre>

<h2>Failed Services</h2>
<pre>$FAILED_SERVICES_E</pre>

<h2>Failed Logins (last 20)</h2>
<pre>$FAILED_LOGINS_E</pre>

<h2>USB Devices</h2>
<pre>$USB_DEVICES_E</pre>

<h2>USB Storage Module Status</h2>
<pre>$USB_STORAGE_E</pre>

<h2>Installed Software (first 100)</h2>
<pre>$SOFTWARE_LIST_E</pre>

<h2>Browser Extensions (all users)</h2>
<pre>$BROWSER_DATA_E</pre>

<h2>World-Writable Files (first 20, same filesystem)</h2>
<pre>$WORLD_WRITABLE_FILES_E</pre>

<h2>World-Writable Directories Without Sticky Bit (privilege escalation risk)</h2>
<pre>$WORLD_WRITABLE_DIRS_E</pre>

<h2>SUID Files (first 30, same filesystem)</h2>
<pre>$SUID_FILES_E</pre>

<h2>SGID Files (first 30, same filesystem)</h2>
<pre>$SGID_FILES_E</pre>

<h2>Cron Jobs</h2>
<pre>
User crontab:
$CRON_JOBS_E

System cron directories:
$SYSTEM_CRON_E
</pre>

<h2>Audit Rules (auditctl)</h2>
<pre>$AUDIT_RULES_E</pre>

<h2>Log Retention (journald)</h2>
<pre>$LOG_RETENTION_E</pre>

</body>
</html>
EOF

echo ""
echo "=================================================="
echo " SECURITY AUDIT COMPLETED"
echo "=================================================="
echo ""
echo "Hostname    : $HOSTNAME"
echo "HTML Report : $REPORT_FILE"
echo "CSV Folder  : $CSV_DIR"
echo ""

# ============================================================
# CSV EXPORTS (mirrors the Windows script's CSV export feature)
# ============================================================

{
    echo "Check,Result,Detail"
    echo "$SCORECARD_ROWS" | sed -E 's/<tr><td>(.*)<\/td><td><span class="[a-z]+">([A-Za-z]+)<\/span><\/td><td>(.*)<\/td><\/tr>/"\1","\2","\3"/'
} > "$CSV_DIR/scorecard.csv" 2>/dev/null

echo "$SOFTWARE_LIST" > "$CSV_DIR/installed_software.txt" 2>/dev/null
echo "$OPEN_PORTS" > "$CSV_DIR/open_ports.txt" 2>/dev/null
echo "$RUNNING_SERVICES" > "$CSV_DIR/running_services.txt" 2>/dev/null
echo "$SYSTEMD_TIMERS" > "$CSV_DIR/systemd_timers.txt" 2>/dev/null
echo "$LOCAL_USERS_TABLE" | tr '|' ',' > "$CSV_DIR/local_users.csv" 2>/dev/null

echo "CSV Exports Saved At:"
echo "$CSV_DIR"
echo ""

# ============================================================
# UPLOAD HTML REPORT TO FILEBASE S3-COMPATIBLE STORAGE
# ============================================================

# Get MAC address for linking to EndpointStatus
MAC_ADDRESS=$(ip link show | grep -oP '(?<=link/ether\s)[a-fA-F0-9:]+' | head -1)
MAC_ADDRESS="${MAC_ADDRESS:-N/A}"

echo "=================================================="
echo " UPLOADING REPORT TO FILEBASE"
echo "=================================================="
echo "MAC Address: $MAC_ADDRESS"
echo ""

# ─────────────────────────────────────────────────────────
# FILEBASE S3-COMPATIBLE UPLOAD
# ─────────────────────────────────────────────────────────

echo "[1/1] Uploading to Filebase..."

# Filebase configuration (from environment or defaults)
# B2 credentials
B2_APPLICATION_KEY_ID="${B2_APPLICATION_KEY_ID}"
B2_APPLICATION_KEY="${B2_APPLICATION_KEY}"
B2_BUCKET="${B2_BUCKET:-Endpoint-Dashboard}"

# Check if credentials are set
if [ -z "$B2_APPLICATION_KEY_ID" ] || [ -z "$B2_APPLICATION_KEY" ]; then
    echo "  ✗ B2 credentials not configured in environment"
    echo "  ⚠️  Set B2_APPLICATION_KEY_ID and B2_APPLICATION_KEY in /etc/default/endpoint-heartbeat"
    UPLOAD_SUCCESS=0
else
    # Use B2 CLI to upload
    B2_CMD="/root/.local/bin/b2"
    
    if [ -f "$B2_CMD" ]; then
        # Authorize first (required before each upload)
        if $B2_CMD account authorize "$B2_APPLICATION_KEY_ID" "$B2_APPLICATION_KEY" >/dev/null 2>&1; then
            # Upload file
            if $B2_CMD file upload "$B2_BUCKET" "$REPORT_FILE" "Linux/${HOSTNAME}/$(basename "$REPORT_FILE")" 2>/dev/null; then
                echo "  ✓ Report uploaded to B2: Linux/${HOSTNAME}/$(basename "$REPORT_FILE")"
                UPLOAD_SUCCESS=1
            else
                echo "  ✗ B2 file upload failed"
                UPLOAD_SUCCESS=0
            fi
        else
            echo "  ✗ B2 account authorization failed"
            UPLOAD_SUCCESS=0
        fi
    else
        echo "  ⚠️  b2 CLI not found at $B2_CMD"
        echo "  ⚠️  Install it with: sudo apt-get install pipx && sudo pipx install b2"
        UPLOAD_SUCCESS=0
    fi
fi

echo ""
echo "=================================================="
echo " AUDIT REPORT UPLOAD SUMMARY"
echo "=================================================="
echo "Machine ID : $HOSTNAME"
echo "MAC Address: $MAC_ADDRESS"
echo "Report File: $(basename "$REPORT_FILE")"
echo ""
echo "B2 Cloud   : $([ $UPLOAD_SUCCESS -eq 1 ] && echo "✓ Success" || echo "✗ Failed")"
echo ""
echo "=================================================="
echo ""
