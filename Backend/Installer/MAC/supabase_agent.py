#!/usr/bin/env python3
"""Direct Supabase agent for macOS endpoint heartbeat, health, licensing and commands."""
import argparse
import json
import os
import sys
import time
from datetime import datetime

try:
    import psycopg2
except ImportError:
    print("ERROR: install psycopg2-binary in the agent virtual environment", file=sys.stderr)
    raise SystemExit(1)


def connect():
    for attempt in range(3):
        try:
            return psycopg2.connect(
                host=os.environ["SUPABASE_HOST"], port=os.environ.get("SUPABASE_PORT", "6543"),
                database=os.environ.get("SUPABASE_DB", "postgres"), user=os.environ["SUPABASE_USER"],
                password=os.environ["SUPABASE_PASSWORD"], connect_timeout=10,
            )
        except psycopg2.OperationalError:
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)


def health_score(cpu, memory, disk, firewall, antivirus):
    deductions = sum(30 if value >= 95 else 20 if value >= 85 else 10 if value >= 75 else 0 for value in (cpu, memory))
    deductions += 25 if disk >= 95 else 15 if disk >= 85 else 5 if disk >= 75 else 0
    deductions += 15 if firewall is False else 0
    deductions += 15 if antivirus is False else 0
    score = max(0, 100 - deductions)
    return score, "healthy" if score >= 75 else "warning" if score >= 50 else "critical"


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    heartbeat = sub.add_parser("insert_heartbeat")
    heartbeat.add_argument("--hostname", required=True); heartbeat.add_argument("--os", required=True)
    heartbeat.add_argument("--ip", required=True); heartbeat.add_argument("--mac", required=True)
    heartbeat.add_argument("--username", required=True); heartbeat.add_argument("--version", default="1.3")
    heartbeat.add_argument("--wol", action="store_true")
    health = sub.add_parser("insert_health")
    health.add_argument("--mac", required=True); health.add_argument("--cpu", type=float, required=True)
    health.add_argument("--mem", type=float, required=True); health.add_argument("--disk", type=float, required=True)
    health.add_argument("--uptime", type=int, required=True); health.add_argument("--hostname", required=True); health.add_argument("--ip", required=True)
    activate = sub.add_parser("activate_license"); activate.add_argument("--license-key", required=True); activate.add_argument("--mac", required=True)
    validate = sub.add_parser("validate_license"); validate.add_argument("--license-key", required=True)
    poll = sub.add_parser("poll_commands"); poll.add_argument("--mac", required=True)
    complete = sub.add_parser("complete_command"); complete.add_argument("--id", type=int, required=True); complete.add_argument("--status", choices=["success", "failed"], required=True); complete.add_argument("--message", required=True)
    args = parser.parse_args()
    conn = connect(); cur = conn.cursor()
    try:
        if args.command == "insert_heartbeat":
            cur.execute("""INSERT INTO dashboard_endpointstatus (hostname, os, ip_address, mac_address, username, agent_version, wol_enabled, last_seen, connection_started_at, updated_at, health_score, health_status) VALUES (%s,%s,%s,%s,%s,%s,%s,NOW(),NOW(),NOW(),100,'healthy') ON CONFLICT (mac_address) DO UPDATE SET hostname=EXCLUDED.hostname, os=EXCLUDED.os, ip_address=EXCLUDED.ip_address, username=EXCLUDED.username, agent_version=EXCLUDED.agent_version, wol_enabled=EXCLUDED.wol_enabled, last_seen=NOW(), updated_at=NOW()""", (args.hostname, "macOS", args.ip, args.mac, args.username, args.version, args.wol))
        elif args.command == "insert_health":
            cur.execute("SELECT firewall_active, antivirus_active FROM dashboard_endpointstatus WHERE mac_address=%s", (args.mac,)); row = cur.fetchone()
            if not row: raise RuntimeError("EndpointStatus not found for MAC address")
            score, status = health_score(args.cpu, args.mem, args.disk, row[0], row[1])
            cur.execute("UPDATE dashboard_endpointstatus SET cpu_percent=%s,memory_percent=%s,disk_percent=%s,uptime_seconds=%s,health_score=%s,health_status=%s,last_health_check=NOW(),hostname=%s,ip_address=%s WHERE mac_address=%s", (args.cpu,args.mem,args.disk,args.uptime,score,status,args.hostname,args.ip,args.mac))
        elif args.command == "validate_license":
            cur.execute("SELECT status,device_limit,valid_from,expires_at FROM dashboard_license WHERE license_key=%s", (args.license_key,)); row = cur.fetchone()
            if not row: raise RuntimeError("License not found")
            status, limit, valid_from, expires_at = row; now = datetime.now().astimezone()
            if status != "active" or (valid_from and now < valid_from) or now > expires_at: raise RuntimeError("License is not valid")
            print(f"License valid (limit {limit})")
        elif args.command == "activate_license":
            cur.execute("SELECT id,status,device_limit,valid_from,expires_at FROM dashboard_license WHERE license_key=%s FOR UPDATE", (args.license_key,)); row = cur.fetchone()
            if not row: raise RuntimeError("License not found")
            license_id, status, limit, valid_from, expires_at = row; now = datetime.now().astimezone()
            if status != "active" or (valid_from and now < valid_from) or now > expires_at: raise RuntimeError("License is not valid")
            cur.execute("SELECT 1 FROM dashboard_licensedevicerecord WHERE license_id=%s AND mac_address=%s AND deactivated_at IS NULL", (license_id,args.mac))
            if not cur.fetchone():
                cur.execute("SELECT COUNT(DISTINCT mac_address) FROM dashboard_licensedevicerecord WHERE license_id=%s AND deactivated_at IS NULL", (license_id,)); used = cur.fetchone()[0]
                if used >= limit: raise RuntimeError("Device limit reached")
                cur.execute("SELECT id FROM dashboard_endpointstatus WHERE mac_address=%s", (args.mac,)); endpoint = cur.fetchone()
                cur.execute("INSERT INTO dashboard_licensedevicerecord (license_id,mac_address,activated_at,deactivated_at,endpoint_id,notes) VALUES (%s,%s,NOW(),NULL,%s,'')", (license_id,args.mac,endpoint[0] if endpoint else None))
        elif args.command == "poll_commands":
            cur.execute("""UPDATE dashboard_endpointcommand c SET status='delivered',sent_at=NOW(),updated_at=NOW() FROM dashboard_endpointstatus e WHERE c.endpoint_id=e.id AND e.mac_address=%s AND c.status IN ('pending','delivering') RETURNING c.id,c.command""", (args.mac,)); print(json.dumps([{"id": row[0], "command": row[1]} for row in cur.fetchall()]))
        elif args.command == "complete_command":
            cur.execute("UPDATE dashboard_endpointcommand SET status=%s,result_message=%s,completed_at=NOW(),updated_at=NOW() WHERE id=%s", (args.status,args.message,args.id))
        conn.commit()
    except Exception as error:
        conn.rollback(); print(f"ERROR: {error}", file=sys.stderr); raise SystemExit(1)
    finally:
        cur.close(); conn.close()


if __name__ == "__main__":
    main()
