#!/bin/bash
# Endpoint Sentinel macOS security and inventory audit.
# Generates HTML and CSV reports and uploads the HTML report to B2.

set +e
CONFIG_FILE="/Library/Application Support/EndpointAgent/endpoint-heartbeat.env"
[ -f "$CONFIG_FILE" ] && { set -a; source "$CONFIG_FILE"; set +a; }

HOSTNAME_VAL="$(scutil --get ComputerName 2>/dev/null || hostname)"
REPORT_DIR="${REPORT_DIR:-/Library/Application Support/EndpointAgent/Reports/macOS}"
mkdir -p "$REPORT_DIR" 2>/dev/null
REPORT_FILE="$REPORT_DIR/${HOSTNAME_VAL}.html"
CSV_DIR="$REPORT_DIR/${HOSTNAME_VAL}_CSV"
rm -rf "$CSV_DIR"; mkdir -p "$CSV_DIR"

html_escape() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }
safe() { local result; result=$(eval "$1" 2>/dev/null); [ -n "$result" ] && printf '%s' "$result" || printf '%s' "${2:-Unavailable}"; }
add_score() { SCORECARD_ROWS="${SCORECARD_ROWS}<tr><td>$(html_escape "$1")</td><td>$2</td><td>$(html_escape "$3")</td></tr>"$'\n'; }

OS_NAME="$(sw_vers -productName 2>/dev/null) $(sw_vers -productVersion 2>/dev/null)"
KERNEL="$(uname -r)"; ARCH="$(uname -m)"; CPU="$(sysctl -n machdep.cpu.brand_string 2>/dev/null)"
CPU_CORES="$(sysctl -n hw.ncpu 2>/dev/null)"
CPU_INFO="${CPU_CORES:-0} cores - ${CPU:-Unknown}"
RAM="$(sysctl -n hw.memsize 2>/dev/null | awk '{printf "%.1f GB", $1/1073741824}')"
IPADDR="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)"
[ -z "$IPADDR" ] && IPADDR="$(ifconfig | awk '/inet / && $2 != "127.0.0.1" {print $2; exit}')"
MACADDR="$(ifconfig | awk '/ether / {print toupper($2); exit}')"
UPTIME="$(uptime 2>/dev/null | sed 's/^.* up /up /')"
DISK_USAGE="$(df -h / 2>/dev/null | tail -1)"

FIREWALL_STATUS="$(/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate 2>/dev/null)"
FIREWALL_ACTIVE="$(echo "$FIREWALL_STATUS" | grep -qi enabled && echo Pass || echo Warn)"
add_score "Application Firewall" "$FIREWALL_ACTIVE" "$FIREWALL_STATUS"

FILEVAULT_STATUS="$(fdesetup status 2>/dev/null)"
FILEVAULT_RESULT="$(echo "$FILEVAULT_STATUS" | grep -qi on && echo Pass || echo Warn)"
add_score "FileVault" "$FILEVAULT_RESULT" "$FILEVAULT_STATUS"

SECURE_BOOT="$(system_profiler SPiBridgeDataType 2>/dev/null | grep -i 'secure boot' | head -1)"
[ -z "$SECURE_BOOT" ] && SECURE_BOOT="Managed by Apple silicon firmware or unavailable"
TPM_STATUS="Apple Secure Enclave / TPM equivalent: hardware-dependent"
add_score "Secure Boot" "Info" "$SECURE_BOOT"
add_score "TPM" "Info" "$TPM_STATUS"

AV_STATUS="$(pgrep -ifl 'xprotect|malwarebytes|crowdstrike|sentinelone' 2>/dev/null | head -5)"
if [ -z "$AV_STATUS" ]; then
    AV_STATUS="Apple XProtect is managed by macOS; third-party EDR not detected"
    add_score "Antivirus / EDR" "Info" "$AV_STATUS"
else
    add_score "Antivirus / EDR" Pass "$AV_STATUS"
fi

SSH_STATUS="$(launchctl print system/com.openssh.sshd 2>/dev/null | head -1)"
[ -z "$SSH_STATUS" ] && SSH_STATUS="OpenSSH service not active"
SSH_RESULT="$(echo "$SSH_STATUS" | grep -qi 'not active' && echo Pass || echo Warn)"
add_score "SSH" "$SSH_RESULT" "$SSH_STATUS"

