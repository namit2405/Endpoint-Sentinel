"""
Management command to fetch audit reports from Backblaze B2 and import them into Django.

Uses boto3 (S3-compatible API) instead of b2 CLI.
Downloads and parses HTML to extract security metrics.

Usage:
    python manage.py fetch_b2_reports
"""
import boto3
import re
import tempfile
from datetime import datetime
from urllib.parse import quote
from django.core.management.base import BaseCommand
from django.conf import settings
from dashboard.models import EndpointDevice, EndpointReport, EndpointStatus
from dashboard.risk import calculate


class Command(BaseCommand):
    help = 'Fetch audit reports from Backblaze B2 and import into Django'

    def add_arguments(self, parser):
        parser.add_argument(
            '--bucket',
            type=str,
            default=getattr(settings, 'B2_BUCKET', 'Endpoint-Dashboard'),
            help='B2 bucket name'
        )

    def parse_html_report(self, html_content):
        """Extract security metrics and system info from HTML report."""
        data = {
            'ip_address': None,
            'os_version': None,
            'architecture': None,
            'cpu_count': None,
            'cpu_model': None,
            'memory_gb': None,
            'pending_updates': None,
            'firewall_enabled': None,
            'antivirus_installed': None,
            'antivirus_realtime': None,
            'secure_boot_enabled': None,
            'ssh_enabled': None,
            'tpm_present': None,
            'encryption_enabled': None,
            'screen_lock_enabled': None,
            'auditd_enabled': None,
            'passwordless_sudo': None,
            'pass_max_days': None,
            'pass_min_days': None,
            'pass_min_len': None,
            'lockout_threshold': None,
            'disk_usage_percent': None,
            'risk_score': 50,
            'risk_level': 'warning',
        }

        # Extract IP Address from HTML table
        ip_match = re.search(r'<tr><td>IP Address</td><td>([\d.]+)</td></tr>', html_content)
        if ip_match:
            data['ip_address'] = ip_match.group(1)

        # Extract OS version from System Information table
        os_match = re.search(r'<tr><td>OS</td><td>([^<]+)</td></tr>', html_content)
        if os_match:
            data['os_version'] = os_match.group(1).strip()

        # Extract Architecture
        arch_match = re.search(r'<tr><td>Architecture</td><td>([^<]+)</td></tr>', html_content)
        if arch_match:
            data['architecture'] = arch_match.group(1).strip()

        # Extract CPU count from System Information
        # CPU line can have multiple lines, so look for Core/vCPU pattern
        cpu_match = re.search(r'<tr><td>CPU</td><td>([^<]*?)(?:</td>|<br)', html_content, re.DOTALL)
        if cpu_match:
            cpu_text = cpu_match.group(1).strip()
            # Extract only the first line (before any <br> or newline)
            cpu_model_line = cpu_text.split('\n')[0].strip() if cpu_text else None
            data['cpu_model'] = cpu_model_line
            # Look for "Quad Core", "8 Core", "i3-2105 CPU", etc.
            # First try to extract core count from explicit mention
            core_match = re.search(r'(\d+)\s*(?:-)?(?:Core|core|vCPU)', cpu_text)
            if core_match:
                data['cpu_count'] = int(core_match.group(1))
            else:
                # Fallback: infer from CPU model name
                # i3 = 2 cores, i5 = 4 cores, i7 = 4-8 cores, i9 = 8+ cores, Ryzen 5 = 6 cores, etc.
                if 'i9' in cpu_text or 'Ryzen 9' in cpu_text:
                    data['cpu_count'] = 8
                elif 'i7' in cpu_text or 'Ryzen 7' in cpu_text:
                    data['cpu_count'] = 4
                elif 'i5' in cpu_text or 'Ryzen 5' in cpu_text:
                    data['cpu_count'] = 4
                elif 'i3' in cpu_text or 'Ryzen 3' in cpu_text:
                    data['cpu_count'] = 2
                elif 'Xeon' in cpu_text:
                    data['cpu_count'] = 4  # Conservative default
                elif 'Intel' in cpu_text or 'AMD' in cpu_text:
                    data['cpu_count'] = 1  # Last resort fallback

        # Extract RAM from System Information - format is "15Gi" or "15 GiB" or "15GB"
        ram_match = re.search(r'<tr><td>RAM</td><td>([0-9.]+)\s*([KMGT]i?(?:B)?)</td></tr>', html_content)
        if ram_match:
            value = float(ram_match.group(1))
            unit = ram_match.group(2).upper().rstrip('B')  # Remove trailing B if present
            
            # Convert to GB
            if unit in ('G', 'GI'):
                data['memory_gb'] = value
            elif unit in ('T', 'TI'):
                data['memory_gb'] = value * 1024
            elif unit in ('M', 'MI'):
                data['memory_gb'] = value / 1024
            elif unit in ('K', 'KI'):
                data['memory_gb'] = value / (1024 * 1024)

        # Extract Pending Updates from Security Scorecard
        updates_match = re.search(r'<tr><td>Pending (?:OS|macOS) Updates</td>.*?<td>([^<]*?(\d+)\s*update)', html_content, re.DOTALL | re.IGNORECASE)
        if updates_match:
            try:
                data['pending_updates'] = int(updates_match.group(2))
            except (ValueError, IndexError):
                pass

        # Extract Disk Usage from Disk Usage section - format is "99% /"
        disk_match = re.search(r'(\d+)%\s+/', html_content)
        if disk_match:
            data['disk_usage_percent'] = int(disk_match.group(1))

        # Look for pass/fail indicators in the HTML
        # Firewall check - look for "Firewall" in scorecard
        firewall_match = re.search(
            r'<tr><td>(?:Firewall|Application Firewall)</td>.*?<td>(Pass|Fail|Warn|Info)</td>.*?<td>([^<]+)',
            html_content,
            re.DOTALL | re.IGNORECASE,
        )
        if firewall_match:
            status = firewall_match.group(1).lower()
            if status == 'pass':
                data['firewall_enabled'] = True
            else:
                data['firewall_enabled'] = False
        else:
            # Older macOS reports put Firewall status in a plain-text
            # Security Controls block instead of the scorecard table.
            firewall_text = re.search(r'Firewall:\s*(.*?)(?:FileVault:|Secure Boot:|$)', html_content, re.IGNORECASE | re.DOTALL)
            if firewall_text:
                detail = firewall_text.group(1).lower()
                data['firewall_enabled'] = not any(word in detail for word in ('disabled', 'state = 0', 'off'))

        # Antivirus check
        av_match = re.search(r'<tr><td>Antivirus / EDR</td>.*?<td>([^<]+)</td>', html_content, re.DOTALL)
        if av_match:
            av_detail = av_match.group(1).lower()
            if 'no antivirus' in av_detail or 'not detected' in av_detail:
                data['antivirus_installed'] = False
            else:
                data['antivirus_installed'] = True
                if 'real' in av_detail or 'active' in av_detail:
                    data['antivirus_realtime'] = True

        # Secure Boot check
        sb_match = re.search(r'<tr><td>Secure Boot</td>.*?<span class="(\w+)">(\w+)</span>.*?<td>([^<]+)', html_content, re.DOTALL)
        if sb_match:
            detail = sb_match.group(3).lower()
            if 'enabled' in detail or 'yes' in detail:
                data['secure_boot_enabled'] = True
            elif 'disabled' in detail or 'no' in detail or 'n/a' in detail or 'legacy' in detail:
                data['secure_boot_enabled'] = False

        # SSH check - look in Security Scorecard
        ssh_match = re.search(r'<tr><td>SSH Root Login</td>.*?<td>([^<]+)', html_content, re.DOTALL)
        if ssh_match:
            ssh_detail = ssh_match.group(1).lower()
            # If SSH check exists, service is likely active
            if 'not explicitly set' in ssh_detail or 'no' in ssh_detail or 'yes' in ssh_detail:
                data['ssh_enabled'] = True
            else:
                data['ssh_enabled'] = False

        # TPM check
        tpm_match = re.search(r'<tr><td>TPM Present</td>.*?<span class="(\w+)">(\w+)</span>.*?<td>([^<]+)', html_content, re.DOTALL)
        if tpm_match:
            detail = tpm_match.group(3).lower()
            if 'present' in detail or 'found' in detail:
                data['tpm_present'] = True
            elif 'not detected' in detail or 'not present' in detail:
                data['tpm_present'] = False

        # ─── Encryption (LUKS) ───
        encryption_match = re.search(r'<tr><td>Disk Encryption \(LUKS\)</td>.*?<span class="(\w+)">(\w+)</span>', html_content, re.DOTALL)
        if encryption_match:
            status = encryption_match.group(2).lower()
            if status == 'pass':
                data['encryption_enabled'] = True
            else:
                data['encryption_enabled'] = False
        else:
            filevault_text = re.search(r'FileVault:\s*(.*?)(?:Secure Boot:|TPM / Secure Enclave:|$)', html_content, re.IGNORECASE | re.DOTALL)
            if filevault_text:
                detail = filevault_text.group(1).lower()
                data['encryption_enabled'] = not any(word in detail for word in ('off', 'disabled', 'not encrypted'))

        # ─── Screen Lock ───
        screen_lock_match = re.search(r'Screen Lock.*?(?:dconf|desktop|GUI|Headless)', html_content, re.IGNORECASE | re.DOTALL)
        if screen_lock_match:
            detail_text = screen_lock_match.group(0).lower()
            if 'headless' in detail_text or 'no gui' in detail_text or 'not applicable' in detail_text:
                data['screen_lock_enabled'] = None  # N/A for headless
            elif 'dconf' in detail_text or 'gnome' in detail_text:
                data['screen_lock_enabled'] = True
            else:
                data['screen_lock_enabled'] = False

        # ─── Auditd (Linux only) ───
        auditd_match = re.search(r'<tr><td>Audit Daemon \(auditd\)</td>.*?<span class="(\w+)">(\w+)</span>.*?<td>([^<]+)', html_content, re.DOTALL)
        if auditd_match:
            status = auditd_match.group(2).lower()
            detail = auditd_match.group(3).lower()
            if status == 'pass' and 'active' in detail:
                data['auditd_enabled'] = True
            else:
                data['auditd_enabled'] = False

        # ─── Passwordless Sudo (Linux only) ───
        sudo_match = re.search(r'<tr><td>Passwordless Sudo</td>.*?<span class="(\w+)">(\w+)</span>.*?<td>([^<]+)', html_content, re.DOTALL)
        if sudo_match:
            status = sudo_match.group(2).lower()
            detail = sudo_match.group(3).lower()
            if status == 'pass' or 'none found' in detail:
                data['passwordless_sudo'] = False  # Inverted: False = good (no passwordless sudo)
            else:
                data['passwordless_sudo'] = True  # True = bad (passwordless sudo present)

        # ─── Password Policy (from login.defs section) ───
        # Look for "PASS_MAX_DAYS" in the raw text
        pass_max_match = re.search(r'PASS_MAX_DAYS\s+(\d+)', html_content)
        if pass_max_match:
            data['pass_max_days'] = int(pass_max_match.group(1))

        pass_min_match = re.search(r'PASS_MIN_DAYS\s+(\d+)', html_content)
        if pass_min_match:
            data['pass_min_days'] = int(pass_min_match.group(1))

        # Look for password length requirement in pwquality section
        pass_len_match = re.search(r'minlen\s*=?\s*(\d+)', html_content, re.IGNORECASE)
        if pass_len_match:
            data['pass_min_len'] = int(pass_len_match.group(1))

        return data

    def handle(self, *args, **options):
        bucket = options['bucket']

        # Get B2 credentials from settings
        key_id = getattr(settings, 'B2_APPLICATION_KEY_ID', None)
        key = getattr(settings, 'B2_APPLICATION_KEY', None)

        if not key_id or not key:
            self.stdout.write(
                self.style.ERROR(
                    'B2_APPLICATION_KEY_ID and B2_APPLICATION_KEY not set in settings'
                )
            )
            return

        # Connect to B2 using S3 API
        self.stdout.write(f'Connecting to B2 bucket: {bucket}')
        try:
            s3_client = boto3.client(
                's3',
                endpoint_url='https://s3.us-east-005.backblazeb2.com',
                aws_access_key_id=key_id,
                aws_secret_access_key=key,
                region_name='us-east-005',
            )
        except Exception as e:
            self.stdout.write(
                self.style.ERROR(f'Failed to connect to B2: {e}')
            )
            return

        # List every stored version. B2's normal object listing only returns
        # the current version and hides the audit history visible in the B2 UI.
        self.stdout.write(f'Fetching report versions from B2...')
        try:
            paginator = s3_client.get_paginator('list_object_versions')
            contents = []
            for page in paginator.paginate(Bucket=bucket):
                contents.extend(page.get('Versions', []))
        except Exception as e:
            self.stdout.write(
                self.style.ERROR(f'Failed to list B2 report versions: {e}')
            )
            return

        # B2 keeps every overwrite as a version. Import only the newest
        # version of each report key; older versions remain available in B2
        # history but must not overwrite the dashboard with stale data.
        latest_by_key = {}
        for obj in contents:
            key = obj['Key']
            if not key.endswith('.html'):
                continue
            current = latest_by_key.get(key)
            if current is None or obj.get('IsLatest') or obj['LastModified'] > current['LastModified']:
                latest_by_key[key] = obj

        html_files = list(latest_by_key.values())
        self.stdout.write(self.style.SUCCESS(
            f'Found {len(contents)} HTML version(s); processing {len(html_files)} latest report(s)'
        ))

        imported = 0
        for obj in html_files:
            filename = obj['Key']
            size = obj['Size']
            last_modified = obj['LastModified']
            version_id = obj.get('VersionId')
            versioned_key = (
                f'{filename}?versionId={quote(version_id, safe="")}'
                if version_id and version_id != 'null'
                else filename
            )

            # Parse: Linux/SYSTEM-53/SYSTEM-53.html
            parts = filename.split('/')
            if len(parts) < 3:
                self.stdout.write(
                    self.style.WARNING(f'Skipping invalid path: {filename}')
                )
                continue

            os_type = parts[0].lower()  # Linux, Windows, macOS
            hostname = parts[1]  # SYSTEM-53
            report_name = parts[2]  # SYSTEM-53.html

            # Download HTML from B2
            self.stdout.write(f'  Downloading {report_name}...')
            try:
                get_args = {'Bucket': bucket, 'Key': filename}
                if version_id and version_id != 'null':
                    get_args['VersionId'] = version_id
                response = s3_client.get_object(**get_args)
                html_content = response['Body'].read().decode('utf-8', errors='ignore')
            except Exception as e:
                self.stdout.write(
                    self.style.WARNING(f'    Failed to download {filename}: {e}')
                )
                continue

            # Use the same canonical parser as local imports and S3 events.
            # Keeping a second inline parser here caused identical reports to
            # produce different security-control values by ingestion route.
            parsed_data = self.parse_html_report(html_content)
            try:
                from parsers import linux_parser, macos_parser, windows_parser

                parser = {
                    'linux': linux_parser,
                    'macos': macos_parser,
                    'windows': windows_parser,
                }[os_type]
                with tempfile.NamedTemporaryFile(
                    mode='w', suffix='.html', encoding='utf-8', delete=True
                ) as report_file:
                    report_file.write(html_content)
                    report_file.flush()
                    canonical_data = parser.parse(report_file.name)
                parsed_data.update(canonical_data)
            except Exception as exc:
                self.stdout.write(
                    self.style.WARNING(
                        f'    Canonical {os_type} parser failed; using legacy parser: {exc}'
                    )
                )
            parsed_data["os_type"] = os_type
            risk_score, risk_level, _ = calculate(parsed_data)
            
            # Debug output
            self.stdout.write(f'    Parsed firewall_enabled: {parsed_data.get("firewall_enabled")}')
            self.stdout.write(f'    Parsed encryption_enabled: {parsed_data.get("encryption_enabled")}')

            # Get or create EndpointStatus
            endpoint_status = EndpointStatus.objects.filter(hostname=hostname).first()

            try:
                # Build CPU string for display
                cpu_str = None
                if parsed_data.get('cpu_count'):
                    cpu_str = f"{parsed_data['cpu_count']} cores"
                else:
                    cpu_str = "Unknown"  # Default value instead of None
                
                report, created = EndpointReport.objects.update_or_create(
                    s3_object_key=versioned_key,
                    defaults={
                        'endpoint_device': EndpointDevice.objects.filter(
                            mac_address=endpoint_status.mac_address
                        ).first() if endpoint_status and endpoint_status.mac_address else None,
                        'hostname': hostname,
                        'os_type': os_type,
                        'mac_address': endpoint_status.mac_address if endpoint_status else None,
                        'report_date': last_modified,
                        'ip_address': parsed_data.get('ip_address') or (
                            endpoint_status.ip_address if endpoint_status else ''
                        ),
                        'os_name': parsed_data.get('os_version'),  # Full OS name
                        'os_version': parsed_data.get('os_version'),  # Store again for compatibility
                        'architecture': parsed_data.get('architecture'),
                        'cpu': cpu_str,
                        'cpu_model': parsed_data.get('cpu_model'),
                        'ram': f"{parsed_data.get('memory_gb')} GB" if parsed_data.get('memory_gb') else None,
                        'pending_updates': parsed_data.get('pending_updates'),
                        'firewall_enabled': parsed_data.get('firewall_enabled'),
                        'encryption_enabled': parsed_data.get('encryption_enabled'),
                        'antivirus_installed': parsed_data.get('antivirus_installed'),
                        'antivirus_realtime': parsed_data.get('antivirus_realtime'),
                        'secure_boot_enabled': parsed_data.get('secure_boot_enabled'),
                        'ssh_enabled': parsed_data.get('ssh_enabled'),
                        'tpm_present': parsed_data.get('tpm_present'),
                        'screen_lock_enabled': parsed_data.get('screen_lock_enabled'),
                        'auditd_enabled': parsed_data.get('auditd_enabled'),
                        'passwordless_sudo': parsed_data.get('passwordless_sudo'),
                        'pass_max_days': parsed_data.get('pass_max_days'),
                        'pass_min_days': parsed_data.get('pass_min_days'),
                        'pass_min_len': parsed_data.get('pass_min_len'),
                        'lockout_threshold': parsed_data.get('lockout_threshold'),
                        'risk_score': risk_score,
                        'risk_level': risk_level,
                        'raw_data': {
                            'b2_size': size,
                            'b2_filename': filename,
                            'b2_version_id': version_id,
                            'b2_url': f'https://f005.backblazeb2.com/file/{bucket}/{filename}',
                            'cpu_count': parsed_data.get('cpu_count'),
                            'disk_usage_percent': parsed_data.get('disk_usage_percent'),
                            'memory_gb': parsed_data.get('memory_gb'),
                        },
                    }
                )
                if created:
                    self.stdout.write(
                        self.style.SUCCESS(f'  ✓ Imported: {hostname} — {report_name}')
                    )
                    imported += 1
                else:
                    self.stdout.write(
                        self.style.WARNING(f'  ⊘ Updated: {hostname} — {report_name}')
                    )
                
                # Sync security controls from report to EndpointStatus
                if endpoint_status:
                    endpoint_status.firewall_active = parsed_data.get('firewall_enabled')
                    endpoint_status.antivirus_active = parsed_data.get('antivirus_installed')
                    endpoint_status.save(update_fields=['firewall_active', 'antivirus_active'])
                    self.stdout.write(f'    Synced to EndpointStatus: firewall_active={endpoint_status.firewall_active}')
            except Exception as e:
                self.stdout.write(
                    self.style.ERROR(f'  ✗ Failed to import {filename}: {e}')
                )

        self.stdout.write(
            self.style.SUCCESS(f'\n✓ Import complete: {imported} new report(s) imported')
        )
