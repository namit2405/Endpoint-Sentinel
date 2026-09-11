"""
Fetch audit reports from Filebase S3-compatible storage
and import them into the database.
"""
import os
import boto3
from django.core.management.base import BaseCommand
from django.conf import settings
from dashboard.models import EndpointReport, EndpointStatus
import re
from datetime import datetime


class Command(BaseCommand):
    help = "Fetch audit reports from Filebase S3 bucket and import into database"

    def add_arguments(self, parser):
        parser.add_argument(
            '--bucket',
            type=str,
            default=settings.FILEBASE_BUCKET,
            help='Filebase bucket name (default from settings)'
        )
        parser.add_argument(
            '--download-dir',
            type=str,
            default='/tmp/filebase_reports',
            help='Local directory to download reports'
        )
        parser.add_argument(
            '--limit',
            type=int,
            default=0,
            help='Limit number of reports to fetch (0=all)'
        )
        parser.add_argument(
            '--force',
            action='store_true',
            help='Re-import reports that already exist'
        )

    def handle(self, *args, **options):
        bucket = options['bucket']
        download_dir = options['download_dir']
        limit = options['limit']
        force = options['force']

        self.stdout.write(f"Connecting to Filebase bucket: {bucket}")

        try:
            # Create S3 client
            s3 = boto3.client(
                's3',
                endpoint_url=settings.FILEBASE_ENDPOINT,
                aws_access_key_id=settings.FILEBASE_ACCESS_KEY,
                aws_secret_access_key=settings.FILEBASE_SECRET_KEY,
                region_name='us-east-1'
            )

            # List objects in bucket
            self.stdout.write("Listing reports from Filebase...")
            response = s3.list_objects_v2(Bucket=bucket, Prefix='Linux/')

            if 'Contents' not in response:
                self.stdout.write(self.style.WARNING('No reports found in Filebase'))
                return

            objects = response['Contents']
            self.stdout.write(f"Found {len(objects)} objects in Filebase")

            # Create download directory
            os.makedirs(download_dir, exist_ok=True)

            count = 0
            for obj in objects:
                if limit > 0 and count >= limit:
                    break

                key = obj['Key']

                # Only process HTML files
                if not key.endswith('.html'):
                    continue

                self.stdout.write(f"\nProcessing: {key}")

                # Extract hostname and MAC from path
                # Path format: Linux/hostname/uuid-hostname.html
                parts = key.split('/')
                if len(parts) < 3:
                    continue

                hostname = parts[1]
                filename = parts[2]

                # Download file
                local_path = os.path.join(download_dir, hostname)
                os.makedirs(local_path, exist_ok=True)
                file_path = os.path.join(local_path, filename)

                try:
                    s3.download_file(bucket, key, file_path)
                    self.stdout.write(self.style.SUCCESS(f"  ✓ Downloaded: {file_path}"))

                    # Try to import into database
                    self._import_report(file_path, hostname, key, force)
                    count += 1

                except Exception as e:
                    self.stdout.write(self.style.ERROR(f"  ✗ Error: {e}"))

            self.stdout.write(self.style.SUCCESS(f"\n✓ Imported {count} reports from Filebase"))

        except Exception as e:
            self.stdout.write(self.style.ERROR(f"Failed to connect to Filebase: {e}"))
            self.stdout.write("Check FILEBASE_* settings in .env")

    def _import_report(self, file_path, hostname, s3_key, force):
        """Import a report file into the database"""
        try:
            # Get or create EndpointStatus
            endpoint = EndpointStatus.objects.filter(hostname=hostname).first()
            if not endpoint:
                self.stdout.write(self.style.WARNING(f"  ⚠ No EndpointStatus for {hostname}"))
                return

            # Check if report already exists
            existing = EndpointReport.objects.filter(
                endpoint_status=endpoint,
                s3_object_key=s3_key
            ).exists()

            if existing and not force:
                self.stdout.write(f"  ℹ Report already imported (skip, use --force to re-import)")
                return

            # Read file
            with open(file_path, 'r') as f:
                html_content = f.read()

            # Extract MAC from EndpointStatus
            mac = endpoint.mac_address or 'unknown'

            # Create report record
            report = EndpointReport(
                endpoint_status=endpoint,
                s3_object_key=s3_key,
                html_content=html_content,
                mac_address=mac
            )
            report.save()

            self.stdout.write(self.style.SUCCESS(f"  ✓ Imported: {hostname}"))

        except Exception as e:
            self.stdout.write(self.style.ERROR(f"  ✗ Import failed: {e}"))
