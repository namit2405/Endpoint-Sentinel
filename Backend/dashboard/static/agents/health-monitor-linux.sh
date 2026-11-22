#!/bin/bash

# =============================================================================
# health-monitor-agent.sh — Endpoint Real-Time Health Monitoring (Linux)
#
# Runs independently from heartbeat via systemd timer.
# Sends health data directly to Supabase PostgreSQL.
# =============================================================================

set -u

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
PYTHON_BIN="${AGENT_DIR}/venv/bin/python"

log_msg() {
    echo "[$(date '+%H:%M:%S')] $1"
}

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

collect_and_send_health() {
    local hostname_value mac_value ip_value
    local cpu_percent memory_percent disk_percent uptime_seconds

    hostname_value="$(get_hostname)"
    mac_value="$(get_mac)"
    ip_value="$(get_ip)"

    if [ -z "$mac_value" ]; then
        log_msg "✗ MAC address could not be determined"
        return 1
    fi

    cpu_percent="$(top -bn1 2>/dev/null | grep "Cpu(s)" | awk '{print $2}' | cut -d'%' -f1)"
    [ -z "$cpu_percent" ] && cpu_percent="0.0"

    memory_percent="$(free 2>/dev/null | awk '/^Mem:/ {printf "%.1f", ($3/$2)*100}')"
    [ -z "$memory_percent" ] && memory_percent="0.0"

    disk_percent="$(df / 2>/dev/null | tail -1 | awk '{printf "%.1f", $5}')"
    [ -z "$disk_percent" ] && disk_percent="0.0"

    uptime_seconds="$(awk '{printf "%d", $1}' /proc/uptime 2>/dev/null)"
    [ -z "$uptime_seconds" ] && uptime_seconds="0"

    if [ ! -f "$SUPABASE_HELPER" ]; then
        log_msg "✗ Supabase helper not found: $SUPABASE_HELPER"
        return 1
    fi

    log_msg "Sending health to Supabase (CPU: ${cpu_percent}%, MEM: ${memory_percent}%, DISK: ${disk_percent}%, UPTIME: ${uptime_seconds}s)"

    if "$PYTHON_BIN" "$SUPABASE_HELPER" insert_health \
        --mac "$mac_value" \
        --cpu "$cpu_percent" \
        --mem "$memory_percent" \
        --disk "$disk_percent" \
        --uptime "$uptime_seconds" \
        --hostname "$hostname_value" \
        --ip "$ip_value" 2>/dev/null; then
        log_msg "✓ Health data sent"
        return 0
    else
        log_msg "✗ Health data send failed"
        return 1
    fi
}

shutdown_health_monitor() {
    log_msg "✓ Health monitoring stopped"
    exit 0
}

trap shutdown_health_monitor SIGTERM SIGINT

log_msg "✓ Health monitoring service started"
log_msg "✓ Interval=${HEALTH_INTERVAL}s"

while true; do
    collect_and_send_health || log_msg "Health collection failed"
    sleep "$HEALTH_INTERVAL"
done
