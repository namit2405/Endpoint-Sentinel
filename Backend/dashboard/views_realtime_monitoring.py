"""
Real-Time Monitoring API Endpoints

Provides current and historical metrics for CPU/memory/disk monitoring.
Supports time-series data aggregation for chart visualization.

Endpoints:
  GET  /api/endpoints/current/              — latest metrics for all endpoints
  GET  /api/endpoints/<hostname>/history/   — historical metrics for one endpoint
  POST /api/endpoints/health-history/       — agents post new metric snapshots
"""

import json
import logging
from datetime import datetime, timedelta

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from django.utils.timezone import now
from django.db.models import Q

from .models import EndpointStatus, EndpointMetricsHistory

logger = logging.getLogger(__name__)


@require_http_methods(["GET"])
def current_metrics(request):
    """Get latest CPU/memory/disk metrics for all endpoints.
    
    GET /api/endpoints/current/
    
    Returns:
    {
        "endpoints": [
            {
                "id": 1,
                "hostname": "PC01",
                "mac_address": "AA:BB:CC:DD:EE:FF",
                "presence": "online",
                "cpu_percent": 45.2,
                "memory_percent": 50.0,
                "disk_percent": 50.0,
                "firewall_active": true,
                "antivirus_active": true,
                "health_status": "healthy",
                "health_score": 82.5,
                "last_health_check": "2026-09-01T12:34:56Z",
                "last_seen": "2026-09-01T12:34:56Z"
            }
        ]
    }
    """
    try:
        endpoints = EndpointStatus.objects.all()
        
        data = {
            "endpoints": [],
            "timestamp": now().isoformat(),
            "count": endpoints.count()
        }
        
        for endpoint in endpoints:
            data["endpoints"].append({
                "id": endpoint.id,
                "hostname": endpoint.hostname,
                "mac_address": endpoint.mac_address,
                "presence": endpoint.presence,
                "cpu_percent": endpoint.cpu_percent,
                "memory_percent": endpoint.memory_percent,
                "disk_percent": endpoint.disk_percent,
                "firewall_active": endpoint.firewall_active,
                "antivirus_active": endpoint.antivirus_active,
                "health_status": endpoint.health_status,
                "health_score": endpoint.health_score,
                "last_health_check": endpoint.last_health_check.isoformat() if endpoint.last_health_check else None,
                "last_seen": endpoint.last_seen.isoformat() if endpoint.last_seen else None,
            })
        
        return JsonResponse(data)
    
    except Exception as e:
        logger.error(f"Error fetching current metrics: {e}")
        return JsonResponse({"error": str(e)}, status=500)


@require_http_methods(["GET"])
def historical_metrics(request, hostname):
    """Get historical metrics for a specific endpoint.
    
    GET /api/endpoints/<hostname>/history/
    
    Query Parameters:
        limit=120      — number of snapshots to return (default: 120)
        interval=60    — aggregate snapshots by N seconds (default: no aggregation)
        hours=24       — fetch data from last N hours (default: 24)
    
    Returns:
    {
        "hostname": "PC01",
        "mac_address": "AA:BB:CC:DD:EE:FF",
        "history": [
            {
                "timestamp": "2026-09-01T12:00:00Z",
                "cpu_percent": 45.2,
                "memory_percent": 50.0,
                "disk_percent": 50.0,
                "health_status": "healthy",
                "health_score": 82.5,
                "firewall_active": true,
                "antivirus_active": true
            }
        ]
    }
    """
    try:
        # Get query parameters
        limit = int(request.GET.get("limit", 120))
        interval = int(request.GET.get("interval", 0))
        hours = int(request.GET.get("hours", 24))
        
        # Validate limits
        limit = min(max(limit, 1), 1000)  # 1-1000 range
        
        # Get endpoint
        try:
            endpoint = EndpointStatus.objects.get(hostname=hostname)
        except EndpointStatus.DoesNotExist:
            return JsonResponse({"error": f"Endpoint '{hostname}' not found"}, status=404)
        
        # Time range
        cutoff_time = now() - timedelta(hours=hours)
        
        # Query metrics
        metrics = EndpointMetricsHistory.objects.filter(
            endpoint=endpoint,
            timestamp__gte=cutoff_time
        ).order_by('-timestamp')[:limit]
        
        # Build response
        history = []
        for metric in reversed(metrics):
            history.append({
                "timestamp": metric.timestamp.isoformat(),
                "cpu_percent": metric.cpu_percent,
                "memory_percent": metric.memory_percent,
                "disk_percent": metric.disk_percent,
                "health_status": metric.health_status,
                "health_score": metric.health_score,
                "firewall_active": metric.firewall_active,
                "antivirus_active": metric.antivirus_active,
            })
        
        return JsonResponse({
            "hostname": endpoint.hostname,
            "mac_address": endpoint.mac_address,
            "history": history,
            "count": len(history),
            "timestamp": now().isoformat()
        })
    
    except Exception as e:
        logger.error(f"Error fetching historical metrics for {hostname}: {e}")
        return JsonResponse({"error": str(e)}, status=500)


