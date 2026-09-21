#!/bin/bash

# =============================================================================
# heartbeat.sh — Endpoint Heartbeat Agent (Linux)
#
# Runs every 1 minute via systemd timer.
#
# Behavior:
#   - Sends heartbeat to LOCAL Django server (192.168.8.10)
#   - Updates EndpointStatus via MAC address
#   - Fetches and executes commands from LOCAL server
# =============================================================================

set -u

# =============================================================================
# Configuration
# =============================================================================

AGENT_VERSION="1.2"

# LOCAL dashboard server
LOCAL_BASE_URL="${LOCAL_BASE_URL:-http://192.168.8.10:8000}"
LOCAL_HEARTBEAT_URL="${LOCAL_BASE_URL}/api/heartbeat/"
LOCAL_COMMAND_URL="${LOCAL_BASE_URL}/api/agent/commands"

# Authentication
API_KEY="${HEARTBEAT_API_KEY:?HEARTBEAT_API_KEY is not set}"

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
# Build heartbeat JSON
# =============================================================================

JSON=$(python3 - "$HOSTNAME_VAL" "$OS_VAL" "$IP_VAL" "$USERNAME_VAL" "$AGENT_VERSION" "$MAC_VAL" "$WOL_ENABLED" <<'PY'
import json, sys
hostname, os_name, ip, username, agent_version, mac, wol_enabled = sys.argv[1:]
data = {
    "hostname": hostname,
    "os": os_name,
    "ip_address": ip,
    "username": username,
    "agent_version": agent_version,
}
if mac:
    data["mac_address"] = mac
if wol_enabled == "true":
    data["wol_enabled"] = True
print(json.dumps(data))
PY
)

# =============================================================================
# Send heartbeat to LOCAL server
# =============================================================================

echo "=================================================="
echo " Sending heartbeat to LOCAL server"
echo "=================================================="
echo "URL: $LOCAL_HEARTBEAT_URL"

HTTP_CODE=$(curl -s --max-time 5 -o /dev/null -w "%{http_code}" \
    -X POST "$LOCAL_HEARTBEAT_URL" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d "$JSON" 2>/dev/null) || HTTP_CODE="000"

if [ "$HTTP_CODE" = "200" ]; then
    echo "✓ Heartbeat sent successfully"
else
    echo "✗ Heartbeat failed (HTTP $HTTP_CODE)"
    exit 1
fi

# =============================================================================
# Fetch and execute commands
# =============================================================================

CMD_RESP=$(curl -s --max-time 10 -X GET "$LOCAL_COMMAND_URL/$HOSTNAME_VAL/" \
    -H "Authorization: Bearer $API_KEY" 2>/dev/null || echo "{}")

echo "$CMD_RESP" | grep -o '"id":[[:space:]]*[0-9]*' | grep -o '[0-9]*' | while read -r CMD_ID; do
    [ -n "$CMD_ID" ] || continue

    CMD_TYPE=$(echo "$CMD_RESP" | sed -n "/\"id\":[[:space:]]*$CMD_ID/,/}/p" | \
        grep -o '"command":[[:space:]]*"[^"]*"' | head -n1 | sed 's/.*"command":[[:space:]]*"//;s/"$//')

    SUCCESS="false"
    RESULT_MSG=""

    case "$CMD_TYPE" in
        shutdown)
            if sudo -n shutdown -h +0 2>/dev/null; then
                SUCCESS="true"
                RESULT_MSG="Shutdown initiated"
            else
                RESULT_MSG="Shutdown failed"
            fi
            ;;
        restart)
            if sudo -n reboot 2>/dev/null; then
                SUCCESS="true"
                RESULT_MSG="Restart initiated"
            else
                RESULT_MSG="Restart failed"
            fi
            ;;
        *)
            RESULT_MSG="Unsupported command: $CMD_TYPE"
            ;;
    esac

    STATUS="failed"
    [ "$SUCCESS" = "true" ] && STATUS="success"

    curl -s --max-time 10 -X POST "$LOCAL_COMMAND_URL/$CMD_ID/result/" \
        -H "Authorization: Bearer $API_KEY" \
        -H "Content-Type: application/json" \
        -d "{\"status\": \"$STATUS\", \"message\": \"$RESULT_MSG\"}" \
        >/dev/null 2>&1 || true
done

exit 0

# =============================================================================
# Endpoint information
# =============================================================================

HOSTNAME_VAL=$(hostname -f 2>/dev/null || hostname)

USERNAME_VAL=$(whoami)

