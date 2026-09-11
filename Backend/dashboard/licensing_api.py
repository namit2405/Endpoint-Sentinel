"""
Licensing API endpoints for license validation, activation, and management.

Endpoints:
  POST   /api/licenses/validate/           — Validate license key
  POST   /api/licenses/activate-device/    — Activate device with license
  POST   /api/licenses/deactivate-device/  — Deactivate device
  GET    /api/licenses/status/             — Get license and device status
  
  POST   /api/companies/                   — Create company (admin only)
  GET    /api/companies/                   — List companies (admin only)
  
  POST   /api/employees/                   — Add employee to company
  GET    /api/employees/                   — List employees
  
  POST   /api/individual-accounts/         — Create individual account
"""

import json
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods, require_POST
from django.utils.timezone import now
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status

from .models import (
    License, LicenseDeviceRecord, LicenseUsageLog,
    Company, Employee, IndividualAccount, EndpointDevice, EndpointStatus
)


# ── License Validation & Activation ────────────────────────────────────────

@csrf_exempt
@require_POST
def validate_license(request):
    """
    POST /api/licenses/validate/
    
    Validate a license key.
    
    Request:
      {
        "license_key": "ES-XXXX-XXXX-XXXX"
      }
    
    Response:
      {
        "valid": true,
        "license_key": "...",
        "owner": "Company Name or Username",
        "type": "commercial",
        "device_limit": 100,
        "devices_used": 42,
        "devices_available": 58,
        "expires_at": "2025-12-31T23:59:59Z",
        "days_until_expiry": 365
      }
    """
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)
    
    license_key = data.get("license_key", "").strip()
    if not license_key:
        return JsonResponse({"error": "license_key required"}, status=400)
    
    try:
        license_obj = License.objects.get(license_key=license_key)
    except License.DoesNotExist:
        return JsonResponse({
            "valid": False,
            "error": "License not found"
        }, status=404)
    
    # Log validation attempt
    LicenseUsageLog.objects.create(
        license=license_obj,
        action='validated',
        status_code='SUCCESS' if license_obj.is_valid() else 'EXPIRED',
        message=f"License validation check",
        ip_address=_get_client_ip(request),
        user_agent=request.META.get('HTTP_USER_AGENT', '')
    )
    
    owner_name = license_obj.company.name if license_obj.company else license_obj.individual.user.username
    devices_used = license_obj.devices_used()
    
    return JsonResponse({
        "valid": license_obj.is_valid(),
        "license_key": license_obj.license_key,
        "owner": owner_name,
        "company_name": license_obj.company.name if license_obj.company else None,
        "type": license_obj.license_type,
        "device_limit": license_obj.device_limit,
        "devices_used": devices_used,
        "devices_available": license_obj.device_limit - devices_used,
        "status": license_obj.status,
        "expires_at": license_obj.expires_at.isoformat(),
        "days_until_expiry": max(0, (license_obj.expires_at - now()).days),
    })


@csrf_exempt
@require_POST
def activate_device(request):
    """
    POST /api/licenses/activate-device/
    
    Activate a device with a license key.
    
    Request:
      {
        "license_key": "ES-XXXX-XXXX-XXXX",
        "mac_address": "AA:BB:CC:DD:EE:FF",
        "hostname": "PC-001",  # optional
        "notes": "Activation notes"  # optional
      }
    
    Response:
      {
        "success": true,
        "message": "Device activated successfully",
        "device_record_id": 123,
        "devices_used": 42,
        "devices_remaining": 58
      }
    """
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)
    
    license_key = data.get("license_key", "").strip()
    mac_address = data.get("mac_address", "").strip().upper()
    hostname = data.get("hostname", "").strip()
    notes = data.get("notes", "").strip()
    
    if not license_key or not mac_address:
        return JsonResponse({
            "success": False,
            "error": "license_key and mac_address required"
        }, status=400)
    
    # Validate MAC format
    if not _is_valid_mac(mac_address):
        return JsonResponse({
            "success": False,
            "error": "Invalid MAC address format"
        }, status=400)
    
    try:
        license_obj = License.objects.get(license_key=license_key)
    except License.DoesNotExist:
        return JsonResponse({
            "success": False,
            "error": "License not found"
        }, status=404)
    
    # Check if can activate
    can_activate, reason = license_obj.can_activate_device(mac_address)
    if not can_activate:
        LicenseUsageLog.objects.create(
            license=license_obj,
            action='error',
            mac_address=mac_address,
            status_code='LIMIT_EXCEEDED',
            message=reason,
            ip_address=_get_client_ip(request)
        )
        return JsonResponse({
            "success": False,
            "error": reason
        }, status=400)
    
    # Check if already activated
    existing = LicenseDeviceRecord.objects.filter(
        license=license_obj,
        mac_address=mac_address,
        deactivated_at__isnull=True
    ).first()
    
    if existing:
        return JsonResponse({
            "success": True,
            "message": "Device already activated",
            "device_record_id": existing.id,
            "devices_used": license_obj.devices_used(),
            "devices_remaining": license_obj.device_limit - license_obj.devices_used()
        })
    
    # Create device record
    endpoint = None
    endpoint_device = EndpointDevice.objects.filter(mac_address=mac_address).first()
    if hostname:
        endpoint = EndpointStatus.objects.filter(
            mac_address=mac_address
        ).first()
    
    device_record = LicenseDeviceRecord.objects.create(
        license=license_obj,
        mac_address=mac_address,
        endpoint=endpoint,
        endpoint_device=endpoint_device,
        notes=notes
    )
    
    # Log activation
    LicenseUsageLog.objects.create(
        license=license_obj,
        action='activated',
        mac_address=mac_address,
        status_code='SUCCESS',
        message=f"Device {mac_address} activated successfully",
        ip_address=_get_client_ip(request),
        user_agent=request.META.get('HTTP_USER_AGENT', '')
    )
    
    return JsonResponse({
        "success": True,
        "message": "Device activated successfully",
        "device_record_id": device_record.id,
        "devices_used": license_obj.devices_used(),
        "devices_remaining": license_obj.device_limit - license_obj.devices_used()
    })


