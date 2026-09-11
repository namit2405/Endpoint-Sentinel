"""
Views for agent-related APIs and power management operations.

Frontend dashboard views have been moved to api_views.py as REST endpoints.

Agent APIs:
  POST /api/heartbeat/              — receive heartbeat from endpoint agents
  GET  /api/endpoints/status/       — return live presence JSON for AJAX polling
  GET  /api/agent/commands/<hostname>/       — agent fetches pending commands
  POST /api/agent/commands/<id>/result/      — agent reports command result

Power Management:
  POST /api/endpoints/<hostname>/power/on/        — trigger WoL
  POST /api/endpoints/<hostname>/power/shutdown/  — queue shutdown
  POST /api/endpoints/<hostname>/power/restart/   — queue restart
"""
import json
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.utils.timezone import now
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST, require_http_methods

from .models import EndpointDevice, EndpointStatus, EndpointCommand, PowerActionLog
from .services.power import send_wol


# ── Helpers ──────────────────────────────────────────────────────────────────

def _get_client_ip(request):
    """Extract client IP from request (for audit logging)."""
    x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
    if x_forwarded_for:
        return x_forwarded_for.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR', '0.0.0.0')


def _check_api_key(request):
    """Return True if the request carries the correct Bearer token."""
    auth = request.headers.get("Authorization", "")
    expected = f"Bearer {settings.HEARTBEAT_API_KEY}"
    return auth == expected


# ── Agent Heartbeat API ──────────────────────────────────────────────────────

@csrf_exempt
@require_POST
def heartbeat(request):
    """
    POST /api/heartbeat/
    Headers: Authorization: Bearer <HEARTBEAT_API_KEY>
    Body (JSON):
        {
            "hostname":      "PC01",
            "os":            "Windows 11 Pro",
            "ip_address":    "192.168.1.10",
            "username":      "alice",
            "agent_version": "1.0",
            "mac_address":   "AA:BB:CC:DD:EE:FF",
            "wol_enabled":   true
        }
    Creates or updates one EndpointStatus row.  Always returns JSON.
    """
    if not _check_api_key(request):
        return JsonResponse({"error": "Unauthorized"}, status=401)

    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({"error": "Invalid JSON"}, status=400)

    required = ("hostname", "os", "username", "agent_version")
    missing = [f for f in required if not data.get(f)]
    if missing:
        return JsonResponse({"error": f"Missing fields: {', '.join(missing)}"}, status=400)

    reported_ip = data.get("ip_address", "").strip()
    source_ip = _get_client_ip(request)
    ip_address = reported_ip or source_ip

    if not ip_address or ip_address == '0.0.0.0':
        return JsonResponse({"error": "Could not determine endpoint IP address"}, status=400)

    defaults = {
        "os": data["os"],
        "ip_address": ip_address,
        "username": data["username"],
        "agent_version": data["agent_version"],
        "last_seen": now(),
    }

    if data.get("mac_address"):
        endpoint_device, _ = EndpointDevice.objects.update_or_create(
            mac_address=data["mac_address"],
            defaults={
                "hostname": data["hostname"],
                "os": data["os"],
                "ip_address": ip_address,
            },
        )
        defaults["endpoint_device"] = endpoint_device

    if "mac_address" in data and data["mac_address"]:
        defaults["mac_address"] = data["mac_address"]

    if "wol_enabled" in data and data["wol_enabled"] is not None:
        defaults["wol_enabled"] = data["wol_enabled"]

    EndpointStatus.objects.update_or_create(
        hostname=data["hostname"],
        defaults=defaults,
    )

    return JsonResponse({"status": "ok"})


