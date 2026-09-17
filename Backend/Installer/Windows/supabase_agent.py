#!/usr/bin/env python3
"""
Supabase Agent Helper - Direct PostgreSQL Connection (Windows)

Allows endpoints to send heartbeat and health monitoring data
directly to Supabase PostgreSQL without going through Django API.

This helper is pure Python (psycopg2) and has no OS-specific calls,
so the logic is identical to the Linux version. Only this docstring
and the default paths referenced by callers differ:

  Linux:   /opt/EndpointAgent/supabase_agent.py
           config: /etc/default/endpoint-heartbeat
  Windows: C:\\Program Files\\EndpointAgent\\supabase_agent.py
           config: C:\\ProgramData\\EndpointAgent\\endpoint-heartbeat.env

Usage (same on Windows, from an elevated or user PowerShell prompt):
    python supabase_agent.py insert_heartbeat --hostname SYSTEM-53 --os "Windows 11 Pro" --ip 192.168.8.40 --mac "AA:BB:CC:DD:EE:FF"
    python supabase_agent.py insert_health --mac "AA:BB:CC:DD:EE:FF" --cpu 45.2 --mem 60.5 --disk 75.0 --uptime 86400

Install dependency on Windows:
    pip install psycopg2-binary
"""

import sys
import json
import argparse
import os
import time
from datetime import datetime
from typing import Optional, Dict, Any

try:
    import psycopg2
    from psycopg2 import sql
except ImportError as error:
    print(f"ERROR: psycopg2 could not be imported: {error}", file=sys.stderr)
    print("Install a Python version supported by psycopg2-binary, preferably Python 3.12 or 3.13.", file=sys.stderr)
    sys.exit(1)


