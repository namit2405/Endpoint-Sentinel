"""
Report storage abstraction layer.

Supports both Samba/local and S3 backends.
- Development: REPORT_STORAGE=samba → reads from local filesystem/Samba
- Production: REPORT_STORAGE=s3 → reads from S3, generates presigned URLs

Usage:
    from dashboard.services.report_storage import get_report_url
    
    report_url = get_report_url(report)  # Returns local path or presigned S3 URL
"""
import io
import logging
from pathlib import Path
from tempfile import NamedTemporaryFile

import boto3
from botocore.exceptions import ClientError
from django.conf import settings

logger = logging.getLogger(__name__)


def get_report_url(report):
    """
    Return a URL/path for accessing the HTML report.
    
    Args:
        report (EndpointReport): The report object
        
    Returns:
        str: Local file path (Samba) or presigned S3 GET URL (production)
        None: If report cannot be located
    """
    if settings.REPORT_STORAGE == "s3":
        return _get_s3_presigned_url(report)
    else:
        return _get_local_report_path(report)


def _get_local_report_path(report):
    """
    Return the local/Samba report file path.
    
    Args:
        report (EndpointReport): The report object
        
    Returns:
        str: File path or None if not found
    """
    if not report.report_file:
        logger.warning(f"Report {report.pk} has no report_file path")
        return None
    
    report_path = Path(report.report_file)
    if report_path.exists():
        return str(report_path)
    
    logger.warning(f"Report file not found: {report.report_file}")
    return None


def _get_s3_presigned_url(report):
    """
    Generate a presigned S3 GET URL for the report.
    
    Args:
        report (EndpointReport): The report object with s3_object_key
        
    Returns:
        str: Presigned URL or None if S3 key not set
    """
    if not report.s3_object_key:
        logger.warning(f"Report {report.pk} has no s3_object_key")
        return None
    
    try:
        s3_client = boto3.client("s3", region_name=settings.AWS_REGION)
        url = s3_client.generate_presigned_url(
            "get_object",
            Params={
                "Bucket": settings.AWS_REPORTS_BUCKET,
                "Key": report.s3_object_key,
            },
            ExpiresIn=300,  # 5 minutes
        )
        return url
    except ClientError as e:
        logger.error(f"Failed to generate presigned URL for {report.s3_object_key}: {e}")
        return None
    except Exception as e:
        logger.error(f"Unexpected error generating presigned URL: {e}")
        return None


def list_s3_reports(prefix=None):
    """
    List all report objects in S3.
    
    Args:
        prefix (str, optional): S3 prefix to filter results
        
    Yields:
        dict: S3 object metadata (Key, LastModified, Size, etc.)
    """
    if prefix is None:
        prefix = settings.AWS_REPORTS_PREFIX
    
    try:
        s3_client = boto3.client("s3", region_name=settings.AWS_REGION)
        paginator = s3_client.get_paginator("list_objects_v2")
        
        for page in paginator.paginate(
            Bucket=settings.AWS_REPORTS_BUCKET,
            Prefix=prefix,
        ):
            if "Contents" not in page:
                continue
            for obj in page["Contents"]:
                yield obj
    except ClientError as e:
        logger.error(f"Failed to list S3 objects under {prefix}: {e}")
    except Exception as e:
        logger.error(f"Unexpected error listing S3 objects: {e}")


def download_s3_report_to_temp(s3_object_key):
    """
    Download an S3 report object to a temporary file.
    
    Args:
        s3_object_key (str): Full S3 object key (e.g., "reports/Linux/SYSTEM-55/uuid-filename.html")
        
    Returns:
        file-like object: NamedTemporaryFile in binary mode, or None on failure
        
    Note:
        Caller must close the file when done.
    """
    try:
        s3_client = boto3.client("s3", region_name=settings.AWS_REGION)
        
        # Download to memory first
        response = s3_client.get_object(
            Bucket=settings.AWS_REPORTS_BUCKET,
            Key=s3_object_key,
        )
        
        # Create temporary file
        temp_file = NamedTemporaryFile(
            mode="w+b",
            suffix=".html",
            delete=False,
        )
        temp_file.write(response["Body"].read())
        temp_file.seek(0)
        
        return temp_file
    except ClientError as e:
        logger.error(f"Failed to download S3 object {s3_object_key}: {e}")
        return None
    except Exception as e:
        logger.error(f"Unexpected error downloading S3 object {s3_object_key}: {e}")
        return None


def discover_s3_reports():
    """
    Discover all HTML reports in S3 under the configured prefix.
    
    Returns:
        dict: Mapping of {s3_object_key: object_metadata}
    """
    reports = {}
    
    for obj in list_s3_reports():
        key = obj["Key"]
        # Only process .html files
        if not key.endswith(".html"):
            continue
        
        reports[key] = obj
    
    logger.info(f"Discovered {len(reports)} report(s) in S3")
    return reports
