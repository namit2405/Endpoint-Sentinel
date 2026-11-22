#!/bin/bash

# =============================================================================
# heartbeat-agent.sh — Endpoint Heartbeat Agent (Linux)
#
# Runs every 20 seconds via systemd timer.
#
# Behavior:
#   - Sends heartbeat directly to Supabase PostgreSQL
#   - Updates EndpointStatus via MAC address
#   - Polls for commands; handles update_scripts by downloading and replacing
#     the agent scripts, then exiting so the timer fires the new version.
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

AGENT_VERSION="1.4"
AGENT_DIR="/opt/EndpointAgent"
SUPABASE_HELPER="${AGENT_DIR}/supabase_agent.py"
PYTHON_BIN="${AGENT_DIR}/venv/bin/python"

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

echo "Sending heartbeat to Supabase"
echo "Hostname: $HOSTNAME_VAL | IP: $IP_VAL | MAC: $MAC_VAL"

if [ ! -f "$SUPABASE_HELPER" ]; then
    echo "✗ Supabase helper not found: $SUPABASE_HELPER"
    exit 1
fi

if "$PYTHON_BIN" "$SUPABASE_HELPER" insert_heartbeat \
    --hostname "$HOSTNAME_VAL" \
    --os "$OS_VAL" \
    --ip "$IP_VAL" \
    --mac "$MAC_VAL" \
    --username "$USERNAME_VAL" \
    --version "$AGENT_VERSION" \
    $([ "$WOL_ENABLED" = "true" ] && echo "--wol" || true); then
    echo "✓ Heartbeat sent"
else
    echo "✗ Heartbeat failed"
    exit 1
fi

# =============================================================================
# Activate device with license key in Supabase
# =============================================================================

if [ -n "${LICENSE_KEY:-}" ]; then
    echo "Activating device with license..."
    if "$PYTHON_BIN" "$SUPABASE_HELPER" activate_license \
        --license-key "$LICENSE_KEY" \
        --mac "$MAC_VAL"; then
        echo "✓ Device activated with license"
    else
        echo "⚠  Device activation failed"
    fi
fi

# =============================================================================
# Fetch and execute pending commands
# =============================================================================

COMMANDS_JSON="$("$PYTHON_BIN" "$SUPABASE_HELPER" poll_commands --mac "$MAC_VAL" 2>/dev/null || echo '[]')"

echo "$COMMANDS_JSON" | "$PYTHON_BIN" -c 'import json, sys; [print("{}\t{}".format(c["id"], c["command"])) for c in json.load(sys.stdin)]' |
while IFS=$'\t' read -r COMMAND_ID COMMAND_TYPE; do
    [ -n "$COMMAND_ID" ] || continue
    case "$COMMAND_TYPE" in
        restart)
            if sudo -n -v 2>/dev/null; then
                "$PYTHON_BIN" "$SUPABASE_HELPER" complete_command --id "$COMMAND_ID" --status success --message "Restart initiated" >/dev/null 2>&1
                sudo -n reboot
            else
                "$PYTHON_BIN" "$SUPABASE_HELPER" complete_command --id "$COMMAND_ID" --status failed --message "Restart failed: insufficient privileges" >/dev/null 2>&1
            fi
            ;;
        shutdown)
            if sudo -n -v 2>/dev/null; then
                "$PYTHON_BIN" "$SUPABASE_HELPER" complete_command --id "$COMMAND_ID" --status success --message "Shutdown initiated" >/dev/null 2>&1
                sudo -n shutdown -h now
            else
                "$PYTHON_BIN" "$SUPABASE_HELPER" complete_command --id "$COMMAND_ID" --status failed --message "Shutdown failed: insufficient privileges" >/dev/null 2>&1
            fi
            ;;
        update_scripts)
            # ----------------------------------------------------------------
            # Self-update: download new scripts from server manifest, replace
            # the installed files, then exit so the timer fires the new version
            # ----------------------------------------------------------------
            MANIFEST_URL="${LOCAL_BASE_URL:-http://192.168.8.10:8000}/api/agent/manifest/"
            MANIFEST=$(curl -s --max-time 15 \
                -H "Authorization: Bearer ${HEARTBEAT_API_KEY:-}" \
                "$MANIFEST_URL" 2>/dev/null || echo "")

            if [ -z "$MANIFEST" ]; then
                "$PYTHON_BIN" "$SUPABASE_HELPER" complete_command --id "$COMMAND_ID" --status failed --message "Could not fetch manifest" >/dev/null 2>&1
            else
                SERVER_VERSION=$(echo "$MANIFEST" | "$PYTHON_BIN" -c 'import json,sys; d=json.load(sys.stdin); print(d.get("current_version",""))' 2>/dev/null || echo "")
                HB_URL=$(echo "$MANIFEST" | "$PYTHON_BIN" -c 'import json,sys; d=json.load(sys.stdin); print(d["scripts"]["linux"]["heartbeat"])' 2>/dev/null || echo "")
                HEALTH_URL=$(echo "$MANIFEST" | "$PYTHON_BIN" -c 'import json,sys; d=json.load(sys.stdin); print(d["scripts"]["linux"]["health"])' 2>/dev/null || echo "")
                SUPABASE_URL=$(echo "$MANIFEST" | "$PYTHON_BIN" -c 'import json,sys; d=json.load(sys.stdin); print(d["scripts"]["linux"]["supabase"])' 2>/dev/null || echo "")

                TMPDIR_UPDATE=$(mktemp -d)
                UPDATE_OK=true
                UPDATE_MSG=""

                for PAIR in "heartbeat:$HB_URL:${AGENT_DIR}/heartbeat-agent.sh" \
                            "health:$HEALTH_URL:${AGENT_DIR}/health-monitor-agent.sh" \
                            "supabase:$SUPABASE_URL:${SUPABASE_HELPER}"; do
                    LABEL=$(echo "$PAIR" | cut -d: -f1)
                    URL=$(echo "$PAIR" | cut -d: -f2)
                    DEST=$(echo "$PAIR" | cut -d: -f3)
                    TMP_FILE="${TMPDIR_UPDATE}/${LABEL}"
                    if [ -n "$URL" ]; then
                        curl -s --max-time 30 \
                            -H "Authorization: Bearer ${HEARTBEAT_API_KEY:-}" \
                            -o "$TMP_FILE" "$URL" 2>/dev/null
                        if [ -s "$TMP_FILE" ]; then
                            mv "$TMP_FILE" "$DEST" && chmod 755 "$DEST"
                            echo "✓ Updated $LABEL script"
                        else
                            UPDATE_OK=false
                            UPDATE_MSG="$UPDATE_MSG Failed to download $LABEL."
                        fi
                    fi
                done

                rm -rf "$TMPDIR_UPDATE"

                if [ "$UPDATE_OK" = "true" ]; then
                    "$PYTHON_BIN" "$SUPABASE_HELPER" complete_command --id "$COMMAND_ID" --status success \
                        --message "Scripts updated to version ${SERVER_VERSION}" >/dev/null 2>&1
                    echo "✓ Scripts updated to version ${SERVER_VERSION} — exiting for reload"
                    exit 0
                else
                    "$PYTHON_BIN" "$SUPABASE_HELPER" complete_command --id "$COMMAND_ID" --status failed \
                        --message "Partial update:${UPDATE_MSG}" >/dev/null 2>&1
                fi
            fi
            ;;
        *)
            "$PYTHON_BIN" "$SUPABASE_HELPER" complete_command --id "$COMMAND_ID" --status failed --message "Unsupported command: $COMMAND_TYPE" >/dev/null 2>&1
            ;;
    esac
done

exit 0