class SupabaseAgent:
    """Direct PostgreSQL connection to Supabase for endpoint data."""

    # Supabase connection details read from environment or
    # C:\ProgramData\EndpointAgent\endpoint-heartbeat.env (loaded into the
    # process environment by heartbeat-agent.ps1 / health-monitor-agent.ps1
    # before this script is invoked).
    DB_HOST = os.environ.get("SUPABASE_HOST", "aws-0-ap-southeast-1.pooler.supabase.com")
    DB_PORT = int(os.environ.get("SUPABASE_PORT", "6543"))
    DB_NAME = os.environ.get("SUPABASE_DB", "postgres")
    DB_USER = os.environ.get("SUPABASE_USER", "postgres.rzydluzduppsbjvczgfc")
    DB_PASSWORD = os.environ.get("SUPABASE_PASSWORD", "")

    # Retry configuration
    MAX_RETRIES = 3
    RETRY_DELAY = 1  # seconds, increases exponentially

    @staticmethod
    def calculate_health_score(cpu_percent, memory_percent, disk_percent, firewall_active, antivirus_active):
        deductions = 0
        for value in (cpu_percent, memory_percent):
            if value >= 95:
                deductions += 30
            elif value >= 85:
                deductions += 20
            elif value >= 75:
                deductions += 10
        if disk_percent >= 95:
            deductions += 25
        elif disk_percent >= 85:
            deductions += 15
        elif disk_percent >= 75:
            deductions += 5
        if firewall_active is False:
            deductions += 15
        if antivirus_active is False:
            deductions += 15
        score = max(0, 100 - deductions)
        status = "healthy" if score >= 75 else "warning" if score >= 50 else "critical"
        return score, status

    def __init__(self, verbose: bool = False):
        """Initialize Supabase connection."""
        self.verbose = verbose
        self.conn = None
        self.cursor = None
        self._connect()

    def _connect(self):
        """Establish connection to Supabase PostgreSQL with retry logic."""
        last_error = None

        for attempt in range(1, self.MAX_RETRIES + 1):
            try:
                if self.verbose:
                    print(f"[Attempt {attempt}/{self.MAX_RETRIES}] Connecting to Supabase: {self.DB_HOST}:{self.DB_PORT}", file=sys.stderr)

                self.conn = psycopg2.connect(
                    host=self.DB_HOST,
                    port=self.DB_PORT,
                    database=self.DB_NAME,
                    user=self.DB_USER,
                    password=self.DB_PASSWORD,
                    connect_timeout=10,
                )
                self.cursor = self.conn.cursor()

                if self.verbose:
                    print("Connected to Supabase", file=sys.stderr)

                return  # Success

            except psycopg2.OperationalError as e:
                # Transient network errors - retry
                last_error = e
                if attempt < self.MAX_RETRIES:
                    wait_time = self.RETRY_DELAY * (2 ** (attempt - 1))  # Exponential backoff
                    if self.verbose:
                        print(f"Connection failed (attempt {attempt}): {e}", file=sys.stderr)
                        print(f"   Retrying in {wait_time}s...", file=sys.stderr)
                    time.sleep(wait_time)
                else:
                    print(f"ERROR: Failed to connect after {self.MAX_RETRIES} attempts: {e}", file=sys.stderr)
                    sys.exit(1)

            except psycopg2.Error as e:
                # Authentication or other persistent errors - fail immediately
                print(f"ERROR: Failed to connect to Supabase: {e}", file=sys.stderr)
                sys.exit(1)

    def close(self):
        """Close connection."""
        if self.cursor:
            self.cursor.close()
        if self.conn:
            self.conn.close()

    def insert_heartbeat(
        self,
        hostname: str,
        os_type: str,
        ip_address: str,
        mac_address: Optional[str] = None,
        username: Optional[str] = None,
        agent_version: str = "1.2",
        wol_enabled: bool = False,
    ) -> bool:
        """Insert heartbeat into EndpointStatus table."""
        try:
            if self.verbose:
                print(f"Inserting heartbeat for {hostname} ({mac_address})", file=sys.stderr)

            # Normalize OS type
            os_normalized = os_type.lower()
            if "ubuntu" in os_normalized or "debian" in os_normalized:
                os_normalized = "Linux"
            elif "windows" in os_normalized:
                os_normalized = "Windows"
            elif "darwin" in os_normalized or "macos" in os_normalized:
                os_normalized = "macOS"
            else:
                os_normalized = os_type

            # Use UPDATE OR INSERT logic
            query = sql.SQL(
                """
                INSERT INTO dashboard_endpointstatus
                (hostname, os, ip_address, mac_address, username, agent_version, wol_enabled, last_seen, connection_started_at, updated_at, health_score, health_status)
                VALUES (%s, %s, %s, %s, %s, %s, %s, NOW(), NOW(), NOW(), 100.0, 'healthy')
                ON CONFLICT (mac_address) DO UPDATE SET
                    hostname = EXCLUDED.hostname,
                    os = EXCLUDED.os,
                    ip_address = EXCLUDED.ip_address,
                    username = EXCLUDED.username,
                    agent_version = EXCLUDED.agent_version,
                    wol_enabled = EXCLUDED.wol_enabled,
                    last_seen = NOW(),
                    connection_started_at = CASE
                        WHEN dashboard_endpointstatus.connection_started_at IS NULL
                             OR dashboard_endpointstatus.last_seen < NOW() - INTERVAL '2 minutes'
                        THEN NOW()
                        ELSE dashboard_endpointstatus.connection_started_at
                    END,
                    updated_at = NOW()
                """
            )

            self.cursor.execute(query, (hostname, os_normalized, ip_address, mac_address, username, agent_version, wol_enabled))
            self.conn.commit()

            if self.verbose:
                print(f"Heartbeat inserted for {hostname}", file=sys.stderr)

            return True

        except psycopg2.Error as e:
            print(f"ERROR: Failed to insert heartbeat: {e}", file=sys.stderr)
            if self.conn:
                self.conn.rollback()
            return False

    def insert_health(
        self,
        mac_address: str,
        cpu_percent: float,
        memory_percent: float,
        disk_percent: float,
        uptime_seconds: int,
        hostname: Optional[str] = None,
        ip_address: Optional[str] = None,
    ) -> bool:
        """Insert health monitoring data into EndpointStatus table."""
        try:
            if self.verbose:
                print(f"Inserting health data for {mac_address} (CPU: {cpu_percent}%, MEM: {memory_percent}%, DISK: {disk_percent}%, UPTIME: {uptime_seconds}s)", file=sys.stderr)

            # First, get the EndpointStatus to link the report
            endpoint_query = "SELECT id, hostname, os, firewall_active, antivirus_active FROM dashboard_endpointstatus WHERE mac_address = %s LIMIT 1"
            self.cursor.execute(endpoint_query, (mac_address,))
            endpoint_row = self.cursor.fetchone()

            if not endpoint_row:
                if self.verbose:
                    print(f"WARNING: No EndpointStatus found for MAC {mac_address}, skipping health insert", file=sys.stderr)
                return False

            endpoint_id, endpoint_hostname, endpoint_os, firewall_active, antivirus_active = endpoint_row
            health_score, health_status = self.calculate_health_score(
                cpu_percent, memory_percent, disk_percent, firewall_active, antivirus_active
            )
            if hostname is None:
                hostname = endpoint_hostname
            if ip_address is None:
                # Try to get from EndpointStatus
                self.cursor.execute("SELECT ip_address FROM dashboard_endpointstatus WHERE id = %s", (endpoint_id,))
                result = self.cursor.fetchone()
                ip_address = result[0] if result else "0.0.0.0"

            # Update EndpointStatus with health metrics
            update_query = sql.SQL(
                """
                UPDATE dashboard_endpointstatus
                SET cpu_percent = %s, memory_percent = %s, disk_percent = %s, uptime_seconds = %s,
                    health_score = %s, health_status = %s, last_health_check = NOW()
                WHERE mac_address = %s
                """
            )

            self.cursor.execute(update_query, (cpu_percent, memory_percent, disk_percent, uptime_seconds, health_score, health_status, mac_address))
            self.conn.commit()

            if self.verbose:
                print(f"Health data inserted for {hostname}", file=sys.stderr)

            return True

        except psycopg2.Error as e:
            print(f"ERROR: Failed to insert health data: {e}", file=sys.stderr)
            if self.conn:
                self.conn.rollback()
            return False

    def activate_license(self, license_key: str, mac_address: str) -> bool:
        """Validate a license and activate this MAC address atomically."""
        try:
            self.cursor.execute("BEGIN")
            self.cursor.execute(
                """
                SELECT id, status, device_limit, valid_from, expires_at
                FROM dashboard_license
                WHERE license_key = %s
                FOR UPDATE
                """,
                (license_key,),
            )
            license_row = self.cursor.fetchone()
            if not license_row:
                print("ERROR: License not found", file=sys.stderr)
                self.conn.rollback()
                return False

            license_id, status, device_limit, valid_from, expires_at = license_row
            current_time = datetime.now().astimezone()
            if status != "active" or (valid_from and current_time < valid_from) or current_time > expires_at:
                print(f"ERROR: License is not valid (status: {status})", file=sys.stderr)
                self.conn.rollback()
                return False

            self.cursor.execute(
                """
                SELECT id FROM dashboard_licensedevicerecord
                WHERE license_id = %s AND mac_address = %s AND deactivated_at IS NULL
                """,
                (license_id, mac_address),
            )
            if self.cursor.fetchone():
                self.conn.commit()
                print("License device already activated", file=sys.stderr)
                return True

            self.cursor.execute(
                """
                SELECT COUNT(DISTINCT mac_address)
                FROM dashboard_licensedevicerecord
                WHERE license_id = %s AND deactivated_at IS NULL
                """,
                (license_id,),
            )
            devices_used = self.cursor.fetchone()[0]
            if devices_used >= device_limit:
                print(f"ERROR: Device limit reached ({devices_used}/{device_limit})", file=sys.stderr)
                self.conn.rollback()
                return False

            self.cursor.execute(
                "SELECT id FROM dashboard_endpointstatus WHERE mac_address = %s LIMIT 1",
                (mac_address,),
            )
            endpoint_row = self.cursor.fetchone()
            endpoint_id = endpoint_row[0] if endpoint_row else None

            self.cursor.execute(
                """
                INSERT INTO dashboard_licensedevicerecord
                    (license_id, mac_address, activated_at, deactivated_at, endpoint_id, activated_by_id, notes)
                VALUES (%s, %s, NOW(), NULL, %s, NULL, '')
                """,
                (license_id, mac_address, endpoint_id),
            )
            self.conn.commit()
            print(f"License activated ({devices_used + 1}/{device_limit})", file=sys.stderr)
            return True
        except psycopg2.Error as error:
            print(f"ERROR: License activation failed: {error}", file=sys.stderr)
            self.conn.rollback()
            return False

    def validate_license(self, license_key: str) -> bool:
        """Validate a license directly in Supabase and print its summary."""
        try:
            self.cursor.execute(
                """
                SELECT id, status, device_limit, valid_from, expires_at
                FROM dashboard_license
                WHERE license_key = %s
                """,
                (license_key,),
            )
            license_row = self.cursor.fetchone()
            if not license_row:
                print("ERROR: License not found", file=sys.stderr)
                return False

            license_id, status, device_limit, valid_from, expires_at = license_row
            current_time = datetime.now().astimezone()
            valid = status == "active" and (not valid_from or current_time >= valid_from) and current_time <= expires_at
            if not valid:
                print(f"ERROR: License is not valid (status: {status})", file=sys.stderr)
                return False

            self.cursor.execute(
                """
                SELECT COUNT(DISTINCT mac_address)
                FROM dashboard_licensedevicerecord
                WHERE license_id = %s AND deactivated_at IS NULL
                """,
                (license_id,),
            )
            devices_used = self.cursor.fetchone()[0]
            print(f"License valid ({devices_used}/{device_limit} devices)", file=sys.stderr)
            return True
        except psycopg2.Error as error:
            print(f"ERROR: License validation failed: {error}", file=sys.stderr)
            return False

    def get_endpoint_status(self, mac_address: str) -> Optional[Dict[str, Any]]:
        """Retrieve endpoint status by MAC address."""
        try:
            query = "SELECT id, hostname, os, ip_address, username FROM dashboard_endpointstatus WHERE mac_address = %s"
            self.cursor.execute(query, (mac_address,))
            row = self.cursor.fetchone()

            if row:
                return {
                    "id": row[0],
                    "hostname": row[1],
                    "os": row[2],
                    "ip_address": row[3],
                    "username": row[4],
                }
            return None

        except psycopg2.Error as e:
            print(f"ERROR: Failed to query endpoint status: {e}", file=sys.stderr)
            return None

    def poll_commands(self, mac_address: str) -> list[dict]:
        """Claim pending power commands for this endpoint."""
        self.cursor.execute(
            """
            UPDATE dashboard_endpointcommand AS command
            SET status = 'delivered', sent_at = NOW(), updated_at = NOW()
            FROM dashboard_endpointstatus AS endpoint
            WHERE command.endpoint_id = endpoint.id
              AND endpoint.mac_address = %s
              AND command.status IN ('pending', 'delivering')
            RETURNING command.id, command.command
            """,
            (mac_address,),
        )
        commands = [{"id": row[0], "command": row[1]} for row in self.cursor.fetchall()]
        self.conn.commit()
        return commands

    def complete_command(self, command_id: int, status: str, message: str) -> bool:
        self.cursor.execute(
            """
            UPDATE dashboard_endpointcommand
            SET status = %s, result_message = %s, completed_at = NOW(), updated_at = NOW()
            WHERE id = %s
            """,
            (status, message, command_id),
        )
        self.conn.commit()
        return self.cursor.rowcount == 1

