#!/bin/bash
# Endpoint Sentinel macOS agent installer.
# Run: sudo bash install_endpoint_agent.sh

set -euo pipefail

AGENT_DIR="/Library/Application Support/EndpointAgent"
CONFIG_FILE="$AGENT_DIR/endpoint-heartbeat.env"
PYTHON_BIN="$AGENT_DIR/venv/bin/python3"
B2_CMD="$AGENT_DIR/venv/bin/b2"
LAUNCH_DIR="/Library/LaunchDaemons"
HEARTBEAT_PLIST="$LAUNCH_DIR/com.endpointsentinel.heartbeat.plist"
HEALTH_PLIST="$LAUNCH_DIR/com.endpointsentinel.health.plist"
AUDIT_PLIST="$LAUNCH_DIR/com.endpointsentinel.audit.plist"
AGENT_VERSION="1.3"
HEALTH_INTERVAL=120
AUDIT_HOUR="08:00"
REPORT_DIR="$AGENT_DIR/Reports/macOS"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

SUPABASE_HOST="aws-0-ap-southeast-1.pooler.supabase.com"
SUPABASE_PORT="6543"
SUPABASE_DB="postgres"
SUPABASE_USER="postgres.rzydluzduppsbjvczgfc"
SUPABASE_PASSWORD="Nm@2405#kis"
B2_APPLICATION_KEY_ID="005b92fde5a0e0c0000000001"
B2_APPLICATION_KEY="K0057HU2vqAx/t2RQwJIFevGes8JYjg"
B2_BUCKET="Endpoint-Dashboard"

[ "$(id -u)" -eq 0 ] || { echo "Run with sudo."; exit 1; }
[ "$(uname -s)" = "Darwin" ] || { echo "This installer only runs on macOS."; exit 1; }
for file in supabase_agent.py macos_audit.sh; do
    [ -f "$SCRIPT_DIR/$file" ] || { echo "Missing $file beside installer."; exit 1; }
done

BASE_PYTHON="$(command -v python3 || true)"
if [ -z "$BASE_PYTHON" ] && [ -x "/usr/bin/python3" ]; then
    BASE_PYTHON="/usr/bin/python3"
fi
MACOS_VERSION="$(sw_vers -productVersion 2>/dev/null || echo 0.0)"
MACOS_MAJOR="${MACOS_VERSION%%.*}"

# macOS can expose /usr/bin/python3 through xcrun even when the selected
# Xcode path is stale or Command Line Tools are not installed.
if [ -n "$BASE_PYTHON" ]; then
    if ! "$BASE_PYTHON" --version >/dev/null 2>&1; then
        if [ -d "/Library/Developer/CommandLineTools" ]; then
            echo "Python shim is using a broken developer path; switching to standalone Command Line Tools..."
            xcode-select --switch /Library/Developer/CommandLineTools || true
        fi
        if ! "$BASE_PYTHON" --version >/dev/null 2>&1; then
            echo "The system Python shim is unavailable; using the Python.org runtime fallback."
            BASE_PYTHON=""
        fi
    fi
fi

CONSOLE_USER="${SUDO_USER:-$(stat -f '%Su' /dev/console 2>/dev/null || true)}"
BREW_BIN="$(command -v brew || true)"
if [ -z "$BREW_BIN" ]; then
    if [ -x "/opt/homebrew/bin/brew" ]; then
        BREW_BIN="/opt/homebrew/bin/brew"
    elif [ -x "/usr/local/bin/brew" ]; then
        BREW_BIN="/usr/local/bin/brew"
    fi
fi

# Current Homebrew no longer supports Catalina. Use the official Python.org
# installer on macOS 10.x instead of invoking a doomed Homebrew upgrade.
if [ "${MACOS_MAJOR:-0}" -lt 11 ] 2>/dev/null; then
    BREW_BIN=""
fi

# The Apple-provided Python may exist but be too old for current dependency
# wheels. Require Python 3.10+ and prefer the maintained Homebrew runtime.
if [ -n "$BASE_PYTHON" ]; then
    BASE_PYTHON_VERSION="$($BASE_PYTHON -c 'import sys; print(f"{sys.version_info[0]}.{sys.version_info[1]}")' 2>/dev/null || true)"
    case "$BASE_PYTHON_VERSION" in
        3.1[0-9]|3.[2-9][0-9]) ;;
        *) BASE_PYTHON="" ;;
    esac
fi