PASSWORDLESS_SUDO_STATUS="$(grep -RhsE '^[[:space:]]*[^#].*NOPASSWD' /etc/sudoers /etc/sudoers.d 2>/dev/null | head -5)"
if [ -n "$PASSWORDLESS_SUDO_STATUS" ]; then
    add_score "Passwordless Sudo" Warn "$PASSWORDLESS_SUDO_STATUS"
else
    add_score "Passwordless Sudo" Pass "No passwordless sudo entries found"
fi

AUDITD_STATUS="$(launchctl print system/com.apple.auditd 2>/dev/null | head -1)"
[ -z "$AUDITD_STATUS" ] && AUDITD_STATUS="macOS audit subsystem status unavailable"
add_score "Auditd" Info "$AUDITD_STATUS"

SIP_STATUS="$(csrutil status 2>/dev/null)"
[ -z "$SIP_STATUS" ] && SIP_STATUS="System Integrity Protection status unavailable"
SIP_RESULT="$(echo "$SIP_STATUS" | grep -qi enabled && echo Pass || echo Warn)"
add_score "System Integrity Protection" "$SIP_RESULT" "$SIP_STATUS"

GATEKEEPER_STATUS="$(spctl --status 2>/dev/null)"
[ -z "$GATEKEEPER_STATUS" ] && GATEKEEPER_STATUS="Gatekeeper status unavailable"
GATEKEEPER_RESULT="$(echo "$GATEKEEPER_STATUS" | grep -qi enabled && echo Pass || echo Warn)"
add_score "Gatekeeper" "$GATEKEEPER_RESULT" "$GATEKEEPER_STATUS"

REMOTE_ACCESS="$(pgrep -ifl 'screensharing|ardagent|vnc' 2>/dev/null | head -5)"
[ -z "$REMOTE_ACCESS" ] && REMOTE_ACCESS="No active remote desktop process detected"

PENDING_UPDATES="$(softwareupdate -l 2>/dev/null | grep -c '^ *\*' 2>/dev/null)"
[ "$PENDING_UPDATES" -eq 0 ] 2>/dev/null && add_score "Pending macOS Updates" Pass "No updates reported" || add_score "Pending macOS Updates" Warn "${PENDING_UPDATES:-Unknown} update(s) reported"
SOFTWARE_LIST="$(system_profiler SPApplicationsDataType 2>/dev/null | grep -E '^ +Location:|^ +Version:' | head -100)"
RUNNING_SERVICES="$(launchctl list 2>/dev/null | head -50)"
OPEN_PORTS="$(netstat -anv -p tcp 2>/dev/null | grep LISTEN | head -50)"
STARTUP_ITEMS="$(find /Library/LaunchAgents /Library/LaunchDaemons "$HOME/Library/LaunchAgents" -maxdepth 1 -type f 2>/dev/null | head -50)"
USB_DEVICES="$(system_profiler SPUSBDataType 2>/dev/null | head -80)"
LOG_RETENTION="$(log show --info --last 1d 2>/dev/null | tail -1)"

