"""
REST API views for the dashboard (converted from server-rendered templates).

Endpoints:
  GET  /api/dashboard/overview/      — fleet summary, charts, stats
  GET  /api/dashboard/inventory/     — filterable machine list
  GET  /api/dashboard/machine/<id>/  — detailed report for one endpoint
  GET  /api/dashboard/compare/       — side-by-side comparison of two machines
  GET  /api/dashboard/search/        — full-text search across fields
"""
import json
from datetime import timedelta

from django.conf import settings
from django.db.models import Avg, Count, Max, Q
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.utils.timezone import now
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status

from .models import EndpointReport, EndpointStatus, EndpointCommand, PowerActionLog
from .risk import calculate, DEDUCTIONS


# ── Helpers ──────────────────────────────────────────────────────────────────

def _bool_counts(qs, field):
    """Return (true_count, false_count, unknown_count) for a BooleanField."""
    t = qs.filter(**{field: True}).count()
    f = qs.filter(**{field: False}).count()
    u = qs.filter(**{field: None}).count()
    return t, f, u


def _latest_per_host(qs=None):
    """Return only the most-recent report per hostname."""
    if qs is None:
        qs = EndpointReport.objects.all()
    latest_ids = (
        qs.values("hostname")
          .annotate(latest=Max("report_date"))
          .values("latest", "hostname")
    )
    q = Q()
    for row in latest_ids:
        q |= Q(hostname=row["hostname"], report_date=row["latest"])
    return qs.filter(q) if q else qs.none()


def _serialize_report(report):
    """Serialize an EndpointReport for JSON response."""
    return {
        "id": report.id,
        "hostname": report.hostname,
        "mac_address": report.mac_address,
        "os_type": report.os_type,
        "os_name": report.os_name,
        "os_version": report.os_version,
        "ip_address": report.ip_address,
        "report_date": report.report_date.isoformat(),
        "cpu": report.cpu,
        "cpu_model": report.cpu_model,
        "ram": report.ram,
        "firewall_enabled": report.firewall_enabled,
        "encryption_enabled": report.encryption_enabled,
        "antivirus_installed": report.antivirus_installed,
        "antivirus_name": report.antivirus_name,
        "secure_boot_enabled": report.secure_boot_enabled,
        "tpm_present": report.tpm_present,
        "ssh_enabled": report.ssh_enabled,
        "auditd_enabled": report.auditd_enabled,
        "passwordless_sudo": report.passwordless_sudo,
        "sip_enabled": report.sip_enabled,
        "gatekeeper_enabled": report.gatekeeper_enabled,
        "pending_updates": report.pending_updates,
        "last_patch_date": report.last_patch_date.isoformat() if report.last_patch_date else None,
        "pass_max_days": report.pass_max_days,
        "pass_min_days": report.pass_min_days,
        "pass_min_len": report.pass_min_len,
        "lockout_threshold": report.lockout_threshold,
        "usb_storage_enabled": report.usb_storage_enabled,
        "screen_lock_enabled": report.screen_lock_enabled,
        "chrome_remote_desktop": report.chrome_remote_desktop,
        "antivirus_tamper": report.antivirus_tamper,
        "anydesk_running": report.anydesk_running,
        "teamviewer_running": report.teamviewer_running,
        "rdp_open": report.rdp_open,
        "risk_score": report.risk_score,
        "risk_level": report.risk_level,
        "raw_data": report.raw_data,
    }


def _serialize_endpoint_status(ep):
    """Serialize an EndpointStatus for JSON response."""
    _now = now()
    delta = _now - ep.last_seen
    secs = int(delta.total_seconds())
    
    if delta <= timedelta(minutes=1):
        presence = "online"
    elif delta <= timedelta(minutes=2):
        presence = "warning"
    else:
        presence = "offline"
    
    if secs < 60:
        last_seen_str = f"{secs} sec ago"
    elif secs < 3600:
        last_seen_str = f"{secs // 60} min ago"
    else:
        last_seen_str = f"{secs // 3600} hr ago"
    
    return {
        "id": ep.id,
        "hostname": ep.hostname,
        "mac_address": ep.mac_address,
        "os": ep.os,
        "ip_address": str(ep.ip_address) if ep.ip_address else None,
        "username": ep.username,
        "agent_version": ep.agent_version,
        "last_seen": ep.last_seen.isoformat(),
        "last_seen_display": last_seen_str,
        "presence": presence,
        "wol_enabled": ep.wol_enabled,
        "health_score": ep.health_score,
        "health_status": ep.health_status,
        "cpu_percent": ep.cpu_percent,
        "memory_percent": ep.memory_percent,
        "disk_percent": ep.disk_percent,
        "process_count": ep.process_count,
        "firewall_active": ep.firewall_active,
        "antivirus_active": ep.antivirus_active,
    }