def endpoints_status(request):
    """
    GET /api/endpoints/status/
    Returns JSON array with status and health metrics for AJAX live-refresh.
    No auth required — read-only, no sensitive data beyond what's already visible.
    """
    _now = now()

    rows = []
    for ep in EndpointStatus.objects.all().order_by("hostname"):
        delta = _now - ep.last_seen
        secs = int(delta.total_seconds())

        if delta <= timedelta(minutes=1):
            status = "online"
        elif delta <= timedelta(minutes=2):
            status = "warning"
        else:
            status = "offline"

        if secs < 60:
            last_seen_str = f"{secs} sec ago"
        elif secs < 3600:
            last_seen_str = f"{secs // 60} min ago"
        else:
            last_seen_str = f"{secs // 3600} hr ago"

        rows.append({
            "hostname": ep.hostname,
            "mac_address": ep.mac_address or "N/A",
            "status": status,
            "os": ep.os,
            "ip_address": str(ep.ip_address) if ep.ip_address else None,
            "username": ep.username,
            "agent_version": ep.agent_version,
            "last_seen": ep.last_seen.isoformat(),
            "last_seen_display": last_seen_str,
            "health_score": ep.health_score or 0,
            "health_status": ep.health_status or "healthy",
            "cpu_percent": ep.cpu_percent,
            "memory_percent": ep.memory_percent,
            "disk_percent": ep.disk_percent,
            "process_count": ep.process_count,
            "firewall_active": ep.firewall_active,
            "antivirus_active": ep.antivirus_active,
        })

        latest_report = EndpointReport.objects.filter(
            endpoint_device=ep.endpoint_device
        ).order_by("-report_date").first() if ep.endpoint_device_id else EndpointReport.objects.filter(
            mac_address=ep.mac_address
        ).order_by("-report_date").first()
        if latest_report:
            rows[-1]["audit"] = {
                "cpu": latest_report.cpu,
                "cpu_model": latest_report.cpu_model,
                "ram": latest_report.ram,
                "architecture": latest_report.architecture,
                "disk_percent": latest_report.raw_data.get("disk_usage_percent") if latest_report.raw_data else None,
                "report_date": latest_report.report_date.isoformat(),
                "risk_score": latest_report.risk_score,
                "risk_level": latest_report.risk_level,
                "firewall_enabled": latest_report.firewall_enabled,
                "encryption_enabled": latest_report.encryption_enabled,
                "antivirus_installed": latest_report.antivirus_installed,
                "antivirus_realtime": latest_report.antivirus_realtime,
                "secure_boot_enabled": latest_report.secure_boot_enabled,
                "tpm_present": latest_report.tpm_present,
                "ssh_enabled": latest_report.ssh_enabled,
                "auditd_enabled": latest_report.auditd_enabled,
                "passwordless_sudo": latest_report.passwordless_sudo,
            }

    return JsonResponse({"endpoints": rows})


# ── Agent Command API ────────────────────────────────────────────────────────

def _verify_agent_owns_endpoint(request, hostname):
    """
    Verify that the authenticated agent can access commands for the given hostname.
    Returns: (bool, str) — (is_authorized, error_reason)
    """
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return False, "Missing or invalid Authorization header"

    token = auth[7:]
    if token != settings.HEARTBEAT_API_KEY:
        return False, "Invalid API key"

    try:
        endpoint = EndpointStatus.objects.get(hostname=hostname)
    except EndpointStatus.DoesNotExist:
        return False, f"Endpoint '{hostname}' not found"

    return True, None


@csrf_exempt
@require_http_methods(["GET"])
def agent_fetch_commands(request, hostname):
    """
    GET /api/agent/commands/<hostname>/
    Endpoint agent fetches pending commands.
    """
    is_authorized, reason = _verify_agent_owns_endpoint(request, hostname)
    if not is_authorized:
        return JsonResponse(
            {"error": "Unauthorized", "reason": reason},
            status=403
        )

    endpoint = EndpointStatus.objects.get(hostname=hostname)

    pending = (
        EndpointCommand.objects
        .filter(endpoint=endpoint, status__in=['pending', 'delivering'])
        .values('id', 'command')
        .order_by('created_at')
    )

    for cmd in pending:
        EndpointCommand.objects.filter(id=cmd['id']).update(
            status='delivered',
            sent_at=now()
        )

    commands = list(pending)

    return JsonResponse({
        "commands": commands,
    })


@csrf_exempt
@require_POST
def agent_report_command_result(request, command_id):
    """
    POST /api/agent/commands/<command_id>/result/
    Endpoint agent reports the result of executing a command.
    """
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return JsonResponse({"error": "Missing Authorization header"}, status=401)

    token = auth[7:]
    if token != settings.HEARTBEAT_API_KEY:
        return JsonResponse({"error": "Invalid API key"}, status=401)

    try:
        command = EndpointCommand.objects.get(id=command_id)
    except EndpointCommand.DoesNotExist:
        return JsonResponse({"error": "Command not found"}, status=404)

    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({"error": "Invalid JSON"}, status=400)

    result_status = data.get("status", "").lower()
    result_message = data.get("message", "")

    if result_status not in ["success", "failed"]:
        return JsonResponse(
            {"error": "Invalid status; must be 'success' or 'failed'"},
            status=400
        )

    command.status = result_status
    command.result_message = result_message
    command.completed_at = now()
    command.save()

    return JsonResponse({"status": "ok"})


# ── Power Management API ─────────────────────────────────────────────────────

