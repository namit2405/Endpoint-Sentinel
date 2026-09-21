#!/bin/bash
# =============================================================================
# heartbeat.sh  —  Endpoint Heartbeat Agent (macOS)
# Runs every 1 minute via LaunchDaemon.
# Phase 2: Sends heartbeat to Django API
# Phase 3: Collects MAC, reports WoL, polls for commands
# =============================================================================

SERVER="${LOCAL_BASE_URL:-http://192.168.8.10:8000}/api/heartbeat/"
API_KEY="${HEARTBEAT_API_KEY:?HEARTBEAT_API_KEY is not set}"
AGENT_VERSION="1.1"
COMMAND_SERVER="http://192.168.8.10:8000/api/agent/commands"

HOSTNAME_VAL=$(scutil --get ComputerName 2>/dev/null || hostname)
USERNAME_VAL=$(whoami)
OS_NAME=$(sw_vers -productName 2>/dev/null || echo "macOS")
OS_VER=$(sw_vers -productVersion 2>/dev/null || echo "")
OS_VAL="$OS_NAME $OS_VER"

IP_VAL=$(ipconfig getifaddr en0 2>/dev/null)
if [ -z "$IP_VAL" ]; then
    IP_VAL=$(ipconfig getifaddr en1 2>/dev/null)
fi
if [ -z "$IP_VAL" ]; then
    IP_VAL=$(ifconfig | grep "inet " | grep -v "127.0.0.1" | awk '{print $2}' | head -n1)
fi
[ -z "$IP_VAL" ] && IP_VAL="0.0.0.0"

# Collect MAC
MAC_VAL=""
MAC_VAL=$(ifconfig | grep -m1 "ether" | awk '{print $2}' | tr '[:lower:]' '[:upper:]')

# Check WoL (macOS specific)
WOL_ENABLED="false"
if command -v pmset &> /dev/null; then
    WOL_SETTING=$(pmset -g powerstate 2>/dev/null | grep -i "wake" | head -1)
    if [[ "$WOL_SETTING" == *"1"* ]]; then
        WOL_ENABLED="true"
    fi
fi

# Build JSON
JSON="{\"hostname\":\"$HOSTNAME_VAL\",\"os\":\"$OS_VAL\",\"ip_address\":\"$IP_VAL\",\"username\":\"$USERNAME_VAL\",\"agent_version\":\"$AGENT_VERSION\""

if [ -n "$MAC_VAL" ]; then
    JSON="$JSON,\"mac_address\":\"$MAC_VAL\""
fi

if [ "$WOL_ENABLED" = "true" ]; then
    JSON="$JSON,\"wol_enabled\":true"
fi

JSON="$JSON}"

# Send heartbeat
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    --max-time 10 \
    -X POST "$SERVER" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d "$JSON")

if [ "$HTTP_CODE" != "200" ]; then
    exit 1
fi

# Fetch and execute commands
CMD_RESP=$(curl -s --max-time 10 \
    -X GET "$COMMAND_SERVER/$HOSTNAME_VAL/" \
    -H "Authorization: Bearer $API_KEY")

# Parse and execute commands
echo "$CMD_RESP" | grep -oP '"id":\K[0-9]+' 2>/dev/null | while read CMD_ID; do
    CMD_TYPE=$(echo "$CMD_RESP" | sed -n "/\"id\":$CMD_ID/,/\"command\":/p" | grep -oP '"command":"\K[^"]*')
    
    SUCCESS=false
    RESULT_MSG=""
    
    case "$CMD_TYPE" in
        shutdown)
            if osascript -e 'tell application "System Events" to shut down' 2>/dev/null; then
                SUCCESS=true
                RESULT_MSG="Shutdown initiated"
            else
                RESULT_MSG="Shutdown failed"
            fi
            ;;
        restart)
            if osascript -e 'tell application "System Events" to restart' 2>/dev/null; then
                SUCCESS=true
                RESULT_MSG="Restart initiated"
            else
                RESULT_MSG="Restart failed"
            fi
            ;;
    esac
    
    STATUS="failed"
    [ "$SUCCESS" = "true" ] && STATUS="success"
    
    RESULT_BODY="{\"status\":\"$STATUS\",\"message\":\"$RESULT_MSG\"}"
    
    curl -s --max-time 10 \
        -X POST "$COMMAND_SERVER/$CMD_ID/result/" \
        -H "Authorization: Bearer $API_KEY" \
        -H "Content-Type: application/json" \
        -d "$RESULT_BODY" \
        >/dev/null 2>&1
done

exit 0
