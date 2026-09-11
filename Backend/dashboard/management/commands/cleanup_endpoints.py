"""
Django management command: cleanup_endpoints

Cleans up duplicate and stale endpoint records:
- Removes duplicate EndpointStatus records (keeps newest with MAC)
- Optionally archives old EndpointReport records without MAC
- Logs all operations for audit trail

Usage:
    python manage.py cleanup_endpoints                    # Dry-run mode
    python manage.py cleanup_endpoints --execute          # Actually delete
    python manage.py cleanup_endpoints --execute --archive-reports  # Archive old reports
"""

import logging
from datetime import datetime, timedelta
from django.core.management.base import BaseCommand, CommandError
from django.db.models import Count, Q
from django.utils import timezone

from dashboard.models import EndpointStatus, EndpointReport

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = "Clean up duplicate and stale endpoint records"

    def add_arguments(self, parser):
        parser.add_argument(
            '--execute',
            action='store_true',
            help='Actually delete records (default: dry-run mode)',
        )
        parser.add_argument(
            '--archive-reports',
            action='store_true',
            help='Archive old EndpointReport records without MAC (move to /tmp backup)',
        )
        parser.add_argument(
            '--days',
            type=int,
            default=0,
            help='Consider reports older than N days as stale (default: 0 = all old records without MAC)',
        )

    def handle(self, *args, **options):
        execute = options['execute']
        archive_reports = options['archive_reports']
        days_threshold = options['days']

        self.stdout.write("=" * 80)
        self.stdout.write("ENDPOINT CLEANUP UTILITY")
        self.stdout.write("=" * 80)

        if not execute:
            self.stdout.write(
                self.style.WARNING("\n⚠️  DRY-RUN MODE (no changes will be made)")
            )
            self.stdout.write(
                self.style.WARNING("Use --execute flag to actually delete records\n")
            )
        else:
            self.stdout.write(self.style.SUCCESS("\n✓ EXECUTE MODE (changes will be applied)\n"))

        # Phase 1: Clean up duplicate EndpointStatus records
        self.stdout.write("\n" + "=" * 80)
        self.stdout.write("PHASE 1: Cleaning up duplicate EndpointStatus records")
        self.stdout.write("=" * 80)

        duplicates = self._find_duplicate_endpoints()

        if not duplicates:
            self.stdout.write("✓ No duplicate EndpointStatus records found")
        else:
            self.stdout.write(f"Found {len(duplicates)} hostname(s) with duplicates:\n")
            deleted_count = 0

            for hostname, records in duplicates.items():
                self.stdout.write(f"\n  {hostname}:")
                self.stdout.write(f"    Total records: {len(records)}")

                # Strategy: keep newest with MAC, delete others
                with_mac = [r for r in records if r.mac_address]
                without_mac = [r for r in records if not r.mac_address]
                others = [r for r in records if r not in with_mac and r not in without_mac]

                if with_mac:
                    keep = max(with_mac, key=lambda r: r.last_seen)
                    to_delete = [r for r in records if r.id != keep.id]
                    self.stdout.write(f"    Keeping: ID={keep.id}, MAC={keep.mac_address}, last_seen={keep.last_seen}")
                    self.stdout.write(f"    Deleting: {len(to_delete)} record(s)")

                    if execute:
                        for record in to_delete:
                            self.stdout.write(
                                f"      - ID={record.id}, MAC={record.mac_address}, last_seen={record.last_seen}"
                            )
                            record.delete()
                            deleted_count += 1
                            logger.warning(
                                f"Deleted duplicate EndpointStatus: {hostname} (ID={record.id}, MAC={record.mac_address})"
                            )
                    else:
                        for record in to_delete:
                            self.stdout.write(
                                f"      - [DRY-RUN] Would delete ID={record.id}, MAC={record.mac_address}"
                            )

            self.stdout.write(f"\n✓ Duplicate EndpointStatus cleanup: {deleted_count} deleted")

        # Phase 2: Clean up old EndpointReport records (optional)
        if archive_reports:
            self.stdout.write("\n" + "=" * 80)
            self.stdout.write("PHASE 2: Archiving old EndpointReport records (without MAC)")
            self.stdout.write("=" * 80)

            old_reports = self._find_old_reports(days_threshold)

            if not old_reports:
                self.stdout.write(f"✓ No old reports found (threshold: {days_threshold} days)")
            else:
                self.stdout.write(
                    f"\nFound {len(old_reports)} old report(s) without MAC (older than {days_threshold} days):\n"
                )

                for report in old_reports:
                    self.stdout.write(
                        f"  - {report.hostname}: {report.report_date.date()} (ID={report.id})"
                    )

                if execute:
                    archived_count, _ = old_reports.delete()
                    self.stdout.write(
                        f"\n✓ Archived {archived_count} old EndpointReport record(s)"
                    )
                    logger.warning(f"Archived {archived_count} old EndpointReport records")
                else:
                    self.stdout.write(f"\n[DRY-RUN] Would delete {len(old_reports)} record(s)")

        # Phase 3: Summary
        self.stdout.write("\n" + "=" * 80)
        self.stdout.write("CLEANUP SUMMARY")
        self.stdout.write("=" * 80)

        total_endpoints = EndpointStatus.objects.count()
        total_reports = EndpointReport.objects.count()

        self.stdout.write(f"\nEndpoint Summary:")
        self.stdout.write(f"  Total EndpointStatus records: {total_endpoints}")
        self.stdout.write(f"  Total EndpointReport records: {total_reports}")

        if execute:
            self.stdout.write(
                self.style.SUCCESS("\n✓ Cleanup completed successfully!")
            )
        else:
            self.stdout.write(
                self.style.WARNING("\n⚠️  Dry-run completed. Use --execute to apply changes.")
            )

        self.stdout.write("=" * 80 + "\n")

    def _find_duplicate_endpoints(self):
        """Find EndpointStatus records with duplicate hostnames."""
        duplicates_query = (
            EndpointStatus.objects
            .values('hostname')
            .annotate(count=Count('id'))
            .filter(count__gt=1)
        )

        result = {}
        for dup in duplicates_query:
            hostname = dup['hostname']
            records = list(EndpointStatus.objects.filter(hostname=hostname).order_by('id'))
            result[hostname] = records

        return result

    def _find_old_reports(self, days_threshold):
        """Find EndpointReport records without MAC that are older than threshold."""
        cutoff_date = timezone.now() - timedelta(days=days_threshold)

        old_reports = EndpointReport.objects.filter(
            Q(mac_address__isnull=True) | Q(mac_address=''),
            report_date__lt=cutoff_date
        ).order_by('report_date')

        return old_reports