install_python_pkg() {
    local python_version="3.12.10"
    local package_url="https://www.python.org/ftp/python/${python_version}/python-${python_version}-macos11.pkg"
    local package_file="/tmp/python-${python_version}-macos11.pkg"
    echo "Installing Python ${python_version} from Python.org for macOS ${MACOS_VERSION}..."
    curl -fL --retry 3 "$package_url" -o "$package_file"
    installer -pkg "$package_file" -target /
    rm -f "$package_file"
    for candidate in \
        "/usr/local/bin/python3.12" \
        "/Library/Frameworks/Python.framework/Versions/3.12/bin/python3.12"; do
        if [ -x "$candidate" ]; then
            BASE_PYTHON="$candidate"
            return 0
        fi
    done
    return 1
}

if [ -z "$BASE_PYTHON" ] && [ -z "$BREW_BIN" ] && [ "${MACOS_MAJOR:-0}" -ge 11 ] 2>/dev/null; then
    [ -n "$CONSOLE_USER" ] && [ "$CONSOLE_USER" != "root" ] || {
        echo "ERROR: Could not identify the logged-in macOS user for Homebrew installation."
        exit 1
    }
    echo "Python and Homebrew were not found. Installing Homebrew for $CONSOLE_USER..."
    sudo -u "$CONSOLE_USER" -H /bin/bash -c \
        'NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'

    if [ -x "/opt/homebrew/bin/brew" ]; then
        BREW_BIN="/opt/homebrew/bin/brew"
    elif [ -x "/usr/local/bin/brew" ]; then
        BREW_BIN="/usr/local/bin/brew"
    fi
fi

if [ -z "$BASE_PYTHON" ] && [ "${MACOS_MAJOR:-0}" -lt 11 ] 2>/dev/null; then
    install_python_pkg || {
        echo "ERROR: Python.org could not install Python 3.12 on this Mac."
        exit 1
    }
fi

if [ -z "$BASE_PYTHON" ] && [ -n "$BREW_BIN" ]; then
    [ -n "$CONSOLE_USER" ] && [ "$CONSOLE_USER" != "root" ] || {
        echo "ERROR: Could not identify the logged-in macOS user for Homebrew."
        exit 1
    }
    echo "Installing Homebrew Python 3.12..."
    sudo -u "$CONSOLE_USER" -H "$BREW_BIN" install python@3.12
    BREW_PYTHON_PREFIX="$(sudo -u "$CONSOLE_USER" -H "$BREW_BIN" --prefix python@3.12)"
    BASE_PYTHON="$BREW_PYTHON_PREFIX/bin/python3.12"
fi

[ -x "$BASE_PYTHON" ] || {
    echo "ERROR: Python 3.12 could not be installed automatically."
    echo "Check the Homebrew output above and rerun this installer."
    exit 1
}

mkdir -p "$AGENT_DIR" "$REPORT_DIR" "$LAUNCH_DIR"
chmod 755 "$AGENT_DIR" "$REPORT_DIR"

if [ -x "$PYTHON_BIN" ]; then
    VENV_VERSION="$($PYTHON_BIN -c 'import sys; print(f"{sys.version_info[0]}.{sys.version_info[1]}")' 2>/dev/null || true)"
    case "$VENV_VERSION" in
        3.1[0-9]|3.[2-9][0-9]) ;;
        *) echo "Replacing incompatible agent Python environment ($VENV_VERSION)..."; rm -rf "$AGENT_DIR/venv" ;;
    esac
fi

if [ ! -x "$PYTHON_BIN" ]; then
    "$BASE_PYTHON" -m venv "$AGENT_DIR/venv"
fi
"$PYTHON_BIN" -m pip install --upgrade pip setuptools wheel psycopg2-binary b2
"$PYTHON_BIN" -c 'import psycopg2, b2sdk'
[ -x "$B2_CMD" ] || { echo "B2 CLI installation failed."; exit 1; }

LICENSE_KEY="${LICENSE_KEY:-}"
while [[ ! "$LICENSE_KEY" =~ ^[A-Z0-9]{2}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$ ]]; do
    read -r -p "Enter license key (XX-XXXX-XXXX-XXXX): " LICENSE_KEY
    [[ "$LICENSE_KEY" =~ ^[A-Z0-9]{2}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$ ]] || echo "Invalid license key format."
done
export SUPABASE_HOST SUPABASE_PORT SUPABASE_DB SUPABASE_USER SUPABASE_PASSWORD
"$PYTHON_BIN" "$SCRIPT_DIR/supabase_agent.py" validate_license --license-key "$LICENSE_KEY"

