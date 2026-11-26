"""
Health Monitoring API Endpoints

Receives real-time health and security metrics from endpoint agents.
- CPU, memory, disk usage
- Network metrics
- Security status
- System load and processes

Stores metrics for dashboard display and trend analysis.
"""

import json
import logging
from datetime import datetime, timedelta

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from django.utils.timezone import now

from .models import EndpointDevice, EndpointStatus, EndpointMetricsHistory
from .health import calculate_health_score

logger = logging.getLogger(__name__)


@csrf_exempt
@require_http_methods(["POST"])
def health_monitoring(request):
    """Receive health monitoring data from agent.
    
    POST /api/agent/health-monitoring/
    
    Authorization: Bearer token (same as heartbeat)
    
    Body (JSON):
    {
        "hostname": "PC01",
        "mac_address": "AA:BB:CC:DD:EE:FF",
        "os_type": "linux",
        "timestamp": "2026-09-01T12:34:56.123456",
        "collection_type": "health_monitoring",
        "cpu_percent": 45.2,
        "cpu_count_physical": 4,
        "cpu_count_logical": 8,
        "memory_total": 16777216000,
        "memory_used": 8388608000,
        "memory_percent": 50.0,
        "disk_total": 1099511627776,
        "disk_used": 549755813888,
        "disk_percent": 50.0,
        "network_bytes_sent": 1234567890,
        "network_bytes_recv": 9876543210,
        "ip_address": "192.168.1.10",
        "process_count": 245,
        "load_average_1min": 1.25,
        "load_average_5min": 1.50,
        "load_average_15min": 1.75,
        "firewall_active": true,
        "antivirus_active": true,
        "health_score": 82.5,
        "health_status": "healthy"
    }
    """
    try:
        data = json.loads(request.body)
        
        hostname = data.get("hostname", "").strip()
        mac_address = data.get("mac_address", "").strip()
        os_type = data.get("os_type", "").strip()

        device_type = data.get("device_type", "physical")
        if device_type not in ("physical", "vm", "container"):
            device_type = "physical"

        if not hostname:
            return JsonResponse({"error": "hostname required"}, status=400)
        
        if not mac_address:
            return JsonResponse({"error": "mac_address required"}, status=400)

        endpoint_device, _ = EndpointDevice.objects.update_or_create(
            mac_address=mac_address,
            defaults={
                "hostname": hostname,
                "os": os_type or "unknown",
                "ip_address": data.get("ip_address", "").strip() or None,
                "device_type": device_type,
            },
        )
        
        # Find or create endpoint by MAC address (primary key)
        endpoint, created = EndpointStatus.objects.get_or_create(
            mac_address=mac_address,
            defaults={
                "hostname": hostname,
                "os": os_type or "unknown",
                "last_seen": now(),
                "endpoint_device": endpoint_device,
            }
        )
        
        # Update with latest health data
        heartbeat_time = now()
        endpoint.hostname = hostname
        endpoint.os = os_type or endpoint.os
        endpoint.ip_address = data.get("ip_address", "").strip() or endpoint.ip_address
        if (
            not endpoint.connection_started_at
            or heartbeat_time - endpoint.last_seen > timedelta(minutes=2)
        ):
            endpoint.connection_started_at = heartbeat_time
        endpoint.last_seen = heartbeat_time
        
        # Extract health_metrics from nested structure (supports both nested and flat)
        health_data = data.get("health_metrics", {})
        if not health_data:
            # Fallback: expect flat structure
            health_data = data
        
        # Store health metrics directly in EndpointStatus fields
        endpoint.cpu_percent = health_data.get("cpu_percent")
        endpoint.memory_percent = health_data.get("memory_percent")
        endpoint.disk_percent = health_data.get("disk_percent")
        endpoint.uptime_seconds = health_data.get("uptime_seconds")
        running_apps = health_data.get("running_apps") or data.get("running_apps") or []
        if isinstance(running_apps, str):
            import json as _json; running_apps = _json.loads(running_apps)
        endpoint.running_apps = running_apps if isinstance(running_apps, list) else []
        provided_process_count = health_data.get("process_count") or data.get("process_count")
        if provided_process_count is not None:
            endpoint.process_count = provided_process_count
        elif endpoint.running_apps:
            endpoint.process_count = len(endpoint.running_apps)
        endpoint.firewall_active = health_data.get("firewall_active")
        endpoint.antivirus_active = health_data.get("antivirus_active")
        firewall_products = health_data.get("firewall_products") or data.get("firewall_products") or []
        antivirus_products = health_data.get("antivirus_products") or data.get("antivirus_products") or []
        if isinstance(firewall_products, str):
            import json as _json; firewall_products = _json.loads(firewall_products)
        if isinstance(antivirus_products, str):
            import json as _json; antivirus_products = _json.loads(antivirus_products)
        endpoint.firewall_products = firewall_products
        endpoint.antivirus_products = antivirus_products
        if firewall_products:
            endpoint.firewall_active = any(p.get("enabled") for p in firewall_products)
        if antivirus_products:
            endpoint.antivirus_active = any(p.get("enabled") for p in antivirus_products)
        disk_details = health_data.get("disk_details") or data.get("disk_details") or []
        if isinstance(disk_details, str):
            import json as _json; disk_details = _json.loads(disk_details)
        endpoint.disk_details = disk_details if isinstance(disk_details, list) else []
        endpoint.health_score, endpoint.health_status = calculate_health_score(
            endpoint.cpu_percent,
            endpoint.memory_percent,
            endpoint.disk_percent,
            endpoint.firewall_active,
            endpoint.antivirus_active,
        )
        
        # Store timestamp of last health check
        endpoint.last_health_check = now()

        if device_type == "vm":
            endpoint.wol_enabled = False

        endpoint.save()
        
        # ── Create metrics history snapshot ──────────────────────────────
        # Parse timestamp from agent or use current time
        metric_timestamp = now()
        timestamp_str = data.get("timestamp")
        if timestamp_str:
            try:
                # Try ISO format
                metric_timestamp = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
            except (ValueError, AttributeError):
                pass
        
        # Record this as a time-series data point
        EndpointMetricsHistory.objects.create(
            endpoint=endpoint,
            endpoint_device=endpoint_device,
            timestamp=metric_timestamp,
            cpu_percent=health_data.get("cpu_percent"),
            memory_percent=health_data.get("memory_percent"),
            disk_percent=health_data.get("disk_percent"),
            uptime_seconds=health_data.get("uptime_seconds"),
            health_status=endpoint.health_status,
            health_score=endpoint.health_score,
            firewall_active=health_data.get("firewall_active"),
            antivirus_active=health_data.get("antivirus_active"),
        )
        
        logger.info(
            f"Health monitoring received from {hostname} "
            f"(MAC: {mac_address}, health_status: {data.get('health_status')})"
        )
        
        return JsonResponse({
            "status": "ok",
            "message": "Health monitoring data received",
            "timestamp": datetime.now().isoformat()
        })
    
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)
    
    except Exception as e:
        logger.error(f"Health monitoring processing failed: {e}")
        return JsonResponse({"error": str(e)}, status=500)