def main():
    """CLI entry point."""
    parser = argparse.ArgumentParser(
        description="Supabase Agent - Send endpoint data directly to Supabase PostgreSQL"
    )
    parser.add_argument("-v", "--verbose", action="store_true", help="Verbose output")

    subparsers = parser.add_subparsers(dest="command", help="Command to execute")

    # Heartbeat command
    heartbeat_parser = subparsers.add_parser("insert_heartbeat", help="Send heartbeat data")
    heartbeat_parser.add_argument("--hostname", required=True, help="Hostname")
    heartbeat_parser.add_argument("--os", required=True, help="OS type (linux/windows/macos)")
    heartbeat_parser.add_argument("--ip", required=True, help="IP address")
    heartbeat_parser.add_argument("--mac", required=False, help="MAC address")
    heartbeat_parser.add_argument("--username", help="Username")
    heartbeat_parser.add_argument("--version", default="1.2", help="Agent version")
    heartbeat_parser.add_argument("--wol", action="store_true", help="WOL enabled")

    # Health command
    health_parser = subparsers.add_parser("insert_health", help="Send health monitoring data")
    health_parser.add_argument("--mac", required=True, help="MAC address (endpoint identifier)")
    health_parser.add_argument("--cpu", type=float, required=True, help="CPU percent")
    health_parser.add_argument("--mem", type=float, required=True, help="Memory percent")
    health_parser.add_argument("--disk", type=float, required=True, help="Disk percent")
    health_parser.add_argument("--uptime", type=int, required=True, help="Device uptime in seconds")
    health_parser.add_argument("--hostname", help="Hostname (optional, will use EndpointStatus)")
    health_parser.add_argument("--ip", help="IP address (optional, will use EndpointStatus)")

    license_parser = subparsers.add_parser("activate_license", help="Validate and activate a device")
    license_parser.add_argument("--license-key", required=True, help="License key")
    license_parser.add_argument("--mac", required=True, help="MAC address")

    validate_parser = subparsers.add_parser("validate_license", help="Validate a license")
    validate_parser.add_argument("--license-key", required=True, help="License key")

    commands_parser = subparsers.add_parser("poll_commands", help="Claim pending power commands")
    commands_parser.add_argument("--mac", required=True, help="MAC address")
    complete_parser = subparsers.add_parser("complete_command", help="Complete a power command")
    complete_parser.add_argument("--id", type=int, required=True, help="Command ID")
    complete_parser.add_argument("--status", choices=["success", "failed"], required=True)
    complete_parser.add_argument("--message", required=True)

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    agent = SupabaseAgent(verbose=args.verbose)

    try:
        if args.command == "insert_heartbeat":
            success = agent.insert_heartbeat(
                hostname=args.hostname,
                os_type=args.os,
                ip_address=args.ip,
                mac_address=args.mac,
                username=args.username,
                agent_version=args.version,
                wol_enabled=args.wol,
            )
            sys.exit(0 if success else 1)

        elif args.command == "insert_health":
            success = agent.insert_health(
                mac_address=args.mac,
                cpu_percent=args.cpu,
                memory_percent=args.mem,
                disk_percent=args.disk,
                uptime_seconds=args.uptime,
                hostname=args.hostname,
                ip_address=args.ip,
            )
            sys.exit(0 if success else 1)

        elif args.command == "activate_license":
            success = agent.activate_license(args.license_key, args.mac)
            sys.exit(0 if success else 1)

        elif args.command == "validate_license":
            success = agent.validate_license(args.license_key)
            sys.exit(0 if success else 1)

        elif args.command == "poll_commands":
            print(json.dumps(agent.poll_commands(args.mac)))
            sys.exit(0)

        elif args.command == "complete_command":
            success = agent.complete_command(args.id, args.status, args.message)
            sys.exit(0 if success else 1)

    finally:
        agent.close()


if __name__ == "__main__":
    main()
