"""
Django management command: process_s3_events

Continuously polls SQS for S3 report events from EventBridge:
- Object Created → download, parse, store in DB
- Object Deleted → remove from DB

Usage:
    python manage.py process_s3_events          # continuous polling
    python manage.py process_s3_events --once   # process once and exit

Architecture:
    S3 bucket (endpoint-dashboard-reports-921876749346)
        ↓
    EventBridge rule (Object Created/Deleted events)
        ↓
    SQS queue (endpoint-dashboard-report-events)
        ↓
    This command (long polling, SQS_WAIT_TIME=20 seconds)
        ↓
    Download/parse/store
        ↓
    Delete from SQS only on success
"""
import json
import logging
import sys
import re
from datetime import datetime
from tempfile import NamedTemporaryFile
from pathlib import Path

import boto3
from botocore.exceptions import ClientError
from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import transaction

from dashboard.models import EndpointReport
from dashboard.risk import calculate
from dashboard.services.report_storage import download_s3_report_to_temp

logger = logging.getLogger(__name__)

# S3 key format: reports/{os_type}/{hostname}/{mac_address}/{uuid}-{filename}.html
S3_KEY_PATTERN = re.compile(
    r'^reports/(Linux|Windows|macOS)/([^/]+)/([a-fA-F0-9:]{17})/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}-(.+)\.html$'
)

# Fields returned by parsers that map directly to model columns
_MODEL_FIELDS = {f.name for f in EndpointReport._meta.get_fields()}


def _extract_model_kwargs(data: dict) -> dict:
    """Extract model fields from parser output."""
    kwargs = {}
    for key, value in data.items():
        if key in _MODEL_FIELDS and key not in ("id", "imported_at", "hostname", "report_date"):
            kwargs[key] = value
    return kwargs


