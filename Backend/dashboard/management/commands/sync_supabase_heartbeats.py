"""
Sync heartbeat data from Supabase PostgreSQL to Django EndpointStatus.
Reads heartbeats sent directly by endpoint agents to Supabase and updates Django's last_seen.

Run periodically (e.g., every 10 seconds) to keep Django EndpointStatus in sync.
"""

from django.core.management.base import BaseCommand
from django.utils.timezone import now
from django.conf import settings
from dashboard.models import EndpointDevice, EndpointStatus
import psycopg2
import json
from datetime import timedelta


class Command(BaseCommand):
    help = 'Sync heartbeat data from Supabase to Django EndpointStatus'

    def add_arguments(self, parser):
        parser.add_argument(
            '--check-interval',
            type=int,
            default=60,
            help='Seconds to look back for heartbeats (default: 60)',
        )

    def handle(self, *args, **options):
        check_interval = options['check_interval']

        # Get Supabase connection details from settings
        db_host = settings.DATABASES['default'].get('HOST')
        db_port = settings.DATABASES['default'].get('PORT', 5432)
        db_user = settings.DATABASES['default'].get('USER')
        db_password = settings.DATABASES['default'].get('PASSWORD')
        db_name = settings.DATABASES['default'].get('NAME')

        if not all([db_host, db_user, db_password, db_name]):
            self.stdout.write(
                self.style.ERROR('Supabase database credentials not configured in settings')
            )
            return

        try:
            # Connect to Supabase PostgreSQL
            conn = psycopg2.connect(
                host=db_host,
                port=db_port,
                user=db_user,
                password=db_password,
                database=db_name,
                sslmode='require',
            )
            cursor = conn.cursor()

            # Query recent heartbeats from Supabase dashboard_endpointstatus table
            query = """
                SELECT hostname, mac_address, ip_address, agent_version, last_seen
                FROM dashboard_endpointstatus
                WHERE last_seen > NOW() - INTERVAL '%d seconds'
                ORDER BY hostname
            """ % check_interval

            cursor.execute(query)
            heartbeats = cursor.fetchall()

            self.stdout.write(
                self.style.SUCCESS(f'Found {len(heartbeats)} recent heartbeat(s) from Supabase')
            )

            updated = 0
            for hostname, mac_address, ip_address, agent_version, timestamp in heartbeats:
                endpoint_device, _ = EndpointDevice.objects.update_or_create(
                    mac_address=mac_address,
                    defaults={
                        'hostname': hostname,
                        'ip_address': ip_address,
                    },
                )
                # Update or create EndpointStatus in Django
                previous_last_seen = EndpointStatus.objects.filter(
                    hostname=hostname
                ).values_list('last_seen', flat=True).first()
                endpoint, created = EndpointStatus.objects.update_or_create(
                    hostname=hostname,
                    defaults={
                        'mac_address': mac_address,
                        'ip_address': ip_address,
                        'agent_version': agent_version,
                        'last_seen': timestamp,
                        'endpoint_device': endpoint_device,
                    }
                )
                if created or not endpoint.connection_started_at or (
                    previous_last_seen and timestamp - previous_last_seen > timedelta(minutes=2)
                ):
                    endpoint.connection_started_at = timestamp
                    endpoint.save(update_fields=['connection_started_at'])
                if created:
                    self.stdout.write(
                        self.style.SUCCESS(f'  ✓ Created: {hostname}')
                    )
                else:
                    self.stdout.write(
                        self.style.WARNING(f'  ⊘ Updated: {hostname}')
                    )
                updated += 1

            cursor.close()
            conn.close()

            self.stdout.write(
                self.style.SUCCESS(f'✓ Sync complete: {updated} endpoint(s) updated')
            )

        except psycopg2.Error as e:
            self.stdout.write(
                self.style.ERROR(f'Database error: {e}')
            )
        except Exception as e:
            self.stdout.write(
                self.style.ERROR(f'Error: {e}')
            )