if [ -f /etc/os-release ]; then
    OS_VAL=$(
        grep -m1 "^PRETTY_NAME=" /etc/os-release |
        cut -d= -f2 |
        tr -d '"'
    )
else
    OS_VAL=$(uname -s -r)
fi

# -----------------------------------------------------------------------------
# IPv4 address
# -----------------------------------------------------------------------------

IP_VAL=$(
    ip -4 addr show scope global 2>/dev/null |
    grep -oP '(?<=inet\s)\d+(\.\d+){3}' |
    head -n1
)

if [ -z "$IP_VAL" ]; then
    IP_VAL=$(hostname -I 2>/dev/null | awk '{print $1}')
fi

[ -z "$IP_VAL" ] && IP_VAL="0.0.0.0"

# =============================================================================
# Collect MAC address
# =============================================================================

MAC_VAL=""

if command -v ip >/dev/null 2>&1; then

    MAC_VAL=$(
        ip -o link |
        awk '/link\/ether/ {print $17; exit}' |
        tr '[:lower:]' '[:upper:]'
    )

elif command -v ifconfig >/dev/null 2>&1; then

    MAC_VAL=$(
        ifconfig |
        grep -m1 "HWaddr\|ether" |
        awk '{print $(NF)}' |
        tr '[:lower:]' '[:upper:]'
    )

fi

# =============================================================================
# Check Wake-on-LAN
# =============================================================================

WOL_ENABLED="false"

if command -v ethtool >/dev/null 2>&1; then

    IFACE=$(
        ip -o link 2>/dev/null |
        awk '/link\/ether/ {print $2; exit}' |
        tr -d ':'
    )

    if [ -n "$IFACE" ]; then

        WOL_STATUS=$(
            ethtool "$IFACE" 2>/dev/null |
            awk '/Wake-on:/ {print $2}'
        )

        # Only "g" means Wake-on-LAN magic packet is enabled.
        if [[ "$WOL_STATUS" == *"g"* ]]; then
            WOL_ENABLED="true"
        fi

    fi

fi

# =============================================================================
# Build heartbeat JSON safely
# =============================================================================

JSON=$(
    python3 - \
        "$HOSTNAME_VAL" \
        "$OS_VAL" \
        "$IP_VAL" \
        "$USERNAME_VAL" \
        "$AGENT_VERSION" \
        "$MAC_VAL" \
        "$WOL_ENABLED" <<'PY'
import json
import sys

hostname, os_name, ip, username, agent_version, mac, wol_enabled = sys.argv[1:]

data = {
    "hostname": hostname,
    "os": os_name,
    "ip_address": ip,
    "username": username,
    "agent_version": agent_version,
}

if mac:
    data["mac_address"] = mac

if wol_enabled == "true":
    data["wol_enabled"] = True

print(json.dumps(data))
PY
)

# =============================================================================
# Send heartbeat to LOCAL AND AWS
# =============================================================================

LOCAL_SUCCESS="false"
AWS_SUCCESS="false"

echo "=================================================="
echo " Sending heartbeat"
echo "=================================================="

# -----------------------------------------------------------------------------
# LOCAL heartbeat
# -----------------------------------------------------------------------------

echo "LOCAL server: $LOCAL_HEARTBEAT_URL"

LOCAL_HTTP_CODE=$(
    curl -s \
        --max-time 5 \
        -o /dev/null \
        -w "%{http_code}" \
        -X POST "$LOCAL_HEARTBEAT_URL" \
        -H "Authorization: Bearer $API_KEY" \
        -H "Content-Type: application/json" \
        -d "$JSON" \
        2>/dev/null
) || LOCAL_HTTP_CODE="000"

if [ "$LOCAL_HTTP_CODE" = "200" ]; then
    LOCAL_SUCCESS="true"
    echo "LOCAL heartbeat: SUCCESS"
else
    echo "LOCAL heartbeat: FAILED (HTTP $LOCAL_HTTP_CODE)"
fi

# =============================================================================
# Heartbeat result
# =============================================================================

if [ "$LOCAL_SUCCESS" = "true" ]; then
    echo "Heartbeat result: SUCCESS"
else
    echo "Heartbeat result: FAILED"
    exit 1
fi

# =============================================================================
# Fetch commands
# =============================================================================

CMD_RESP=$(
    curl -s \
        --max-time 10 \
        -X GET \
        "$LOCAL_COMMAND_URL/$HOSTNAME_VAL/" \
        -H "Authorization: Bearer $API_KEY" \
        2>/dev/null || echo "{}"
)

# =============================================================================
# Parse command IDs
# =============================================================================