@csrf_exempt
@require_POST
def deactivate_device(request):
    """
    POST /api/licenses/deactivate-device/
    
    Deactivate a device.
    
    Request:
      {
        "license_key": "ES-XXXX-XXXX-XXXX",
        "mac_address": "AA:BB:CC:DD:EE:FF"
      }
    
    Response:
      {
        "success": true,
        "message": "Device deactivated",
        "devices_remaining": 58
      }
    """
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)
    
    license_key = data.get("license_key", "").strip()
    mac_address = data.get("mac_address", "").strip().upper()
    
    if not license_key or not mac_address:
        return JsonResponse({
            "success": False,
            "error": "license_key and mac_address required"
        }, status=400)
    
    try:
        license_obj = License.objects.get(license_key=license_key)
    except License.DoesNotExist:
        return JsonResponse({
            "success": False,
            "error": "License not found"
        }, status=404)
    
    try:
        device_record = LicenseDeviceRecord.objects.get(
            license=license_obj,
            mac_address=mac_address,
            deactivated_at__isnull=True
        )
    except LicenseDeviceRecord.DoesNotExist:
        return JsonResponse({
            "success": False,
            "error": "Device not found or already deactivated"
        }, status=404)
    
    device_record.deactivate()
    
    # Log deactivation
    LicenseUsageLog.objects.create(
        license=license_obj,
        action='deactivated',
        mac_address=mac_address,
        status_code='SUCCESS',
        message=f"Device {mac_address} deactivated",
        ip_address=_get_client_ip(request)
    )
    
    return JsonResponse({
        "success": True,
        "message": "Device deactivated successfully",
        "devices_remaining": license_obj.device_limit - license_obj.devices_used()
    })


@require_http_methods(["GET"])
def license_status(request):
    """
    GET /api/licenses/status/?license_key=...
    
    Get detailed status of a license and its devices.
    
    Response:
      {
        "license_key": "...",
        "owner": "...",
        "type": "commercial",
        "status": "active",
        "valid": true,
        "device_limit": 100,
        "devices": [
          {
            "mac_address": "AA:BB:CC:DD:EE:FF",
            "activated_at": "2024-01-01T00:00:00Z",
            "hostname": "PC-001",
            "status": "online"
          }
        ]
      }
    """
    license_key = request.GET.get("license_key", "").strip()
    
    if not license_key:
        return JsonResponse({"error": "license_key required"}, status=400)
    
    try:
        license_obj = License.objects.get(license_key=license_key)
    except License.DoesNotExist:
        return JsonResponse({"error": "License not found"}, status=404)
    
    owner_name = license_obj.company.name if license_obj.company else license_obj.individual.user.username
    
    # Get active devices
    devices = []
    for record in license_obj.device_records.filter(deactivated_at__isnull=True):
        device_info = {
            "mac_address": record.mac_address,
            "activated_at": record.activated_at.isoformat(),
            "hostname": record.endpoint.hostname if record.endpoint else "Unknown",
            "status": record.endpoint.presence if record.endpoint else "unknown"
        }
        devices.append(device_info)
    
    return JsonResponse({
        "license_key": license_obj.license_key,
        "owner": owner_name,
        "type": license_obj.license_type,
        "status": license_obj.status,
        "valid": license_obj.is_valid(),
        "device_limit": license_obj.device_limit,
        "devices_used": license_obj.devices_used(),
        "devices": devices,
        "expires_at": license_obj.expires_at.isoformat(),
    })


# ── Helpers ────────────────────────────────────────────────────────────────

def _get_client_ip(request):
    """Extract client IP from request"""
    x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
    if x_forwarded_for:
        return x_forwarded_for.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR', '0.0.0.0')


def _is_valid_mac(mac_address):
    """Validate MAC address format"""
    import re
    pattern = r'^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$'
    return re.match(pattern, mac_address) is not None
