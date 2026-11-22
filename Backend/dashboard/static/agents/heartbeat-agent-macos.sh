#!/bin/bash
# =============================================================================
# heartbeat-agent.sh — Endpoint Heartbeat Agent (macOS)
#
# Runs every 1 minute via LaunchDaemon.
# Sends heartbeat to LOCAL Django API, polls for commands.
# Handles update_scripts by downloading new scripts from server manifest.
# =============================================================================

AGENT_VERSION="1.4"
SERVER="${LOCAL_BASE_URL:-http://192.168.8.10:8000}/api/heartbeat/"
API_KEY="${HEARTBEAT_API_KEY:?HEARTBEAT_API_KEY is not set}"
COMMAND_SERVER="${LOCAL_BASE_URL:-http://192.168.8.10:8000}/api/agent/commands"
MANIFEST_URL="${LOCAL_BASE_URL:-http://192.168.8.10:8000}/api/agent/manifest/"
AGENT_DIR="/Library/Application Support/EndpointAgent"

HOSTNAME_VAL=$(scutil --get ComputerName 2>/dev/null || hostname)
USERNAME_VAL=$(whoami)
OS_NAME=$(sw_vers -productName 2>/dev/null || echo "macOS")
OS_VER=$(sw_vers -productVersion 2>/dev/null || echo "")
OS_VAL="$OS_NAME $OS_VER"

IP_VAL=$(ipconfig getifaddr en0 2>/dev/null)
[ -z "$IP_VAL" ] && IP_VAL=$(ipconfig getifaddr en1 2>/dev/null)
[ -z "$IP_VAL" ] && IP_VAL=$(ifconfig | grep "inet " | grep -v "127.0.0.1" | awk '{print $2}' | head -n1)
[ -z "$IP_VAL" ] && IP_VAL="0.0.0.0"

MAC_VAL=$(ifconfig | grep -m1 "ether" | awk '{print $2}' | tr '[:lower:]' '[:upper:]')

WOL_ENABLED="false"
if command -v pmset &>/dev/null; then
    if pmset -g | grep -q "womp.*1"; then
        WOL_ENABLED="true"
    fi
fi

JSON="{\"hostname\":\"$HOSTNAME_VAL\",\"os\":\"$OS_VAL\",\"ip_address\":\"$IP_VAL\",\"username\":\"$USERNAME_VAL\",\"agent_version\":\"$AGENT_VERSION\""
[ -n "$MAC_VAL" ] && JSON="$JSON,\"mac_address\":\"$MAC_VAL\""
[ "$WOL_ENABLED" = "true" ] && JSON="$JSON,\"wol_enabled\":true"
JSON="$JSON}"

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 \
    -X POST "$SERVER" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d "$JSON")

[ "$HTTP_CODE" != "200" ] && exit 1

CMD_RESP=$(curl -s --max-time 10 \
    -X GET "$COMMAND_SERVER/$HOSTNAME_VAL/" \
    -H "Authorization: Bearer $API_KEY")

echo "$CMD_RESP" | grep -oP '"id":\K[0-9]+' 2>/dev/null | while read -r CMD_ID; do
    CMD_TYPE=$(echo "$CMD_RESP" | python3 -c "
import json,sys
d=json.load(sys.stdin)
cmds=d.get('commands',d) if isinstance(d,dict) else d
for c in (cmds if isinstance(cmds,list) else []):
    if str(c.get('id',''))==sys.argv[1]:
        print(c.get('command',''))
        break
" "$CMD_ID" 2>/dev/null)

    SUCCESS=false
    RESULT_MSG=""

    case "$CMD_TYPE" in
        shutdown)
            if osascript -e 'tell application "System Events" to shut down' 2>/dev/null; then
                SUCCESS=true; RESULT_MSG="Shutdown initiated"
            else
                RESULT_MSG="Shutdown failed"
            fi
            ;;
        restart)
            if osascript -e 'tell application "System Events" to restart' 2>/dev/null; then
                SUCCESS=true; RESULT_MSG="Restart initiated"
            else
                RESULT_MSG="Restart failed"
            fi
            ;;
        update_scripts)
            MANIFEST=$(curl -s --max-time 15 \
                -H "Authorization: Bearer $API_KEY" \
                "$MANIFEST_URL" 2>/dev/null || echo "")

            if [ -z "$MANIFEST" ]; then
                RESULT_MSG="Could not fetch manifest"
            else
                SERVER_VERSION=$(echo "$MANIFEST" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("current_version",""))' 2>/dev/null || echo "")
                HB_URL=$(echo "$MANIFEST" | python3 -c 'import json,sys; print(json.load(sys.stdin)["scripts"]["macos"]["heartbeat"])' 2>/dev/null || echo "")
                HEALTH_URL=$(echo "$MANIFEST" | python3 -c 'import json,sys; print(json.load(sys.stdin)["scripts"]["macos"]["health"])' 2>/dev/null || echo "")

                TMPDIR_UPDATE=$(mktemp -d)
                UPDATE_OK=true

                for PAIR in "heartbeat:$HB_URL:${AGENT_DIR}/heartbeat-agent.sh" \
                            "health:$HEALTH_URL:${AGENT_DIR}/health-monitor-agent.sh"; do
                    LABEL=$(echo "$PAIR" | cut -d: -f1)
                    URL=$(echo "$PAIR" | cut -d: -f2)
                    DEST=$(echo "$PAIR" | cut -d: -f3)
                    TMP_FILE="${TMPDIR_UPDATE}/${LABEL}"
                    if [ -n "$URL" ]; then
                        curl -s --max-time 30 -H "Authorization: Bearer $API_KEY" -o "$TMP_FILE" "$URL" 2>/dev/null
                        if [ -s "$TMP_FILE" ]; then
                            mv "$TMP_FILE" "$DEST" && chmod 755 "$DEST"
                        else
                            UPDATE_OK=false
                        fi
                    fi
                done
                rm -rf "$TMPDIR_UPDATE"

                if [ "$UPDATE_OK" = "true" ]; then
                    SUCCESS=true; RESULT_MSG="Scripts updated to version ${SERVER_VERSION}"
                else
                    RESULT_MSG="Partial update failure"
                fi
            fi
            ;;
        *)
            RESULT_MSG="Unsupported command: $CMD_TYPE"
            ;;
    esac

    STATUS="failed"
    [ "$SUCCESS" = "true" ] && STATUS="success"

    curl -s --max-time 10 \
        -X POST "$COMMAND_SERVER/$CMD_ID/result/" \
        -H "Authorization: Bearer $API_KEY" \
        -H "Content-Type: application/json" \
        -d "{\"status\":\"$STATUS\",\"message\":\"$RESULT_MSG\"}" \
        >/dev/null 2>&1
done

exit 0