cat > "$REPORT_FILE" <<EOF
<html><head><title>Endpoint Sentinel macOS Audit</title><style>body{font-family:Arial;margin:24px;background:#f4f7f8;color:#17202a}h1{background:#161f2a;color:#6ce8dd;padding:20px}h2{color:#265c63;border-bottom:2px solid #29beb8;padding-bottom:6px}table{width:100%;border-collapse:collapse;background:white}th,td{padding:8px;border:1px solid #d8e1e3;text-align:left}th{background:#265c63;color:white}pre{white-space:pre-wrap;background:white;padding:12px;border:1px solid #d8e1e3}.pass{color:green}.warn{color:#a66b00}</style></head><body>
<h1>ENDPOINT SENTINEL<br><small>macOS Security & Inventory Audit</small></h1>
<p><b>Generated:</b> $(date) &nbsp; <b>Host:</b> $(html_escape "$HOSTNAME_VAL") &nbsp; <b>MAC:</b> $(html_escape "$MACADDR")</p>
<h2>Security Scorecard</h2><table><tr><th>Check</th><th>Result</th><th>Detail</th></tr>$SCORECARD_ROWS</table>
<h2>System Information</h2><table>
<tr><th>Parameter</th><th>Value</th></tr>
<tr><td>Hostname</td><td>$(html_escape "$HOSTNAME_VAL")</td></tr>
<tr><td>OS</td><td>$(html_escape "$OS_NAME")</td></tr>
<tr><td>Kernel</td><td>$(html_escape "$KERNEL")</td></tr>
<tr><td>Architecture</td><td>$(html_escape "$ARCH")</td></tr>
<tr><td>CPU</td><td>$(html_escape "$CPU_INFO")</td></tr>
<tr><td>RAM</td><td>$(html_escape "$RAM")</td></tr>
<tr><td>IP Address</td><td>$(html_escape "$IPADDR")</td></tr>
<tr><td>MAC Address</td><td>$(html_escape "$MACADDR")</td></tr>
<tr><td>Uptime</td><td>$(html_escape "$UPTIME")</td></tr>
<tr><td>Disk Usage</td><td>$(html_escape "$DISK_USAGE")</td></tr>
</table>
<h2>Security Controls</h2><pre>Firewall:
$(html_escape "$FIREWALL_STATUS")

FileVault:
$(html_escape "$FILEVAULT_STATUS")

Secure Boot:
$(html_escape "$SECURE_BOOT")

TPM / Secure Enclave:
$(html_escape "$TPM_STATUS")

Antivirus / EDR:
$(html_escape "$AV_STATUS")
</pre>
<h2>Network & Access</h2><pre>Open ports:
$(html_escape "$OPEN_PORTS")

SSH:
$(html_escape "$SSH_STATUS")

Remote access:
$(html_escape "$REMOTE_ACCESS")
</pre>
<h2>Services, Startup & Devices</h2><pre>Running services:
$(html_escape "$RUNNING_SERVICES")

Startup items:
$(html_escape "$STARTUP_ITEMS")

USB devices:
$(html_escape "$USB_DEVICES")

Installed software:
$(html_escape "$SOFTWARE_LIST")
</pre>
<h2>Log Retention</h2><pre>$(html_escape "$LOG_RETENTION")</pre>
</body></html>
EOF

printf 'Check,Result,Detail\n%s' "$SCORECARD_ROWS" > "$CSV_DIR/scorecard.csv"
printf '%s\n' "$SOFTWARE_LIST" > "$CSV_DIR/installed_software.txt"
printf '%s\n' "$RUNNING_SERVICES" > "$CSV_DIR/running_services.txt"
printf '%s\n' "$OPEN_PORTS" > "$CSV_DIR/open_ports.txt"
printf '%s\n' "$STARTUP_ITEMS" > "$CSV_DIR/startup_items.txt"
printf '%s\n' "$USB_DEVICES" > "$CSV_DIR/usb_devices.txt"
printf '%s\n' "Hostname,OS,IP,MAC,CPU,RAM,Disk,Firewall,FileVault,Pending Updates" "\"$HOSTNAME_VAL\",\"$OS_NAME\",\"$IPADDR\",\"$MACADDR\",\"$CPU_INFO\",\"$RAM\",\"$DISK_USAGE\",\"$FIREWALL_STATUS\",\"$FILEVAULT_STATUS\",\"$PENDING_UPDATES\"" > "$CSV_DIR/system_inventory.csv"

if [ -n "${B2_APPLICATION_KEY_ID:-}" ] && [ -n "${B2_APPLICATION_KEY:-}" ] && [ -x "${B2_CMD:-}" ]; then
    "$B2_CMD" account authorize "$B2_APPLICATION_KEY_ID" "$B2_APPLICATION_KEY" >/dev/null 2>&1 && \
    "$B2_CMD" file upload "${B2_BUCKET:-Endpoint-Dashboard}" "$REPORT_FILE" "macOS/$HOSTNAME_VAL/$(basename "$REPORT_FILE")" >/dev/null 2>&1
fi

echo "HTML Report: $REPORT_FILE"
echo "CSV Folder: $CSV_DIR"