# ── API Endpoints ────────────────────────────────────────────────────────────

@api_view(['GET'])
def overview(request):
    """
    GET /api/dashboard/overview/
    Returns fleet summary, charts, and aggregated statistics.
    """
    fleet = _latest_per_host()

    total = fleet.count()
    windows = fleet.filter(os_type="windows").count()
    linux = fleet.filter(os_type="linux").count()
    macos = fleet.filter(os_type="macos").count()

    healthy = fleet.filter(risk_level="healthy").count()
    warning = fleet.filter(risk_level="warning").count()
    critical = fleet.filter(risk_level="critical").count()

    compliance_pct = round((healthy / total * 100) if total else 0)
    avg_score = round(fleet.aggregate(a=Avg("risk_score"))["a"] or 0)

    # Security control counts
    fw_on, fw_off, fw_unk = _bool_counts(fleet, "firewall_enabled")
    av_on, av_off, av_unk = _bool_counts(fleet, "antivirus_installed")
    enc_on, enc_off, enc_unk = _bool_counts(fleet, "encryption_enabled")
    sb_on, sb_off, sb_unk = _bool_counts(fleet, "secure_boot_enabled")

    # Pending updates bands
    upd_low = fleet.filter(pending_updates__lte=5).count()
    upd_mid = fleet.filter(pending_updates__gt=5, pending_updates__lte=20).count()
    upd_high = fleet.filter(pending_updates__gt=20).count()
    upd_unk = fleet.filter(pending_updates__isnull=True).count()

    # Remote access exposure
    anydesk_count = fleet.filter(anydesk_running=True).count()
    teamviewer_count = fleet.filter(teamviewer_running=True).count()
    crd_count = fleet.filter(chrome_remote_desktop=True).count()
    rdp_count = fleet.filter(rdp_open=True).count()

    # Recent critical machines
    critical_machines = list(fleet.filter(risk_level="critical").order_by("-report_date")[:10].values(
        "id", "hostname", "risk_score", "risk_level"
    ))

    # Heartbeat presence counts
    _now = now()
    all_statuses = EndpointStatus.objects.all()
    online_count = sum(1 for s in all_statuses if (_now - s.last_seen) <= timedelta(minutes=1))
    warning_count = sum(1 for s in all_statuses if timedelta(minutes=1) < (_now - s.last_seen) <= timedelta(minutes=2))
    offline_count = sum(1 for s in all_statuses if (_now - s.last_seen) > timedelta(minutes=2))
    heartbeat_total = all_statuses.count()

    return Response({
        "summary": {
            "total": total,
            "windows": windows,
            "linux": linux,
            "macos": macos,
        },
        "risk": {
            "healthy": healthy,
            "warning": warning,
            "critical": critical,
            "compliance_pct": compliance_pct,
            "avg_score": avg_score,
        },
        "security_controls": {
            "firewall": {"enabled": fw_on, "disabled": fw_off, "unknown": fw_unk},
            "antivirus": {"enabled": av_on, "disabled": av_off, "unknown": av_unk},
            "encryption": {"enabled": enc_on, "disabled": enc_off, "unknown": enc_unk},
            "secure_boot": {"enabled": sb_on, "disabled": sb_off, "unknown": sb_unk},
        },
        "updates": {
            "0_to_5": upd_low,
            "6_to_20": upd_mid,
            "20_plus": upd_high,
            "unknown": upd_unk,
        },
        "remote_access": {
            "anydesk": anydesk_count,
            "teamviewer": teamviewer_count,
            "chrome_remote_desktop": crd_count,
            "rdp": rdp_count,
        },
        "critical_machines": critical_machines,
        "heartbeat": {
            "total": heartbeat_total,
            "online": online_count,
            "warning": warning_count,
            "offline": offline_count,
        },
    })


