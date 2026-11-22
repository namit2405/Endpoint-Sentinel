#!/bin/bash
# =============================================================================
# health-monitor-agent.sh — Endpoint Health Monitor (macOS)
#
# Runs periodically via LaunchDaemon.
# Sends health data directly to LOCAL Django API.
# =============================================================================

SERVER="${LOCAL_BASE_URL:-http://192.168.8.10:8000}/api/endpoints/health-history/"
API_KEY="${HEARTBEAT_API_KEY:?HEARTBEAT_API_KEY is not set}"

HOSTNAME_VAL=$(scutil --get ComputerName 2>/dev/null || hostname)
IP_VAL=$(ipconfig getifaddr en0 2>/dev/null)
[ -z "$IP_VAL" ] && IP_VAL=$(ipconfig getifaddr en1 2>/dev/null)
[ -z "$IP_VAL" ] && IP_VAL="0.0.0.0"
MAC_VAL=$(ifconfig | grep -m1 "ether" | awk '{print $2}' | tr '[:lower:]' '[:upper:]')

CPU_PERCENT=$(top -l 1 -s 0 2>/dev/null | awk '/^CPU usage:/ {gsub(/%,/,"",$3); print $3}')
[ -z "$CPU_PERCENT" ] && CPU_PERCENT="0.0"

MEM_PERCENT=$(vm_stat 2>/dev/null | python3 -c "
import sys, re
lines = sys.stdin.read()
page = 4096
vals = {m[0]: int(m[1]) for m in re.findall(r'Pages (\w+):\s+(\d+)', lines)}
vals.update({m[0]: int(m[1]) for m in re.findall(r'Pages (\w[\w ]+):\s+(\d+)', lines)})
used = vals.get('active', 0) + vals.get('wired down', 0) + vals.get('occupied by compressor', 0)
free = vals.get('free', 0) + vals.get('inactive', 0) + vals.get('speculative', 0)
total = used + free
print(f'{used/total*100:.1f}' if total > 0 else '0.0')
" 2>/dev/null || echo "0.0")

DISK_PERCENT=$(df / 2>/dev/null | tail -1 | awk '{printf "%.1f", $5}')
[ -z "$DISK_PERCENT" ] && DISK_PERCENT="0.0"

UPTIME_SECONDS=$(sysctl -n kern.boottime 2>/dev/null | python3 -c "
import sys, time, re
m = re.search(r'sec = (\d+)', sys.stdin.read())
print(int(time.time()) - int(m.group(1)) if m else 0)
" 2>/dev/null || echo "0")

JSON="{\"mac_address\":\"$MAC_VAL\",\"hostname\":\"$HOSTNAME_VAL\",\"ip_address\":\"$IP_VAL\",\"cpu_percent\":$CPU_PERCENT,\"memory_percent\":$MEM_PERCENT,\"disk_percent\":$DISK_PERCENT,\"uptime_seconds\":$UPTIME_SECONDS}"

curl -s -o /dev/null --max-time 10 \
    -X POST "$SERVER" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d "$JSON"

exit 0