@login_required
@require_POST
def power_on_wol(request, hostname):
    """
    POST /api/endpoints/<hostname>/power/on/
    Trigger Wake-on-LAN for an offline endpoint.
    """
    try:
        endpoint = EndpointStatus.objects.get(hostname=hostname)
    except EndpointStatus.DoesNotExist:
        return JsonResponse(
            {"success": False, "message": f"Endpoint '{hostname}' not found"},
            status=404
        )

    if not endpoint.mac_address:
        PowerActionLog.objects.create(
            user=request.user,
            endpoint=endpoint,
            operation='power_on',
            status='failed',
            message='MAC address not available for WoL',
            source_ip=_get_client_ip(request),
        )
        return JsonResponse({
            "success": False,
            "message": "MAC address unavailable for this endpoint. "
                       "Ensure the agent has reported it during heartbeat.",
        }, status=400)

    if endpoint.wol_enabled is False:
        PowerActionLog.objects.create(
            user=request.user,
            endpoint=endpoint,
            operation='power_on',
            status='failed',
            message='WoL not enabled on endpoint',
            source_ip=_get_client_ip(request),
        )
        return JsonResponse({
            "success": False,
            "message": "WoL is not enabled on this endpoint. "
                       "Check BIOS/UEFI settings or network configuration.",
        }, status=400)

    result = send_wol(endpoint.mac_address)

    if result["success"]:
        PowerActionLog.objects.create(
            user=request.user,
            endpoint=endpoint,
            operation='power_on',
            status='success',
            message=result["message"],
            source_ip=_get_client_ip(request),
        )
        return JsonResponse({
            "success": True,
            "message": result["message"],
            "mac_address": result.get("mac_normalized"),
        })
    else:
        PowerActionLog.objects.create(
            user=request.user,
            endpoint=endpoint,
            operation='power_on',
            status='failed',
            message=result["message"],
            source_ip=_get_client_ip(request),
        )
        return JsonResponse({
            "success": False,
            "message": result["message"],
        }, status=500)


@login_required
@require_POST
def power_shutdown(request, hostname):
    """
    POST /api/endpoints/<hostname>/power/shutdown/
    Queue a shutdown command for the endpoint.
    """
    try:
        endpoint = EndpointStatus.objects.get(hostname=hostname)
    except EndpointStatus.DoesNotExist:
        return JsonResponse(
            {"success": False, "message": f"Endpoint '{hostname}' not found"},
            status=404
        )

    if endpoint.presence == 'offline':
        PowerActionLog.objects.create(
            user=request.user,
            endpoint=endpoint,
            operation='shutdown',
            status='failed',
            message='Endpoint offline — cannot queue command',
            source_ip=_get_client_ip(request),
        )
        return JsonResponse({
            "success": False,
            "message": "Endpoint is offline. Command cannot be delivered.",
        }, status=400)

    cmd = EndpointCommand.objects.create(
        endpoint=endpoint,
        command='shutdown',
        requested_by=request.user,
    )

    PowerActionLog.objects.create(
        user=request.user,
        endpoint=endpoint,
        operation='shutdown',
        status='requested',
        message=f'Shutdown command queued (ID: {cmd.id})',
        source_ip=_get_client_ip(request),
    )

    return JsonResponse({
        "success": True,
        "message": f"Shutdown command queued (ID: {cmd.id}). "
                   f"Agent will execute within {settings.COMMAND_POLL_INTERVAL} seconds.",
        "command_id": cmd.id,
    })


@login_required
@require_POST
def power_restart(request, hostname):
    """
    POST /api/endpoints/<hostname>/power/restart/
    Queue a restart command for the endpoint.
    """
    try:
        endpoint = EndpointStatus.objects.get(hostname=hostname)
    except EndpointStatus.DoesNotExist:
        return JsonResponse(
            {"success": False, "message": f"Endpoint '{hostname}' not found"},
            status=404
        )

    if endpoint.presence == 'offline':
        PowerActionLog.objects.create(
            user=request.user,
            endpoint=endpoint,
            operation='restart',
            status='failed',
            message='Endpoint offline — cannot queue command',
            source_ip=_get_client_ip(request),
        )
        return JsonResponse({
            "success": False,
            "message": "Endpoint is offline. Command cannot be delivered.",
        }, status=400)

    cmd = EndpointCommand.objects.create(
        endpoint=endpoint,
        command='restart',
        requested_by=request.user,
    )

    PowerActionLog.objects.create(
        user=request.user,
        endpoint=endpoint,
        operation='restart',
        status='requested',
        message=f'Restart command queued (ID: {cmd.id})',
        source_ip=_get_client_ip(request),
    )

    return JsonResponse({
        "success": True,
        "message": f"Restart command queued (ID: {cmd.id}). "
                   f"Agent will execute within {settings.COMMAND_POLL_INTERVAL} seconds.",
        "command_id": cmd.id,
    })