@api_view(['GET'])
def inventory(request):
    """
    GET /api/dashboard/inventory/
    Query params: os, risk, firewall, antivirus, encryption, q (search)
    Returns filterable list of machines.
    """
    fleet = _latest_per_host()

    # Filters from query string
    os_filter = request.GET.get("os", "")
    risk_filter = request.GET.get("risk", "")
    fw_filter = request.GET.get("firewall", "")
    av_filter = request.GET.get("antivirus", "")
    enc_filter = request.GET.get("encryption", "")
    search_q = request.GET.get("q", "").strip()

    if os_filter:
        fleet = fleet.filter(os_type=os_filter)
    if risk_filter:
        fleet = fleet.filter(risk_level=risk_filter)
    if fw_filter == "on":
        fleet = fleet.filter(firewall_enabled=True)
    elif fw_filter == "off":
        fleet = fleet.filter(firewall_enabled=False)
    if av_filter == "on":
        fleet = fleet.filter(antivirus_installed=True)
    elif av_filter == "off":
        fleet = fleet.filter(antivirus_installed=False)
    if enc_filter == "on":
        fleet = fleet.filter(encryption_enabled=True)
    elif enc_filter == "off":
        fleet = fleet.filter(encryption_enabled=False)
    if search_q:
        fleet = fleet.filter(
            Q(hostname__icontains=search_q)
            | Q(ip_address__icontains=search_q)
            | Q(os_name__icontains=search_q)
            | Q(cpu__icontains=search_q)
        )

    fleet = fleet.order_by("risk_level", "-risk_score")

    machines = [_serialize_report(m) for m in fleet]

    return Response({
        "machines": machines,
        "total": len(machines),
        "filters": {
            "os": os_filter,
            "risk": risk_filter,
            "firewall": fw_filter,
            "antivirus": av_filter,
            "encryption": enc_filter,
            "search": search_q,
        },
    })


@api_view(['GET'])
def machine_detail(request, pk):
    """
    GET /api/dashboard/machine/<id>/
    Returns detailed report for a single endpoint with history and findings.
    """
    report = get_object_or_404(EndpointReport, pk=pk)

    # History: all reports for this hostname, newest first
    history = list(
        EndpointReport.objects
        .filter(hostname=report.hostname)
        .order_by("-report_date")
        .values("pk", "report_date", "risk_score", "risk_level", "pending_updates")
    )

    # Convert report_date to ISO format for JSON
    for h in history:
        h["report_date"] = h["report_date"].isoformat()

    # Risk score history for sparkline chart
    score_history = [
        {"date": str(r["report_date"][:10]), "score": r["risk_score"]}
        for r in reversed(history)
    ]

    # Re-calculate deductions for display
    _FINDING_LABELS = {
        "firewall_off": "Firewall disabled",
        "antivirus_missing": "Antivirus not installed",
        "tamper_protection_off": "Tamper protection disabled",
        "encryption_off": "Disk encryption disabled",
        "secure_boot_off": "Secure Boot disabled",
        "tpm_missing": "TPM not present",
        "ssh_enabled": "SSH service running",
        "auditd_missing": "Audit daemon not installed",
        "passwordless_sudo": "Passwordless sudo allowed",
        "sip_disabled": "SIP (System Integrity Protection) disabled",
        "gatekeeper_disabled": "Gatekeeper disabled",
        "anydesk_running": "AnyDesk running",
        "teamviewer_running": "TeamViewer running",
        "chrome_remote_desktop": "Chrome Remote Desktop running",
        "rdp_open": "RDP port open (3389)",
        "usb_storage_enabled": "USB storage unrestricted",
        "screen_lock_missing": "Screen lock not configured",
        "updates_6_20": "6–20 pending updates",
        "updates_20_plus": "More than 20 pending updates",
        "pass_never_expires": "Password never expires",
        "no_lockout": "No account lockout threshold",
    }

    data_for_risk = {
        "firewall_enabled": report.firewall_enabled,
        "antivirus_installed": report.antivirus_installed,
        "antivirus_tamper": report.antivirus_tamper,
        "encryption_enabled": report.encryption_enabled,
        "secure_boot_enabled": report.secure_boot_enabled,
        "tpm_present": report.tpm_present,
        "ssh_enabled": report.ssh_enabled,
        "auditd_enabled": report.auditd_enabled,
        "passwordless_sudo": report.passwordless_sudo,
        "sip_enabled": report.sip_enabled,
        "gatekeeper_enabled": report.gatekeeper_enabled,
        "anydesk_running": report.anydesk_running,
        "teamviewer_running": report.teamviewer_running,
        "chrome_remote_desktop": report.chrome_remote_desktop,
        "rdp_open": report.rdp_open,
        "usb_storage_enabled": report.usb_storage_enabled,
        "screen_lock_enabled": report.screen_lock_enabled,
        "pending_updates": report.pending_updates,
        "pass_max_days": report.pass_max_days,
        "lockout_threshold": report.lockout_threshold,
        "os_type": report.os_type,
    }

    _, _, deduction_keys = calculate(data_for_risk)
    findings = [
        {
            "key": k,
            "label": _FINDING_LABELS.get(k, k.replace("_", " ").title()),
            "points": DEDUCTIONS[k],
        }
        for k in deduction_keys
    ]

    # Get live endpoint status for power controls
    endpoint_status = None
    try:
        if report.mac_address:
            endpoint_status = EndpointStatus.objects.get(mac_address=report.mac_address)
        else:
            endpoint_status = EndpointStatus.objects.filter(hostname=report.hostname).first()
    except EndpointStatus.DoesNotExist:
        pass

    return Response({
        "report": _serialize_report(report),
        "history": history,
        "score_history": score_history,
        "findings": findings,
        "endpoint_status": _serialize_endpoint_status(endpoint_status) if endpoint_status else None,
    })


