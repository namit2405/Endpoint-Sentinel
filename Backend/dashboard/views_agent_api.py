"""
Agent API endpoints for version checking, configuration, and task management.

Provides:
- /api/agent/manifest - Update manifest for Linux agent
- /api/agent/config - Agent configuration
- /api/agent/heartbeat - Heartbeat submission
"""

import json
import logging
from datetime import datetime

from django.http import JsonResponse
from django.views.decorators.http import require_http_methods
from django.views.decorators.csrf import csrf_exempt
from django.conf import settings
from django.core.files.base import ContentFile
import boto3

from dashboard.models import EndpointDevice, EndpointReport, EndpointStatus

logger = logging.getLogger(__name__)


@csrf_exempt
@require_http_methods(["GET"])
def agent_manifest(request):
    """Get latest agent manifest for updates.
    
    Returns JSON manifest with version, download URL, checksum, etc.
    """
    try:
        # For now, return a placeholder manifest
        # In production, this would read from database or S3
        manifest = {
            "version": "0.1.0",
            "release_date": "2026-09-01",
            "download_url": f"{request.build_absolute_uri('/')}/api/agent/download",
            "checksum": "placeholder_sha256_hash",
            "changelog": "Initial release\n- Audit report generation\n- Heartbeat transmission",
            "min_version": "0.0.1",
            "required": False,
            "notes": "First version of the agent"
        }
        
        return JsonResponse(manifest)
    
    except Exception as e:
        logger.error(f"Agent manifest request failed: {e}")
        return JsonResponse({"error": str(e)}, status=500)


@csrf_exempt
@require_http_methods(["GET"])
def agent_config(request):
    """Get agent configuration.
    
    Returns task schedules, server URL, etc.
    """
    try:
        hostname = request.GET.get("hostname", "")
        os_type = request.GET.get("os_type", "linux")
        
        config = {
            "server_url": request.build_absolute_uri("/"),
            "api_key": settings.HEARTBEAT_API_KEY,
            "auto_update": True,
            "heartbeat_interval": 60,
            "audit_report_schedule": "02:00",  # 2 AM daily
            "tasks": [
                {
                    "name": "audit_report",
                    "type": "daily",
                    "schedule_time": "02:00",
                    "enabled": True,
                }
            ]
        }
        
        return JsonResponse(config)
    
    except Exception as e:
        logger.error(f"Agent config request failed: {e}")
        return JsonResponse({"error": str(e)}, status=500)


@csrf_exempt
@require_http_methods(["POST"])
def agent_heartbeat(request):
    """Receive heartbeat from agent.
    
    Updates EndpointStatus with current machine status.
    Primary key is MAC address for unique identification.
    """
    try:
        data = json.loads(request.body)
        
        mac_address = data.get("mac_address", "").strip()
        hostname = data.get("hostname", "").strip()
        os_type = data.get("os_type", "").strip()
        reported_ip = data.get("ip_address", "").strip()
        agent_version = data.get("agent_version", "").strip()
        
        if not mac_address:
            return JsonResponse({"error": "mac_address required"}, status=400)

        endpoint_device, _ = EndpointDevice.objects.update_or_create(
            mac_address=mac_address,
            defaults={
                "hostname": hostname or "Unknown",
                "os": os_type or "linux",
                "ip_address": reported_ip or None,
            },
        )
        
        # Update or create EndpointStatus by MAC address (primary key)
        endpoint_status, created = EndpointStatus.objects.update_or_create(
            mac_address=mac_address,
            defaults={
                "hostname": hostname or "Unknown",
                "os": os_type or "linux",
                "ip_address": reported_ip or None,
                "agent_version": agent_version or "unknown",
                "last_seen": datetime.now(),
                "endpoint_device": endpoint_device,
            }
        )
        
        logger.info(f"Heartbeat received from {hostname or mac_address} (MAC: {mac_address}, IP: {reported_ip or 'not provided'})")
        
        return JsonResponse({
            "status": "ok",
            "message": "Heartbeat received",
            "mac_address": mac_address,
            "timestamp": datetime.now().isoformat()
        })
    
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)
    
    except Exception as e:
        logger.error(f"Heartbeat processing failed: {e}")
        return JsonResponse({"error": str(e)}, status=500)


@csrf_exempt
@require_http_methods(["POST"])
def agent_audit_report(request):
    """Receive audit report from agent.
    
    Stores HTML report and creates EndpointReport record.
    Links report to EndpointStatus via MAC address.
    """
    try:
        hostname = request.POST.get("hostname")
        os_type = request.POST.get("os_type")
        mac_address = request.POST.get("mac_address")  # NEW: capture MAC
        report_file = request.FILES.get("report")
        
        if not hostname or not report_file:
            return JsonResponse({"error": "hostname and report file required"}, status=400)
        
        # Read and parse report
        from dashboard.management.commands.import_reports import Command
        cmd = Command()
        
        # Save report to S3 if configured
        if settings.REPORT_STORAGE == "s3":
            try:
                s3_client = boto3.client("s3", region_name=settings.AWS_REGION)
                
                # Generate S3 key with MAC in path for traceability
                import uuid
                report_id = str(uuid.uuid4())
                filename = report_file.name
                
                # Include MAC in S3 path if available
                if mac_address:
                    s3_key = f"reports/{os_type}/{hostname}/{mac_address}/{report_id}-{filename}"
                else:
                    s3_key = f"reports/{os_type}/{hostname}/{report_id}-{filename}"
                
                # Upload to S3
                s3_client.upload_fileobj(
                    report_file,
                    settings.AWS_REPORTS_BUCKET,
                    s3_key,
                    ExtraArgs={"ContentType": "text/html"}
                )
                
                logger.info(f"Report uploaded to S3: {s3_key}")
                
                # Create EndpointReport record with MAC address
                EndpointReport.objects.create(
                    endpoint_device=EndpointDevice.objects.filter(
                        mac_address=mac_address
                    ).first() if mac_address else None,
                    hostname=hostname,
                    os_type=os_type,
                    mac_address=mac_address,  # NEW: store MAC
                    s3_object_key=s3_key,
                    report_date=datetime.now(),
                )
                
                # EventBridge will trigger import via SQS
                # For now, acknowledge upload
                
                return JsonResponse({
                    "status": "ok",
                    "message": "Report received and uploaded to S3",
                    "s3_key": s3_key,
                })
            
            except Exception as e:
                logger.error(f"S3 upload failed: {e}")
                return JsonResponse({"error": f"S3 upload failed: {e}"}, status=500)
        
        else:
            # Local storage (for development)
            logger.info(f"Report received from {hostname}")
            
            return JsonResponse({
                "status": "ok",
                "message": "Report received",
                "timestamp": datetime.now().isoformat(),
            })
    
    except Exception as e:
        logger.error(f"Audit report processing failed: {e}")
        return JsonResponse({"error": str(e)}, status=500)
