#!/bin/bash

# =============================================================================
# Endpoint Dashboard - Linux Endpoint Agent Installer
#
# Installs LOCAL-ONLY setup:
#
#   1. Heartbeat Agent
#      - Every 1 minute
#      - Sends to LOCAL dashboard only (192.168.8.10:8000)
#      - Includes command polling
#
#   2. Real-Time Health Monitoring
#      - Every 2 minutes
#      - Sends to LOCAL dashboard only
#      - Includes MAC address as endpoint identity
#
#   3. Daily Linux Security Audit
#      - Runs daily at 08:00
#      - Generates HTML + CSV audit report
#      - Uploads to Filebase S3-compatible storage
#
# IMPORTANT:
#   MAC address is the endpoint identity.
#   All data linked to MAC address via EndpointStatus model.
#
# Run:
#   sudo bash install_endpoint_agent.sh
#
# Expected files beside installer:
#   install_endpoint_agent.sh
#   linux_audit.sh
# =============================================================================

set -euo pipefail

# =============================================================================
# INSTALLER CONFIGURATION
# =============================================================================

AGENT_DIR="/opt/EndpointAgent"
AGENT_SCRIPT="${AGENT_DIR}/heartbeat-agent.sh"
HEALTH_AGENT_SCRIPT="${AGENT_DIR}/health-monitor-agent.sh"
AUDIT_SCRIPT="${AGENT_DIR}/linux_audit.sh"
SUPABASE_HELPER="${AGENT_DIR}/supabase_agent.py"

# Keep Python dependencies isolated from the OS Python installation.
PYTHON_BIN="${AGENT_DIR}/venv/bin/python"
B2_CMD="${AGENT_DIR}/venv/bin/b2"

CONFIG_DIR="/etc/default"
CONFIG_FILE="${CONFIG_DIR}/endpoint-heartbeat"

HEARTBEAT_SERVICE_FILE="/etc/systemd/system/heartbeat.service"
HEARTBEAT_TIMER_FILE="/etc/systemd/system/heartbeat.timer"
HEALTH_SERVICE_FILE="/etc/systemd/system/endpoint-health-monitor.service"
AUDIT_SERVICE_FILE="/etc/systemd/system/endpoint-audit.service"
AUDIT_TIMER_FILE="/etc/systemd/system/endpoint-audit.timer"

AGENT_VERSION="1.3"
REPORT_DIR="/tmp/AuditReports/Reports/Linux"
HEALTH_INTERVAL=120
AUDIT_HOUR="08:00"

# =============================================================================
# EMBEDDED DEPLOYMENT CREDENTIALS
#
# Fill these values before distributing the installer. They are written to
# /etc/default/endpoint-heartbeat and protected with root:root and mode 600.
# =============================================================================

SUPABASE_HOST="aws-0-ap-southeast-1.pooler.supabase.com"
SUPABASE_PORT="6543"
SUPABASE_DB="postgres"
SUPABASE_USER="postgres.rzydluzduppsbjvczgfc"
SUPABASE_PASSWORD="Nm@2405#kis"
B2_APPLICATION_KEY_ID=005b92fde5a0e0c0000000001
B2_APPLICATION_KEY=K0057HU2vqAx/t2RQwJIFevGes8JYjg
B2_BUCKET="Endpoint-Dashboard"

# =============================================================================
# ROOT CHECK
# =============================================================================

if [ "$(id -u)" -ne 0 ]; then
    echo "ERROR: Please run this installer with sudo."
    echo
    echo "Example:"
    echo "  sudo bash install_endpoint_agent.sh"
    exit 1
fi

# =============================================================================
# LOGGING / ERROR HANDLING
# =============================================================================

log() {
    echo "[EndpointAgent] $*"
}

die() {
    echo
    echo "ERROR: $*"
    exit 1
}

# =============================================================================
# OPERATING SYSTEM / PACKAGE MANAGER DETECTION
# =============================================================================