umask 077
cat > "$CONFIG_FILE" <<EOF
CONFIG_VERSION="2"
REPORT_DIR="$REPORT_DIR"
HEALTH_INTERVAL=$HEALTH_INTERVAL
AUDIT_HOUR=$AUDIT_HOUR
PYTHON_BIN="$PYTHON_BIN"
B2_CMD="$B2_CMD"
LICENSE_KEY="$LICENSE_KEY"
SUPABASE_HOST="$SUPABASE_HOST"
SUPABASE_PORT="$SUPABASE_PORT"
SUPABASE_DB="$SUPABASE_DB"
SUPABASE_USER="$SUPABASE_USER"
SUPABASE_PASSWORD="$SUPABASE_PASSWORD"
B2_APPLICATION_KEY_ID="$B2_APPLICATION_KEY_ID"
B2_APPLICATION_KEY="$B2_APPLICATION_KEY"
B2_BUCKET="$B2_BUCKET"
EOF
chmod 600 "$CONFIG_FILE"
cp "$SCRIPT_DIR/supabase_agent.py" "$AGENT_DIR/supabase_agent.py"
cp "$SCRIPT_DIR/macos_audit.sh" "$AGENT_DIR/macos_audit.sh"
chmod 700 "$AGENT_DIR/supabase_agent.py" "$AGENT_DIR/macos_audit.sh"

cat > "$AGENT_DIR/heartbeat-agent.sh" <<'HEARTBEAT'
#!/bin/bash
set -u
AGENT_DIR="/Library/Application Support/EndpointAgent"
CONFIG_FILE="/Library/Application Support/EndpointAgent/endpoint-heartbeat.env"
set -a; source "$CONFIG_FILE"; set +a
HOSTNAME_VAL="$(scutil --get ComputerName 2>/dev/null || hostname)"
USERNAME_VAL="$(stat -f '%Su' /dev/console 2>/dev/null || whoami)"
OS_VAL="$(sw_vers -productName 2>/dev/null) $(sw_vers -productVersion 2>/dev/null)"
IP_VAL="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo 0.0.0.0)"
MAC_VAL="$(ifconfig | awk '/ether / {print toupper($2); exit}')"
WOL_ENABLED=false
WOL_TEXT="$(pmset -g custom 2>/dev/null | grep -i 'womp' | head -1)"
echo "$WOL_TEXT" | grep -Eq '1|on|true' && WOL_ENABLED=true
"$PYTHON_BIN" "$AGENT_DIR/supabase_agent.py" insert_heartbeat --hostname "$HOSTNAME_VAL" --os "$OS_VAL" --ip "$IP_VAL" --mac "$MAC_VAL" --username "$USERNAME_VAL" --version "1.3" $([ "$WOL_ENABLED" = true ] && echo --wol)
[ -n "${LICENSE_KEY:-}" ] && "$PYTHON_BIN" "$AGENT_DIR/supabase_agent.py" activate_license --license-key "$LICENSE_KEY" --mac "$MAC_VAL" || true
COMMANDS_JSON="$($PYTHON_BIN "$AGENT_DIR/supabase_agent.py" poll_commands --mac "$MAC_VAL" 2>/dev/null || echo '[]')"
echo "$COMMANDS_JSON" | "$PYTHON_BIN" -c 'import json,sys; [print("{}\t{}".format(x["id"],x["command"])) for x in json.load(sys.stdin)]' | while IFS=$'\t' read -r id command; do
    case "$command" in
        restart) "$PYTHON_BIN" "$AGENT_DIR/supabase_agent.py" complete_command --id "$id" --status success --message "Restart initiated"; /sbin/shutdown -r now ;;
        shutdown) "$PYTHON_BIN" "$AGENT_DIR/supabase_agent.py" complete_command --id "$id" --status success --message "Shutdown initiated"; /sbin/shutdown -h now ;;
        *) "$PYTHON_BIN" "$AGENT_DIR/supabase_agent.py" complete_command --id "$id" --status failed --message "Unsupported command: $command" ;;
    esac
done
HEARTBEAT
chmod 700 "$AGENT_DIR/heartbeat-agent.sh"