@api_view(['GET'])
def compare(request):
    """
    GET /api/dashboard/compare/
    Query params: a (report_id_1), b (report_id_2)
    Returns side-by-side comparison of two machines.
    """
    all_machines = _latest_per_host().order_by("hostname").values("id", "hostname")

    report_a = report_b = None
    id_a = request.GET.get("a")
    id_b = request.GET.get("b")

    if id_a:
        report_a = get_object_or_404(EndpointReport, pk=id_a)
    if id_b:
        report_b = get_object_or_404(EndpointReport, pk=id_b)

    COMPARE_FIELDS = [
        ("OS", "os_name"),
        ("Firewall", "firewall_enabled"),
        ("Antivirus", "antivirus_installed"),
        ("Encryption", "encryption_enabled"),
        ("Secure Boot", "secure_boot_enabled"),
        ("TPM", "tpm_present"),
        ("Pending Updates", "pending_updates"),
        ("Risk Score", "risk_score"),
        ("CPU", "cpu"),
        ("RAM", "ram"),
        ("AnyDesk", "anydesk_running"),
        ("TeamViewer", "teamviewer_running"),
        ("RDP Open", "rdp_open"),
    ]

    rows = []
    if report_a and report_b:
        for label, field in COMPARE_FIELDS:
            va = getattr(report_a, field, None)
            vb = getattr(report_b, field, None)
            rows.append({
                "label": label,
                "val_a": va,
                "val_b": vb,
                "differ": va != vb,
            })

    return Response({
        "all_machines": list(all_machines),
        "report_a": _serialize_report(report_a) if report_a else None,
        "report_b": _serialize_report(report_b) if report_b else None,
        "id_a": id_a or "",
        "id_b": id_b or "",
        "rows": rows,
    })


@api_view(['GET'])
def search(request):
    """
    GET /api/dashboard/search/
    Query param: q (search term)
    Returns full-text search results across machines.
    """
    q = request.GET.get("q", "").strip()
    results = []
    if q:
        fleet = _latest_per_host()
        results = [
            _serialize_report(m) for m in fleet.filter(
                Q(hostname__icontains=q)
                | Q(ip_address__icontains=q)
                | Q(os_name__icontains=q)
                | Q(os_type__icontains=q)
                | Q(cpu__icontains=q)
                | Q(antivirus_name__icontains=q)
            ).order_by("risk_level", "hostname")
        ]

    return Response({
        "q": q,
        "results": results,
        "count": len(results) if q else None,
    })