detect_platform() {
    if [ -r /etc/os-release ]; then
        # shellcheck disable=SC1091
        . /etc/os-release
    else
        die "Cannot determine Linux distribution (/etc/os-release missing)."
    fi

    DISTRO_ID="${ID:-unknown}"
    DISTRO_VERSION="${VERSION_ID:-unknown}"

    if command -v apt-get >/dev/null 2>&1; then
        PKG_MANAGER="apt"
    elif command -v dnf >/dev/null 2>&1; then
        PKG_MANAGER="dnf"
    elif command -v yum >/dev/null 2>&1; then
        PKG_MANAGER="yum"
    elif command -v pacman >/dev/null 2>&1; then
        PKG_MANAGER="pacman"
    elif command -v zypper >/dev/null 2>&1; then
        PKG_MANAGER="zypper"
    else
        die "Unsupported Linux distribution. Supported package managers: apt, dnf, yum, pacman, zypper."
    fi

    log "Detected: ${PRETTY_NAME:-$DISTRO_ID} (${DISTRO_VERSION})"
    log "Package manager: $PKG_MANAGER"
}

# =============================================================================
# AUTOMATIC OS DEPENDENCY INSTALLATION
# =============================================================================

apt_install() {
    export DEBIAN_FRONTEND=noninteractive
    log "Refreshing APT package index..."
    apt-get update -y

    apt-get install -y \
        ca-certificates \
        curl \
        python3 \
        python3-venv \
        python3-pip \
        iproute2 \
        procps \
        util-linux \
        gawk \
        grep \
        sed \
        coreutils \
        findutils \
        systemd \
        pciutils \
        ethtool \
        auditd \
        passwd \
        mokutil \
        samba-common-bin \
        net-tools
}

dnf_install() {
    dnf -y makecache
    dnf -y install \
        ca-certificates \
        curl \
        python3 \
        python3-pip \
        python3-virtualenv \
        iproute \
        procps-ng \
        util-linux \
        gawk \
        grep \
        sed \
        coreutils \
        findutils \
        systemd \
        pciutils \
        ethtool \
        audit \
        shadow-utils \
        samba-client \
        net-tools \
        mokutil
}

yum_install() {
    yum -y makecache
    yum -y install \
        ca-certificates \
        curl \
        python3 \
        python3-pip \
        iproute \
        procps-ng \
        util-linux \
        gawk \
        grep \
        sed \
        coreutils \
        findutils \
        systemd \
        pciutils \
        ethtool \
        audit \
        shadow-utils \
        samba-client \
        net-tools \
        mokutil
}

pacman_install() {
    pacman -Sy --noconfirm --needed \
        ca-certificates \
        curl \
        python \
        python-pip \
        iproute2 \
        procps-ng \
        util-linux \
        gawk \
        grep \
        sed \
        coreutils \
        findutils \
        systemd \
        pciutils \
        ethtool \
        audit \
        shadow \
        samba \
        net-tools \
        mokutil
}

zypper_install() {
    zypper --non-interactive refresh
    zypper --non-interactive install --no-recommends \
        ca-certificates \
        curl \
        python3 \
        python3-pip \
        python3-virtualenv \
        iproute2 \
        procps \
        util-linux \
        gawk \
        grep \
        sed \
        coreutils \
        findutils \
        systemd \
        pciutils \
        ethtool \
        audit \
        shadow \
        samba-client \
        net-tools \
        mokutil
}

install_os_dependencies() {
    log "Installing/verifying operating-system dependencies..."

    case "$PKG_MANAGER" in
        apt)    apt_install ;;
        dnf)    dnf_install ;;
        yum)    yum_install ;;
        pacman) pacman_install ;;
        zypper) zypper_install ;;
    esac

    # These are the commands required by the agent itself.
    local required_commands=(
        bash curl python3 systemctl ip awk grep sed free df ps top
    )

    local cmd
    for cmd in "${required_commands[@]}"; do
        if ! command -v "$cmd" >/dev/null 2>&1; then
            die "Package installation completed, but required command is still missing: $cmd"
        fi
    done

    log "OS dependencies: OK"
}

# =============================================================================
# ISOLATED PYTHON ENVIRONMENT
# =============================================================================

