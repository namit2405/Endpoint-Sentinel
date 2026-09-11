"""
Management command to start background scheduler for fetching B2 reports.

Runs APScheduler to fetch fresh audit reports from Backblaze B2 every 1 minute.

Usage:
    python manage.py start_scheduler
"""
import logging
from apscheduler.schedulers.background import BackgroundScheduler
from django.core.management.base import BaseCommand
from django.core.management import call_command

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = 'Start background scheduler for fetching B2 reports'

    def handle(self, *args, **options):
        scheduler = BackgroundScheduler()

        def fetch_b2_reports_task():
            """Fetch fresh reports from B2 every 1 minute."""
            try:
                self.stdout.write(f'[Scheduler] Fetching reports from B2...')
                call_command('fetch_b2_reports')
            except Exception as e:
                logger.error(f'Failed to fetch B2 reports: {e}')
                self.stderr.write(f'Error fetching B2 reports: {e}')

        def sync_supabase_heartbeats_task():
            """Sync heartbeats from Supabase every 10 seconds."""
            try:
                call_command('sync_supabase_heartbeats', check_interval=60)
            except Exception as e:
                logger.error(f'Failed to sync Supabase heartbeats: {e}')

        # Add job: fetch B2 reports every 1 minute
        scheduler.add_job(
            fetch_b2_reports_task,
            'interval',
            minutes=1,
            id='fetch_b2_reports',
            name='Fetch B2 Reports',
            replace_existing=True,
        )

        # Add job: sync Supabase heartbeats every 10 seconds
        scheduler.add_job(
            sync_supabase_heartbeats_task,
            'interval',
            seconds=10,
            id='sync_supabase_heartbeats',
            name='Sync Supabase Heartbeats',
            replace_existing=True,
        )

        scheduler.start()

        self.stdout.write(self.style.SUCCESS('✓ Background scheduler started'))
        self.stdout.write(self.style.SUCCESS('✓ B2 reports will be fetched every 1 minute'))
        self.stdout.write(self.style.SUCCESS('✓ Supabase heartbeats will be synced every 10 seconds'))

        try:
            # Keep scheduler running
            import time
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            scheduler.shutdown()
            self.stdout.write(self.style.WARNING('✓ Scheduler stopped'))