@require_http_methods(["GET"])
def health_history(request):
    """Get historical metrics for all endpoints or filtered set.
    
    GET /api/endpoints/health-history/
    
    Query Parameters:
        limit=120      — snapshots per endpoint (default: 120)
        interval=60    — aggregate by N seconds (default: no aggregation)
        hours=24       — fetch from last N hours (default: 24)
        mac_address=   — filter by MAC address (optional)
        health=        — filter by health_status (healthy|warning|critical, optional)
    
    Returns:
    {
        "endpoints": [
            {
                "hostname": "PC01",
                "mac_address": "AA:BB:CC:DD:EE:FF",
                "presence": "online",
                "health_status": "healthy",
                "history": [
                    {
                        "timestamp": "2026-09-01T12:00:00Z",
                        "cpu_percent": 45.2,
                        "memory_percent": 50.0,
                        "disk_percent": 50.0,
                        "health_status": "healthy",
                        "health_score": 82.5
                    }
                ]
            }
        ],
        "timestamp": "2026-09-01T12:34:56Z"
    }
    """
    try:
        # Get query parameters
        limit = int(request.GET.get("limit", 120))
        interval = int(request.GET.get("interval", 0))
        hours = int(request.GET.get("hours", 24))
        mac_address_filter = request.GET.get("mac_address", "").strip()
        health_filter = request.GET.get("health", "").strip()
        
        # Validate limits
        limit = min(max(limit, 1), 1000)
        
        # Build query
        query = Q()
        
        if mac_address_filter:
            query &= Q(endpoint__mac_address=mac_address_filter)
        
        if health_filter and health_filter in ['healthy', 'warning', 'critical']:
            query &= Q(health_status=health_filter)
        
        # Time range
        cutoff_time = now() - timedelta(hours=hours)
        
        # Get endpoints with recent metrics
        endpoints_with_data = EndpointStatus.objects.filter(
            metrics_history__timestamp__gte=cutoff_time
        ).distinct()
        
        if mac_address_filter:
            endpoints_with_data = endpoints_with_data.filter(mac_address=mac_address_filter)
        
        response_data = {
            "endpoints": [],
            "timestamp": now().isoformat(),
            "count": endpoints_with_data.count()
        }
        
        # Build history for each endpoint
        for endpoint in endpoints_with_data:
            metrics = EndpointMetricsHistory.objects.filter(
                endpoint=endpoint,
                timestamp__gte=cutoff_time
            ).order_by('-timestamp')[:limit]
            
            if health_filter and health_filter in ['healthy', 'warning', 'critical']:
                metrics = metrics.filter(health_status=health_filter)
            
            history = []
            for metric in reversed(metrics):
                history.append({
                    "timestamp": metric.timestamp.isoformat(),
                    "cpu_percent": metric.cpu_percent,
                    "memory_percent": metric.memory_percent,
                    "disk_percent": metric.disk_percent,
                    "health_status": metric.health_status,
                    "health_score": metric.health_score,
                    "firewall_active": metric.firewall_active,
                    "antivirus_active": metric.antivirus_active,
                })
            
            response_data["endpoints"].append({
                "hostname": endpoint.hostname,
                "mac_address": endpoint.mac_address,
                "presence": endpoint.presence,
                "health_status": endpoint.health_status,
                "health_score": endpoint.health_score,
                "history": history,
                "history_count": len(history)
            })
        
        return JsonResponse(response_data)
    
    except Exception as e:
        logger.error(f"Error fetching health history: {e}")
        return JsonResponse({"error": str(e)}, status=500)


@csrf_exempt
@require_http_methods(["POST"])
def record_health_snapshot(request):
    """Agents post health snapshot data to be stored in history.
    
    POST /api/endpoints/health-history/
    
    Body (JSON):
    {
        "hostname": "PC01",
        "mac_address": "AA:BB:CC:DD:EE:FF",
        "timestamp": "2026-09-01T12:34:56.123456",
        "cpu_percent": 45.2,
        "memory_percent": 50.0,
        "disk_percent": 50.0,
        "health_status": "healthy",
        "health_score": 82.5,
        "firewall_active": true,
        "antivirus_active": true
    }
    
    Returns:
    {
        "status": "ok",
        "message": "Metrics snapshot recorded",
        "id": 12345
    }
    """
    try:
        data = json.loads(request.body)
        
        hostname = data.get("hostname", "").strip()
        mac_address = data.get("mac_address", "").strip()
        
        if not hostname or not mac_address:
            return JsonResponse(
                {"error": "hostname and mac_address required"},
                status=400
            )
        
        # Find or verify endpoint exists
        try:
            endpoint = EndpointStatus.objects.get(mac_address=mac_address)
        except EndpointStatus.DoesNotExist:
            return JsonResponse(
                {"error": f"Endpoint with MAC {mac_address} not found"},
                status=404
            )
        
        # Parse timestamp or use now
        timestamp_str = data.get("timestamp")
        if timestamp_str:
            try:
                # Try ISO format
                timestamp = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
            except (ValueError, AttributeError):
                timestamp = now()
        else:
            timestamp = now()
        
        # Create metrics history record
        metric_record = EndpointMetricsHistory.objects.create(
            endpoint=endpoint,
            timestamp=timestamp,
            cpu_percent=data.get("cpu_percent"),
            memory_percent=data.get("memory_percent"),
            disk_percent=data.get("disk_percent"),
            health_status=data.get("health_status", "healthy"),
            health_score=data.get("health_score", 100.0),
            firewall_active=data.get("firewall_active"),
            antivirus_active=data.get("antivirus_active"),
        )
        
        logger.info(
            f"Health snapshot recorded for {hostname} "
            f"(CPU: {data.get('cpu_percent')}%, "
            f"Memory: {data.get('memory_percent')}%, "
            f"Status: {data.get('health_status')})"
        )
        
        return JsonResponse({
            "status": "ok",
            "message": "Metrics snapshot recorded",
            "id": metric_record.id,
            "timestamp": now().isoformat()
        })
    
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)
    
    except Exception as e:
        logger.error(f"Error recording health snapshot: {e}")
        return JsonResponse({"error": str(e)}, status=500)