cat > "$AGENT_DIR/health-agent.sh" <<'HEALTH'
#!/bin/bash
set -u
AGENT_DIR="/Library/Application Support/EndpointAgent"
CONFIG_FILE="/Library/Application Support/EndpointAgent/endpoint-heartbeat.env"
set -a; source "$CONFIG_FILE"; set +a
HOSTNAME_VAL="$(scutil --get ComputerName 2>/dev/null || hostname)"
IP_VAL="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo 0.0.0.0)"
MAC_VAL="$(ifconfig | awk '/ether / {print toupper($2); exit}')"
CPU="$(top -l 1 -n 0 2>/dev/null | sed -n 's/.*CPU usage: \([0-9.]*\)% user.*/\1/p' | head -1)"; CPU="${CPU:-0}"
MEM="$(vm_stat 2>/dev/null | awk '/Pages active/ {a=$3} /Pages wired/ {w=$4} /Pages free/ {f=$3} END {gsub(/\./,"",a);gsub(/\./,"",w);gsub(/\./,"",f); if(a+w+f>0) printf "%.1f", ((a+w)/(a+w+f))*100}')"; MEM="${MEM:-0}"
DISK="$(df -P / 2>/dev/null | awk 'NR==2 {gsub(/%/,"",$5); print $5}')"; DISK="${DISK:-0}"
UPTIME="$(sysctl -n kern.boottime 2>/dev/null | awk -F'[ ,}]+' '{print $4}')"; NOW="$(date +%s)"; UPTIME=$((NOW - ${UPTIME:-NOW}))
"$PYTHON_BIN" "$AGENT_DIR/supabase_agent.py" insert_health --mac "$MAC_VAL" --cpu "$CPU" --mem "$MEM" --disk "$DISK" --uptime "$UPTIME" --hostname "$HOSTNAME_VAL" --ip "$IP_VAL"
HEALTH
chmod 700 "$AGENT_DIR/health-agent.sh"

cat > "$HEARTBEAT_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>com.endpointsentinel.heartbeat</string><key>ProgramArguments</key><array><string>/bin/bash</string><string>$AGENT_DIR/heartbeat-agent.sh</string></array><key>RunAtLoad</key><true/><key>StartInterval</key><integer>60</integer><key>StandardOutPath</key><string>$AGENT_DIR/heartbeat.log</string><key>StandardErrorPath</key><string>$AGENT_DIR/heartbeat.log</string></dict></plist>
EOF
cat > "$HEALTH_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>com.endpointsentinel.health</string><key>ProgramArguments</key><array><string>/bin/bash</string><string>$AGENT_DIR/health-agent.sh</string></array><key>RunAtLoad</key><true/><key>StartInterval</key><integer>$HEALTH_INTERVAL</integer><key>StandardOutPath</key><string>$AGENT_DIR/health.log</string><key>StandardErrorPath</key><string>$AGENT_DIR/health.log</string></dict></plist>
EOF
cat > "$AUDIT_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>com.endpointsentinel.audit</string><key>ProgramArguments</key><array><string>/bin/bash</string><string>$AGENT_DIR/macos_audit.sh</string></array><key>StartCalendarInterval</key><dict><key>Hour</key><integer>${AUDIT_HOUR%%:*}</integer><key>Minute</key><integer>${AUDIT_HOUR##*:}</integer></dict><key>RunAtLoad</key><false/><key>StandardOutPath</key><string>$AGENT_DIR/audit.log</string><key>StandardErrorPath</key><string>$AGENT_DIR/audit.log</string></dict></plist>
EOF

for plist in "$HEARTBEAT_PLIST" "$HEALTH_PLIST" "$AUDIT_PLIST"; do
    chmod 644 "$plist"
    launchctl bootout system "$plist" 2>/dev/null || true
    launchctl bootstrap system "$plist"
done
launchctl kickstart -k system/com.endpointsentinel.heartbeat
launchctl kickstart -k system/com.endpointsentinel.health

echo "Running direct cloud connectivity tests..."
set -a
source "$CONFIG_FILE"
set +a
if ! "$AGENT_DIR/heartbeat-agent.sh"; then
    echo "ERROR: macOS heartbeat could not write to Supabase."
    echo "Check: $AGENT_DIR/heartbeat.log"
    exit 1
fi
if ! "$AGENT_DIR/health-agent.sh"; then
    echo "ERROR: macOS health data could not write to Supabase."
    echo "Check: $AGENT_DIR/health.log"
    exit 1
fi

"$AGENT_DIR/macos_audit.sh"
echo "Endpoint Sentinel macOS installation completed."
echo "Heartbeat service:"
launchctl print system/com.endpointsentinel.heartbeat 2>/dev/null | head -12 || true
echo "Health service:"
launchctl print system/com.endpointsentinel.health 2>/dev/null | head -12 || true
echo "Endpoint Sentinel macOS installation completed."