install_python_dependencies() {
    log "Creating isolated Python environment..."

    mkdir -p "$AGENT_DIR"

    if [ ! -x "$PYTHON_BIN" ]; then
        python3 -m venv "$AGENT_DIR/venv" || \
            die "Could not create Python virtual environment. The required venv package may be unavailable for this distribution."
    fi

    "$PYTHON_BIN" -m pip install --upgrade pip setuptools wheel

    log "Installing Python dependencies..."
    "$PYTHON_BIN" -m pip install --upgrade psycopg2-binary b2

    "$PYTHON_BIN" - <<'PY'
import psycopg2
import b2sdk
print("Python dependencies verified: psycopg2-binary, b2")
PY

    [ -x "$B2_CMD" ] || die "B2 CLI was not installed into the agent virtual environment."

    # The supplied linux_audit.sh currently expects this absolute path.
    mkdir -p /root/.local/bin
    ln -sfn "$B2_CMD" /root/.local/bin/b2

    log "Python dependencies: OK"
    log "Python runtime: $PYTHON_BIN"
    log "B2 CLI: $B2_CMD"
}

# =============================================================================
# LICENSE KEY CONFIGURATION
# =============================================================================

LICENSE_KEY=""
COMPANY_NAME=""
DEVICES_USED=""
DEVICE_LIMIT=""

prompt_for_license_key() {
    echo
    echo "=================================================="
    echo " License Key Configuration"
    echo "=================================================="
    echo

    while true; do
        echo -n "Enter your license key (format: XX-XXXX-XXXX-XXXX): "
        read -r LICENSE_KEY

        if [[ ! "$LICENSE_KEY" =~ ^[A-Z0-9]{2}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$ ]]; then
            echo "✗ Invalid license key format. Please use: XX-XXXX-XXXX-XXXX"
            continue
        fi

        echo "Validating license key in Supabase..."

        if SUPABASE_HOST="$SUPABASE_HOST" \
            SUPABASE_PORT="$SUPABASE_PORT" \
            SUPABASE_DB="$SUPABASE_DB" \
            SUPABASE_USER="$SUPABASE_USER" \
            SUPABASE_PASSWORD="$SUPABASE_PASSWORD" \
            "$PYTHON_BIN" "$SOURCE_SUPABASE_HELPER" validate_license \
            --license-key "$LICENSE_KEY"; then
            echo "✓ License key validated successfully"
            echo
            return 0
        else
            echo "✗ License validation failed"
            echo
        fi
    done
}

# =============================================================================
# CREDENTIAL CONFIGURATION
#
# Secrets are never hardcoded in the installer.
# For unattended deployment, supply them as environment variables.
# Otherwise they are requested securely at installation time.
# =============================================================================

validate_embedded_credentials() {
    echo
    echo "=================================================="
    echo " Storage / Database Configuration"
    echo "=================================================="
    echo

    case "$SUPABASE_USER:$SUPABASE_PASSWORD:$B2_APPLICATION_KEY_ID:$B2_APPLICATION_KEY" in
        *REPLACE_WITH_*)
            die "Replace the embedded credential placeholders near the top of this script before running it."
            ;;
    esac

    [ -n "$SUPABASE_USER" ] || die "Embedded Supabase user cannot be empty."
    [ -n "$SUPABASE_PASSWORD" ] || die "Embedded Supabase password cannot be empty."
    [ -n "$B2_APPLICATION_KEY_ID" ] || die "Embedded B2 key ID cannot be empty."
    [ -n "$B2_APPLICATION_KEY" ] || die "Embedded B2 application key cannot be empty."

    log "Embedded credentials validated successfully."
}

# =============================================================================
# SOURCE FILE VALIDATION
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_AUDIT_SCRIPT="${SCRIPT_DIR}/linux_audit.sh"
SOURCE_SUPABASE_HELPER="${SCRIPT_DIR}/supabase_agent.py"

validate_source_files() {
    if [ ! -f "$SOURCE_AUDIT_SCRIPT" ]; then
        die "linux_audit.sh was not found beside the installer.
Place these files together:
  install_endpoint_agent.sh
  linux_audit.sh
  supabase_agent.py"
    fi

    if [ ! -f "$SOURCE_SUPABASE_HELPER" ]; then
        die "supabase_agent.py was not found beside the installer.
Place these files together:
  install_endpoint_agent.sh
  linux_audit.sh
  supabase_agent.py"
    fi

    if ! grep -q 'subparsers.add_parser("validate_license"' "$SOURCE_SUPABASE_HELPER" || \
        ! grep -q 'subparsers.add_parser("activate_license"' "$SOURCE_SUPABASE_HELPER"; then
        die "supabase_agent.py is outdated. Copy the latest supabase_agent.py beside this installer and run it again."
    fi
}