class Command(BaseCommand):
    help = "Process S3 report events from SQS queue"

    def add_arguments(self, parser):
        parser.add_argument(
            '--once',
            action='store_true',
            help='Process one batch and exit (for testing)',
        )

    def handle(self, *args, **options):
        """Main command handler."""
        try:
            self.sqs_client = boto3.client('sqs', region_name=settings.SQS_REGION)
        except Exception as e:
            self.stderr.write(self.style.ERROR(f"Failed to create SQS client: {e}"))
            sys.exit(1)

        try:
            from parsers import linux_parser, macos_parser, windows_parser
        except ImportError as e:
            self.stderr.write(self.style.ERROR(
                f"Could not import parsers: {e}\n"
                "Make sure the project root is on PYTHONPATH."
            ))
            sys.exit(1)

        self.parser_map = {
            'linux': linux_parser,
            'macos': macos_parser,
            'windows': windows_parser,
        }

        self.stdout.write(self.style.SUCCESS("Starting S3 event processor"))
        self.stdout.write(f"  Queue: {settings.SQS_QUEUE_URL}")
        self.stdout.write(f"  Region: {settings.SQS_REGION}")
        self.stdout.write(f"  Wait time: {settings.SQS_WAIT_TIME}s")
        self.stdout.write(f"  Max messages: {settings.SQS_MAX_MESSAGES}")

        if options['once']:
            self._process_batch()
            self.stdout.write(self.style.SUCCESS("Processed one batch and exiting"))
        else:
            # Continuous polling
            try:
                while True:
                    self._process_batch()
            except KeyboardInterrupt:
                self.stdout.write(self.style.WARNING("\nShutdown requested"))
                sys.exit(0)

    def _process_batch(self):
        """Poll SQS for messages and process them."""
        try:
            response = self.sqs_client.receive_message(
                QueueUrl=settings.SQS_QUEUE_URL,
                MaxNumberOfMessages=settings.SQS_MAX_MESSAGES,
                WaitTimeSeconds=settings.SQS_WAIT_TIME,
                AttributeNames=['All'],
                MessageAttributeNames=['All'],
            )
        except ClientError as e:
            self.stderr.write(self.style.ERROR(f"SQS ReceiveMessage failed: {e}"))
            return

        messages = response.get('Messages', [])
        if not messages:
            # No messages (timeout after WaitTimeSeconds)
            return

        self.stdout.write(f"Received {len(messages)} message(s)")

        for message in messages:
            self._process_message(message)

    def _process_message(self, message: dict):
        """Process a single SQS message."""
        message_id = message.get('MessageId', 'unknown')
        receipt_handle = message.get('ReceiptHandle')

        try:
            # Parse SQS message
            body = json.loads(message.get('Body', '{}'))

            # Extract EventBridge detail
            detail = body.get('detail', {})
            detail_type = body.get('detail-type', '')

            # Validate and route
            if detail_type == 'Object Created':
                self._handle_object_created(detail, message_id)
            elif detail_type == 'Object Deleted':
                self._handle_object_deleted(detail, message_id)
            else:
                self.stdout.write(
                    self.style.WARNING(f"  SKIP  {message_id}: unknown detail-type '{detail_type}'")
                )
                # Still delete unsupported events (don't retry)

            # Delete message only after successful processing
            self._delete_message(receipt_handle, message_id)

        except Exception as e:
            self.stderr.write(
                self.style.ERROR(f"  ERROR {message_id}: {e}")
            )
            # Do NOT delete on error → message returns to queue after visibility timeout
            logger.exception(f"Error processing SQS message {message_id}")

    def _handle_object_created(self, detail: dict, message_id: str):
        """Handle Object Created event.
        
        Idempotency strategy:
        - s3_object_key is the primary identity for S3 events (must be unique)
        - Query by s3_object_key first
        - If record exists with same s3_object_key → idempotent (do nothing)
        - If no record with s3_object_key → create new
        - Multiple different s3_object_keys for same hostname/report_date are allowed
          (e.g., report at 2pm, then another at 3pm = different records)
        """
        # Extract bucket and key
        bucket = detail.get('bucket', {}).get('name', '')
        s3_key = detail.get('object', {}).get('key', '')

        # Validate bucket
        if bucket != settings.AWS_REPORTS_BUCKET:
            self.stdout.write(
                self.style.WARNING(
                    f"  SKIP  {message_id}: wrong bucket '{bucket}' (expected '{settings.AWS_REPORTS_BUCKET}')"
                )
            )
            return

        # Validate key format
        match = S3_KEY_PATTERN.match(s3_key)
        if not match:
            self.stdout.write(
                self.style.WARNING(f"  SKIP  {message_id}: invalid key format '{s3_key}'")
            )
            return

        os_type_str, hostname, mac_address, filename = match.groups()
        os_type_lower = os_type_str.lower()

        # Get parser
        parser = self.parser_map.get(os_type_lower)
        if not parser:
            self.stdout.write(
                self.style.WARNING(f"  SKIP  {message_id}: unknown OS type '{os_type_str}'")
            )
            return

        # Download and parse
        temp_file = None
        try:
            temp_file = download_s3_report_to_temp(s3_key)
            if not temp_file:
                self.stderr.write(
                    self.style.ERROR(f"  ERROR {message_id}: failed to download {s3_key}")
                )
                return

            data = parser.parse(temp_file.name)

        except Exception as e:
            self.stderr.write(
                self.style.ERROR(f"  ERROR {message_id}: parse failed for {s3_key}: {e}")
            )
            logger.exception(f"Parse error for {s3_key}")
            return

        finally:
            if temp_file:
                temp_file.close()
                try:
                    Path(temp_file.name).unlink()
                except Exception:
                    pass

        # Risk scoring
        score, level, _ = calculate(data)
        data['risk_score'] = score
        data['risk_level'] = level

        # Extract fields
        report_hostname = data.get('hostname', hostname)
        report_date = data.get('report_date')
        bios = data.get('bios_version', '') or data.get('raw_data', {}).get('bios', '')

        defaults = _extract_model_kwargs(data)
        defaults['s3_object_key'] = s3_key  # Store exact S3 key
        defaults['mac_address'] = mac_address  # NEW: store MAC from S3 path
        if bios:
            defaults['bios_version'] = bios

        # Store in database (idempotent by s3_object_key)
        try:
            with transaction.atomic():
                # Query by s3_object_key FIRST (primary identity)
                # If this s3_object_key already exists → idempotent (do nothing)
                # If not → create new record
                obj, created = EndpointReport.objects.get_or_create(
                    s3_object_key=s3_key,
                    defaults={
                        'hostname': report_hostname,
                        'report_date': report_date,
                        **defaults,
                    },
                )

                if created:
                    self.stdout.write(
                        self.style.SUCCESS(
                            f"  CREATED {message_id}: {s3_key} [{level.upper()} {score}]"
                        )
                    )
                else:
                    # Same s3_object_key processed again (idempotent)
                    self.stdout.write(
                        f"  IDEMPOTENT {message_id}: {s3_key} (already processed)"
                    )

        except Exception as e:
            self.stderr.write(
                self.style.ERROR(f"  DB ERROR {message_id}: {e}")
            )
            logger.exception(f"Database error for {s3_key}")
            raise

    def _handle_object_deleted(self, detail: dict, message_id: str):
        """Handle Object Deleted event."""
        # Extract bucket and key
        bucket = detail.get('bucket', {}).get('name', '')
        s3_key = detail.get('object', {}).get('key', '')

        # Validate bucket
        if bucket != settings.AWS_REPORTS_BUCKET:
            self.stdout.write(
                self.style.WARNING(
                    f"  SKIP  {message_id}: wrong bucket '{bucket}' (expected '{settings.AWS_REPORTS_BUCKET}')"
                )
            )
            return

        # Validate key format
        match = S3_KEY_PATTERN.match(s3_key)
        if not match:
            self.stdout.write(
                self.style.WARNING(f"  SKIP  {message_id}: invalid key format '{s3_key}'")
            )
            return

        # Find and delete record
        try:
            count, _ = EndpointReport.objects.filter(s3_object_key=s3_key).delete()
            if count > 0:
                self.stdout.write(
                    self.style.SUCCESS(f"  DELETED {message_id}: {s3_key} ({count} record(s))")
                )
            else:
                self.stdout.write(
                    f"  NOT FOUND {message_id}: {s3_key} (record doesn't exist, treating as success)"
                )

        except Exception as e:
            self.stderr.write(
                self.style.ERROR(f"  DB ERROR {message_id}: {e}")
            )
            logger.exception(f"Database error deleting {s3_key}")
            raise

    def _delete_message(self, receipt_handle: str, message_id: str):
        """Delete message from SQS after successful processing."""
        try:
            self.sqs_client.delete_message(
                QueueUrl=settings.SQS_QUEUE_URL,
                ReceiptHandle=receipt_handle,
            )
        except ClientError as e:
            self.stderr.write(
                self.style.ERROR(f"  DELETE FAILED {message_id}: {e}")
            )
            logger.exception(f"Failed to delete SQS message {message_id}")
            # Don't raise, just log (message will retry)