@require_http_methods(["GET"])
def health_status(request, hostname):
    """Get latest health status for an endpoint.
    
    GET /api/endpoints/{hostname}/health/
    
    Returns latest health metrics for the endpoint.
    """
    try:
        endpoint = EndpointStatus.objects.get(hostname=hostname)
        
        response_data = {
            "hostname": endpoint.hostname,
            "mac_address": endpoint.mac_address,
            "os": endpoint.os,
            "ip_address": endpoint.ip_address,
            "last_seen": endpoint.last_seen.isoformat() if endpoint.last_seen else None,
            "last_health_check": endpoint.last_health_check.isoformat() if hasattr(endpoint, 'last_health_check') and endpoint.last_health_check else None,
            "presence": endpoint.presence,
            "presence_label": endpoint.presence_label,
            "cpu_percent": endpoint.cpu_percent,
            "memory_percent": endpoint.memory_percent,
            "disk_percent": endpoint.disk_percent,
            "uptime_seconds": endpoint.uptime_seconds,
            "health_status": endpoint.health_status,
            "health_score": endpoint.health_score,
        }
        
        return JsonResponse(response_data)
    
    except EndpointStatus.DoesNotExist:
        return JsonResponse({"error": f"Endpoint '{hostname}' not found"}, status=404)
    
    except Exception as e:
        logger.error(f"Error retrieving health status: {e}")
        return JsonResponse({"error": str(e)}, status=500)