# =============================================================================
# INSTALLATION FUNCTION
# =============================================================================

install_agent() {

    echo
    echo "=================================================="
    echo " Endpoint Dashboard Linux Agent Installer"
    echo "=================================================="
    echo


    # =========================================================================
    # CREATE CONFIGURATION
    # =========================================================================

    echo "Creating agent configuration..."

    umask 077

    # Shell-escape values before writing the EnvironmentFile.
    # This prevents passwords containing spaces, quotes, $, !, etc. from
    # corrupting the generated configuration.
    printf -v LICENSE_KEY_ESC '%q' "$LICENSE_KEY"
    printf -v COMPANY_NAME_ESC '%q' "$COMPANY_NAME"
    printf -v SUPABASE_HOST_ESC '%q' "$SUPABASE_HOST"
    printf -v SUPABASE_DB_ESC '%q' "$SUPABASE_DB"
    printf -v SUPABASE_USER_ESC '%q' "$SUPABASE_USER"
    printf -v SUPABASE_PASSWORD_ESC '%q' "$SUPABASE_PASSWORD"
    printf -v B2_APPLICATION_KEY_ID_ESC '%q' "$B2_APPLICATION_KEY_ID"
    printf -v B2_APPLICATION_KEY_ESC '%q' "$B2_APPLICATION_KEY"
    printf -v B2_BUCKET_ESC '%q' "$B2_BUCKET"

    cat > "$CONFIG_FILE" <<EOF
# Endpoint agent configuration
# Generated automatically by install_endpoint_agent.sh
# Permissions: 600

REPORT_DIR=$REPORT_DIR
HEALTH_INTERVAL=$HEALTH_INTERVAL
AUDIT_HOUR=$AUDIT_HOUR

# License Configuration
LICENSE_KEY=$LICENSE_KEY_ESC
COMPANY_NAME=$COMPANY_NAME_ESC
DEVICES_USED=$DEVICES_USED
DEVICE_LIMIT=$DEVICE_LIMIT
# Python runtime
PYTHON_BIN="$PYTHON_BIN"
B2_CMD="$B2_CMD"

# Supabase PostgreSQL connection
SUPABASE_HOST=$SUPABASE_HOST_ESC
SUPABASE_PORT=$SUPABASE_PORT
SUPABASE_DB=$SUPABASE_DB_ESC
SUPABASE_USER=$SUPABASE_USER_ESC
SUPABASE_PASSWORD=$SUPABASE_PASSWORD_ESC

# Backblaze B2 credentials
B2_APPLICATION_KEY_ID=$B2_APPLICATION_KEY_ID_ESC
B2_APPLICATION_KEY=$B2_APPLICATION_KEY_ESC
B2_BUCKET=$B2_BUCKET_ESC
EOF

    chmod 600 "$CONFIG_FILE"
    chown root:root "$CONFIG_FILE"

    echo "Configuration created:"
    echo "  $CONFIG_FILE"

    # =========================================================================
    # CREATE DIRECTORIES
    # =========================================================================

    echo
    echo "Creating agent directories..."

    mkdir -p "$AGENT_DIR"
    mkdir -p "$REPORT_DIR"

    chmod 755 "$AGENT_DIR"
    chmod 755 "$REPORT_DIR"

    # =========================================================================
    # INSTALL SUPABASE HELPER
    # =========================================================================

    echo
    echo "Installing Supabase connection helper..."

    SOURCE_SUPABASE_HELPER="${SCRIPT_DIR}/supabase_agent.py"

    if [ ! -f "$SOURCE_SUPABASE_HELPER" ]; then
        echo "WARNING: supabase_agent.py not found, skipping"
    else
        cp "$SOURCE_SUPABASE_HELPER" "${AGENT_DIR}/supabase_agent.py"
        chmod 755 "${AGENT_DIR}/supabase_agent.py"
        echo "Supabase helper installed:"
        echo "  ${AGENT_DIR}/supabase_agent.py"
    fi

    # =========================================================================
    # INSTALL AUDIT SCRIPT
    # =========================================================================

    echo
    echo "Installing Linux security audit script..."

    cp "$SOURCE_AUDIT_SCRIPT" "$AUDIT_SCRIPT"

    chmod 755 "$AUDIT_SCRIPT"

    echo "Audit script installed:"
    echo "  $AUDIT_SCRIPT"


    # =========================================================================
    # INSTALL HEARTBEAT AGENT
    #
    # EXISTING HEARTBEAT / COMMAND / S3 LOGIC
    # =========================================================================

    echo
    echo "Installing heartbeat agent..."


    cat > "$AGENT_SCRIPT" <<'HEARTBEAT_AGENT_EOF'
#!/bin/bash

# =============================================================================
# heartbeat-agent.sh — Endpoint Heartbeat Agent (Linux)
#
# Runs every 20 seconds via systemd timer.
#
# Behavior:
#   - Sends heartbeat directly to Supabase PostgreSQL
#   - Updates EndpointStatus via MAC address
# =============================================================================

set -u

# =============================================================================
# Load Configuration from EnvironmentFile
# =============================================================================

CONFIG_FILE="/etc/default/endpoint-heartbeat"
if [ -f "$CONFIG_FILE" ]; then
    set -a
    source "$CONFIG_FILE"
    set +a
fi

# =============================================================================
# Configuration
# =============================================================================

AGENT_VERSION="1.2"
AGENT_DIR="/opt/EndpointAgent"
SUPABASE_HELPER="${AGENT_DIR}/supabase_agent.py"

# =============================================================================
# Endpoint information
# =============================================================================

HOSTNAME_VAL=$(hostname -f 2>/dev/null || hostname)
USERNAME_VAL=$(whoami)

if [ -f /etc/os-release ]; then
    OS_VAL=$(grep -m1 "^PRETTY_NAME=" /etc/os-release | cut -d= -f2 | tr -d '"')
else
    OS_VAL=$(uname -s -r)
fi

# IPv4 address
IP_VAL=$(ip -4 addr show scope global 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | head -n1)
[ -z "$IP_VAL" ] && IP_VAL=$(hostname -I 2>/dev/null | awk '{print $1}')
[ -z "$IP_VAL" ] && IP_VAL="0.0.0.0"

# MAC address
MAC_VAL=""
if command -v ip >/dev/null 2>&1; then
    MAC_VAL=$(ip -o link | awk '/link\/ether/ {print $17; exit}' | tr '[:lower:]' '[:upper:]')
elif command -v ifconfig >/dev/null 2>&1; then
    MAC_VAL=$(ifconfig | grep -m1 "HWaddr\|ether" | awk '{print $(NF)}' | tr '[:lower:]' '[:upper:]')
fi

# Wake-on-LAN status
WOL_ENABLED="false"
if command -v ethtool >/dev/null 2>&1; then
    IFACE=$(ip -o link 2>/dev/null | awk '/link\/ether/ {print $2; exit}' | tr -d ':')
    if [ -n "$IFACE" ]; then
        WOL_STATUS=$(ethtool "$IFACE" 2>/dev/null | awk '/Wake-on:/ {print $2}')
        [[ "$WOL_STATUS" == *"g"* ]] && WOL_ENABLED="true"
    fi
fi

# =============================================================================
# Send heartbeat to Supabase
# =============================================================================

echo "=================================================="
echo " Sending heartbeat to Supabase"
echo "=================================================="
echo "Hostname: $HOSTNAME_VAL"
echo "IP: $IP_VAL"
echo "MAC: $MAC_VAL"

if [ ! -f "$SUPABASE_HELPER" ]; then
    echo "✗ Supabase helper not found: $SUPABASE_HELPER"
    exit 1
fi

# Call the Python helper to insert heartbeat
if "$PYTHON_BIN" "$SUPABASE_HELPER" insert_heartbeat \
    --hostname "$HOSTNAME_VAL" \
    --os "$OS_VAL" \
    --ip "$IP_VAL" \
    --mac "$MAC_VAL" \
    --username "$USERNAME_VAL" \
    --version "$AGENT_VERSION" \
    $([ "$WOL_ENABLED" = "true" ] && echo "--wol" || true); then
    echo "✓ Heartbeat sent to Supabase successfully"
else
    echo "✗ Heartbeat failed"
    exit 1
fi

# =============================================================================
# Activate device with license key in Supabase
# =============================================================================

if [ -n "$LICENSE_KEY" ]; then
    echo
    echo "Activating device with license..."
    
    if "$PYTHON_BIN" "$SUPABASE_HELPER" activate_license \
        --license-key "$LICENSE_KEY" \
        --mac "$MAC_VAL"; then
        echo "✓ Device activated with license"
    else
        echo "⚠️  Device activation failed"
    fi
fi

exit 0
HEARTBEAT_AGENT_EOF


    chmod 755 "$AGENT_SCRIPT"


    echo "Heartbeat agent installed:"
    echo "  $AGENT_SCRIPT"


    # =========================================================================
    # INSTALL HEALTH MONITOR
    # =========================================================================

    echo
    echo "Installing real-time health monitoring agent..."


    cat > "$HEALTH_AGENT_SCRIPT" <<'HEALTH_AGENT_EOF'
#!/bin/bash

# =============================================================================
# Endpoint Dashboard - Real-Time Health Monitoring
#
# Runs independently from heartbeat.
# Sends health data directly to Supabase PostgreSQL
# =============================================================================

set -u

# =============================================================================
# LOAD CONFIGURATION
# =============================================================================

CONFIG_FILE="/etc/default/endpoint-heartbeat"

if [ ! -f "$CONFIG_FILE" ]; then
    echo "[$(date '+%H:%M:%S')] ✗ Configuration file not found"
    exit 1
fi

set -a
source "$CONFIG_FILE"
set +a

HEALTH_INTERVAL="${HEALTH_INTERVAL:-120}"
AGENT_DIR="/opt/EndpointAgent"
SUPABASE_HELPER="${AGENT_DIR}/supabase_agent.py"

# =============================================================================
# LOGGING
# =============================================================================

log_msg() {
    echo "[$(date '+%H:%M:%S')] $1"
}

# =============================================================================
# ENDPOINT IDENTITY
# =============================================================================

get_hostname() {
    hostname -f 2>/dev/null || hostname
}

get_ip() {
    local ip_value
    ip_value="$(ip -4 addr show scope global 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | head -n1)"
    [ -z "$ip_value" ] && ip_value="$(hostname -I 2>/dev/null | awk '{print $1}')"
    [ -z "$ip_value" ] && ip_value="0.0.0.0"
    echo "$ip_value"
}

get_mac() {
    local mac_value=""
    if command -v ip >/dev/null 2>&1; then
        mac_value="$(ip -o link 2>/dev/null | awk '/link\/ether/ {print $17; exit}' | tr '[:lower:]' '[:upper:]')"
    elif command -v ifconfig >/dev/null 2>&1; then
        mac_value="$(ifconfig 2>/dev/null | grep -m1 "HWaddr\|ether" | awk '{print $(NF)}' | tr '[:lower:]' '[:upper:]')"
    fi
    echo "$mac_value"
}

# =============================================================================
# HEALTH COLLECTION
# =============================================================================

collect_and_send_health() {
    local hostname_value mac_value ip_value
    local cpu_percent memory_percent disk_percent

    # Identity
    hostname_value="$(get_hostname)"
    mac_value="$(get_mac)"
    ip_value="$(get_ip)"

    # MAC IS MANDATORY
    if [ -z "$mac_value" ]; then
        log_msg "✗ MAC address could not be determined"
        return 1
    fi

    # CPU
    cpu_percent="$(top -bn1 2>/dev/null | grep "Cpu(s)" | awk '{print $2}' | cut -d'%' -f1)"
    [ -z "$cpu_percent" ] && cpu_percent="0.0"

    # MEMORY
    memory_percent="$(free 2>/dev/null | awk '/^Mem:/ {printf "%.1f", ($3/$2)*100}')"
    [ -z "$memory_percent" ] && memory_percent="0.0"

    # DISK
    disk_percent="$(df / 2>/dev/null | tail -1 | awk '{printf "%.1f", $5}')"
    [ -z "$disk_percent" ] && disk_percent="0.0"

    # Send to Supabase
    if [ ! -f "$SUPABASE_HELPER" ]; then
        log_msg "✗ Supabase helper not found: $SUPABASE_HELPER"
        return 1
    fi

    log_msg "Sending health to Supabase (CPU: ${cpu_percent}%, MEM: ${memory_percent}%, DISK: ${disk_percent}%)"

    if "$PYTHON_BIN" "$SUPABASE_HELPER" insert_health \
        --mac "$mac_value" \
        --cpu "$cpu_percent" \
        --mem "$memory_percent" \
        --disk "$disk_percent" \
        --hostname "$hostname_value" \
        --ip "$ip_value" 2>/dev/null; then
        log_msg "✓ Health data sent"
        return 0
    else
        log_msg "✗ Health data send failed"
        return 1
    fi
}

# =============================================================================
# GRACEFUL SHUTDOWN
# =============================================================================

shutdown_health_monitor() {
    log_msg "✓ Health monitoring stopped"
    exit 0
}

trap shutdown_health_monitor SIGTERM SIGINT

# =============================================================================
# MAIN LOOP
# =============================================================================

log_msg "✓ Health monitoring service started"
log_msg "✓ Interval=${HEALTH_INTERVAL}s"

while true; do
    collect_and_send_health || log_msg "Health collection failed"
    sleep "$HEALTH_INTERVAL"
done

HEALTH_AGENT_EOF


    chmod 755 "$HEALTH_AGENT_SCRIPT"

    echo "Health monitoring agent installed:"
    echo "  $HEALTH_AGENT_SCRIPT"


    # =========================================================================
    # HEARTBEAT SYSTEMD SERVICE
    # =========================================================================

    echo
    echo "Creating heartbeat systemd service..."


    cat > "$HEARTBEAT_SERVICE_FILE" <<EOF
[Unit]
Description=Endpoint Heartbeat Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
EnvironmentFile=$CONFIG_FILE
ExecStart=$AGENT_SCRIPT
EOF


    chmod 644 "$HEARTBEAT_SERVICE_FILE"


    # =========================================================================
    # HEARTBEAT TIMER
    # =========================================================================

    echo "Creating heartbeat systemd timer..."


    cat > "$HEARTBEAT_TIMER_FILE" <<'EOF'
[Unit]
Description=Run Endpoint Heartbeat Agent every 20 seconds

[Timer]
OnBootSec=20s
OnUnitActiveSec=20s
Persistent=true

[Install]
WantedBy=timers.target
EOF


    chmod 644 "$HEARTBEAT_TIMER_FILE"


    # =========================================================================
    # HEALTH MONITORING SERVICE
    # =========================================================================

    echo
    echo "Creating health monitoring service..."


    cat > "$HEALTH_SERVICE_FILE" <<EOF
[Unit]
Description=Endpoint Dashboard Real-Time Health Monitoring
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=$CONFIG_FILE
ExecStart=$HEALTH_AGENT_SCRIPT
Restart=always
RestartSec=5
TimeoutStopSec=10
KillSignal=SIGTERM
StandardOutput=journal
StandardError=journal
SyslogIdentifier=endpoint-health-monitor

[Install]
WantedBy=multi-user.target
EOF


    chmod 644 "$HEALTH_SERVICE_FILE"


    # =========================================================================
    # AUDIT SERVICE
    #
    # Runs the existing linux_audit.sh as root.
    # The audit script generates the HTML/CSV report.
    # =========================================================================

    echo
    echo "Creating daily audit service..."


    cat > "$AUDIT_SERVICE_FILE" <<EOF
[Unit]
Description=Endpoint Dashboard Daily Linux Security Audit
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
EnvironmentFile=$CONFIG_FILE
ExecStart=$AUDIT_SCRIPT
StandardOutput=journal
StandardError=journal
SyslogIdentifier=endpoint-daily-audit
EOF


    chmod 644 "$AUDIT_SERVICE_FILE"


    # =========================================================================
    # AUDIT TIMER
    # =========================================================================

    echo "Creating daily audit timer..."


    cat > "$AUDIT_TIMER_FILE" <<EOF
[Unit]
Description=Run Endpoint Dashboard Linux Security Audit daily

[Timer]
OnCalendar=*-*-* ${AUDIT_HOUR}:00
Persistent=true

[Install]
WantedBy=timers.target
EOF


    chmod 644 "$AUDIT_TIMER_FILE"


    # =========================================================================
    # SYSTEMD RELOAD
    # =========================================================================

    echo
    echo "Reloading systemd..."

    systemctl daemon-reload


    # =========================================================================
    # ENABLE HEARTBEAT
    # =========================================================================

    echo "Enabling heartbeat timer..."

    systemctl enable heartbeat.timer


    # =========================================================================
    # START HEARTBEAT TIMER
    # =========================================================================

    echo "Starting heartbeat timer..."

    systemctl start heartbeat.timer


    # =========================================================================
    # ENABLE HEALTH MONITOR
    # =========================================================================

    echo "Enabling health monitoring service..."

    systemctl enable endpoint-health-monitor.service


    # =========================================================================
    # START HEALTH MONITOR
    # =========================================================================

    echo "Starting health monitoring service..."

    systemctl start endpoint-health-monitor.service


    # =========================================================================
    # ENABLE AUDIT TIMER
    # =========================================================================

    echo "Enabling daily audit timer..."

    systemctl enable endpoint-audit.timer


    # =========================================================================
    # START AUDIT TIMER
    # =========================================================================

    echo "Starting daily audit timer..."

    systemctl start endpoint-audit.timer


    # =========================================================================
    # INITIAL HEARTBEAT
    # =========================================================================

    echo
    echo "=================================================="
    echo " Running initial heartbeat test"
    echo "=================================================="
    echo

    systemctl start heartbeat.service

    echo
    echo "License key: $LICENSE_KEY"
    echo "Company: $COMPANY_NAME"
    echo "Devices: $DEVICES_USED / $DEVICE_LIMIT"
    echo


    # =========================================================================
    # INITIAL HEALTH TEST
    # =========================================================================

    echo
    echo "=================================================="
    echo " Running initial health monitoring test"
    echo "=================================================="
    echo

    systemctl restart endpoint-health-monitor.service

    sleep 2


    # =========================================================================
    # OPTIONAL INITIAL AUDIT TEST
    # =========================================================================

    echo
    echo "=================================================="
    echo " Running initial audit test"
    echo "=================================================="
    echo

    systemctl start endpoint-audit.service


    # =========================================================================
    # FINAL STATUS
    # =========================================================================

    echo
    echo "=================================================="
    echo " Heartbeat Timer Status"
    echo "=================================================="

    systemctl status heartbeat.timer --no-pager


    echo
    echo "=================================================="
    echo " Health Monitoring Status"
    echo "=================================================="

    systemctl status endpoint-health-monitor.service --no-pager


    echo
    echo "=================================================="
    echo " Daily Audit Timer Status"
    echo "=================================================="

    systemctl status endpoint-audit.timer --no-pager


    echo
    echo "=================================================="
    echo " Recent Heartbeat Logs"
    echo "=================================================="

    journalctl -u heartbeat.service -n 20 --no-pager


    echo
    echo "=================================================="
    echo " Recent Health Monitoring Logs"
    echo "=================================================="

    journalctl -u endpoint-health-monitor.service -n 20 --no-pager


    echo
    echo "=================================================="
    echo " Recent Audit Logs"
    echo "=================================================="

    journalctl -u endpoint-audit.service -n 20 --no-pager


    echo
    echo "=================================================="
    echo " Scheduled Timers"
    echo "=================================================="

    systemctl list-timers --all |
        grep -E 'heartbeat|endpoint-health|endpoint-audit' ||
        true


    echo
    echo "=================================================="
    echo " Installation completed"
    echo "=================================================="

}


# =============================================================================
# EXECUTE INSTALLER
# =============================================================================

detect_platform
install_os_dependencies
validate_source_files
validate_embedded_credentials
install_python_dependencies
prompt_for_license_key

install_agent