echo "$CMD_RESP" |
grep -o '"id":[[:space:]]*[0-9]*' |
grep -o '[0-9]*' |
while read -r CMD_ID; do

    [ -n "$CMD_ID" ] || continue

    # -------------------------------------------------------------------------
    # Extract command type
    # -------------------------------------------------------------------------

    CMD_TYPE=$(
        echo "$CMD_RESP" |
        sed -n "/\"id\":[[:space:]]*$CMD_ID/,/}/p" |
        grep -o '"command":[[:space:]]*"[^"]*"' |
        head -n1 |
        sed 's/.*"command":[[:space:]]*"//;s/"$//'
    )

    SUCCESS="false"
    RESULT_MSG=""

    # -------------------------------------------------------------------------
    # Execute command
    # -------------------------------------------------------------------------

    case "$CMD_TYPE" in

        shutdown)

            if sudo -n shutdown -h +0 2>/dev/null; then

                SUCCESS="true"
                RESULT_MSG="Shutdown initiated"

            else

                RESULT_MSG="Shutdown failed"

            fi

            ;;

        restart)

            if sudo -n reboot 2>/dev/null; then

                SUCCESS="true"
                RESULT_MSG="Restart initiated"

            else

                RESULT_MSG="Restart failed"

            fi

            ;;

        *)

            RESULT_MSG="Unsupported command: $CMD_TYPE"

            ;;

    esac

    # -------------------------------------------------------------------------
    # Build command result safely
    # -------------------------------------------------------------------------

    STATUS="failed"

    if [ "$SUCCESS" = "true" ]; then
        STATUS="success"
    fi

    RESULT_BODY=$(
        python3 \
            "$STATUS" \
            "$RESULT_MSG" <<'PY'
import json
import sys

print(json.dumps({
    "status": sys.argv[1],
    "message": sys.argv[2],
}))
PY
    )

    # -------------------------------------------------------------------------
    # Report command result to the server from which the command was obtained
    # -------------------------------------------------------------------------

    curl -s \
        --max-time 10 \
        -X POST \
        "$ACTIVE_COMMAND_URL/$CMD_ID/result/" \
        -H "Authorization: Bearer $API_KEY" \
        -H "Content-Type: application/json" \
        -d "$RESULT_BODY" \
        >/dev/null 2>&1 || true

done

# =============================================================================
# Upload audit reports
# =============================================================================

if [ -d "$REPORT_DIR" ]; then

    for REPORT_FILE in "$REPORT_DIR"/*.html; do

        [ -f "$REPORT_FILE" ] || continue

        FILENAME=$(basename "$REPORT_FILE")

        echo "=================================================="
        echo "Uploading report: $FILENAME"
        echo "=================================================="

        # ---------------------------------------------------------------------
        # Request a presigned S3 upload URL
        # ---------------------------------------------------------------------

        URL_RESPONSE=$(
            curl -s \
                --max-time 10 \
                -X POST \
                "$UPLOAD_API" \
                -H "Authorization: Bearer $API_KEY" \
                -H "Content-Type: application/json" \
                -d "$(
                    python3 \
                        "$HOSTNAME_VAL" \
                        "$FILENAME" <<'PY'
import json
import sys

print(json.dumps({
    "machine_id": sys.argv[1],
    "filename": sys.argv[2],
    "os_type": "Linux",
}))
PY
                )" \
                2>/dev/null || echo ""
        )

        # ---------------------------------------------------------------------
        # Extract presigned URL
        # ---------------------------------------------------------------------

        PRESIGNED_URL=$(
            echo "$URL_RESPONSE" |
            python3 -c '
import sys
import json

try:
    data = json.load(sys.stdin)
    print(data.get("upload_url", ""))
except Exception:
    print("")
'
        )

        if [ -n "$PRESIGNED_URL" ]; then

            HTTP_CODE=$(
                curl -s \
                    --max-time 30 \
                    -o /dev/null \
                    -w "%{http_code}" \
                    -X PUT \
                    "$PRESIGNED_URL" \
                    -H "Content-Type: text/html" \
                    --data-binary "@$REPORT_FILE" \
                    2>/dev/null || echo "000"
            )

            if [ "$HTTP_CODE" = "200" ]; then

                echo "Report uploaded successfully: $FILENAME"

                # Delete only after successful S3 upload.
                rm -f "$REPORT_FILE"

            else

                echo "Report upload failed: $FILENAME (HTTP $HTTP_CODE)"

            fi

        else

            echo "Failed to obtain presigned URL for: $FILENAME"

        fi

    done

fi

exit 0
