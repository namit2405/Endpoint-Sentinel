"""
Django management command: import HTML audit reports into PostgreSQL.

Supports dual storage backends:
- Development: REPORT_STORAGE=samba  → reads from local/Samba filesystem
- Production: REPORT_STORAGE=s3      → reads from S3 via boto3

Usage:
    python manage.py import_reports                    # scan all reports
    python manage.py import_reports --os linux         # only Linux
    python manage.py import_reports --path /some/dir   # custom path (Samba only)
    python manage.py import_reports --force            # re-import existing records
    python manage.py import_reports --sync             # sync with storage (delete stale records)

Directory structure (Samba/local):
    Reports/
        Windows/   *.html
        Linux/     *.html
        macOS/     *.html

S3 structure:
    reports/
        Linux/<hostname>/<uuid>-<filename>.html
        Windows/<hostname>/<uuid>-<filename>.html
        macOS/<hostname>/<uuid>-<filename>.html
"""
import logging
import sys
from pathlib import Path
from tempfile import NamedTemporaryFile

import boto3
from botocore.exceptions import ClientError
from django.conf import settings
from django.core.management.base import BaseCommand

from dashboard.models import EndpointReport
from dashboard.risk import calculate
from dashboard.services.report_storage import download_s3_report_to_temp

logger = logging.getLogger(__name__)

# Fields returned by parsers that map directly to model columns.
# Any key NOT in this set is either handled specially or discarded.
_MODEL_FIELDS = {f.name for f in EndpointReport._meta.get_fields()}

# Keys that parsers may return but are NOT model fields (handled separately or dropped).
_SPECIAL_KEYS = {"report_date", "hostname", "bios_version"}


def _extract_model_kwargs(data: dict) -> dict:
    """
    Return a dict containing only keys that exist as model fields,
    plus a few that need special treatment (antivirus_updated_at, last_patch_date).
    bios_version is written directly onto the object after get_or_create.
    """
    kwargs = {}
    for key, value in data.items():
        if key in _MODEL_FIELDS and key not in ("id", "imported_at", "hostname", "report_date"):
            kwargs[key] = value
    return kwargs


class Command(BaseCommand):
    help = "Parse HTML audit reports and store them in the database"

    def add_arguments(self, parser):
        parser.add_argument(
            "--path",
            type=str,
            default=None,
            help="Base directory for reports (defaults to REPORTS_BASE_DIR in settings, Samba only)",
        )
        parser.add_argument(
            "--os",
            type=str,
            choices=["windows", "linux", "macos", "all"],
            default="all",
            help="Which OS reports to import (default: all)",
        )
        parser.add_argument(
            "--force",
            action="store_true",
            help="Re-import reports that already exist in the database",
        )
        parser.add_argument(
            "--sync",
            action="store_true",
            help="Delete DB records whose source files no longer exist, then re-import everything",
        )

    def handle(self, *args, **options):
        os_filter = options["os"]
        force = options["force"]
        sync  = options["sync"]

        # Import parsers
        try:
            from parsers import linux_parser, macos_parser, windows_parser
        except ImportError as e:
            self.stderr.write(self.style.ERROR(
                f"Could not import parsers: {e}\n"
                "Make sure the project root is on PYTHONPATH."
            ))
            sys.exit(1)

        os_map = {
            "linux":   ("Linux",   linux_parser),
            "macos":   ("macOS",   macos_parser),
            "windows": ("Windows", windows_parser),
        }

        # ── Determine storage backend ──────────────────────────────────────
        storage_backend = settings.REPORT_STORAGE
        self.stdout.write(self.style.SUCCESS(f"Storage backend: {storage_backend.upper()}"))

        if storage_backend == "s3":
            self._handle_s3_import(os_filter, force, sync, os_map)
        else:
            self._handle_samba_import(options, os_filter, force, sync, os_map)

    def _handle_samba_import(self, options, os_filter, force, sync, os_map):
        """Handle import from local/Samba filesystem."""
        base = Path(options["path"]) if options["path"] else settings.REPORTS_BASE_DIR
        
        # Build folder mapping
        folder_map = {
            os_type: (base / folder_name, parser)
            for os_type, (folder_name, parser) in os_map.items()
        }

        # ── Sync: delete DB records whose files no longer exist ───────────
        if sync:
            on_disk = set()
            for _, (folder, _) in folder_map.items():
                if folder.exists():
                    on_disk.update(str(p) for p in folder.glob("*.html"))

            stale = EndpointReport.objects.exclude(report_file__in=on_disk)
            stale_count = stale.count()
            if stale_count:
                stale.delete()
                self.stdout.write(
                    self.style.WARNING(f"SYNC: deleted {stale_count} stale record(s) from DB")
                )
            else:
                self.stdout.write("SYNC: no stale records found")

            force = True

        total_ok = total_skip = total_err = 0

        for os_type, (folder, parser) in folder_map.items():
            if os_filter not in ("all", os_type):
                continue
            if not folder.exists():
                self.stdout.write(f"  Skipping {folder} (not found)")
                continue

            html_files = sorted(f for f in folder.glob("*.html")
                                if not f.name.startswith("."))
            self.stdout.write(f"\n{os_type.upper()}: {len(html_files)} file(s) in {folder}")

            for filepath in html_files:
                try:
                    data = parser.parse(filepath)
                except Exception as exc:
                    self.stderr.write(
                        self.style.WARNING(f"  PARSE ERROR  {filepath.name}: {exc}")
                    )
                    total_err += 1
                    continue

                # ── Risk scoring ──────────────────────────────────────────
                score, level, _ = calculate(data)
                data["risk_score"] = score
                data["risk_level"] = level

                # ── Pull out the fields we need ────────────────────────────
                hostname    = data.get("hostname", filepath.stem)
                report_date = data.get("report_date")
                bios        = data.get("bios_version", "") or data.get("raw_data", {}).get("bios", "")

                defaults = _extract_model_kwargs(data)
                defaults["report_file"] = str(filepath)  # Store local path
                if bios:
                    defaults["bios_version"] = bios

                # ── Upsert ────────────────────────────────────────────────
                try:
                    obj, created = EndpointReport.objects.get_or_create(
                        hostname=hostname,
                        report_date=report_date,
                        defaults=defaults,
                    )
                    if not created and force:
                        for k, v in defaults.items():
                            setattr(obj, k, v)
                        obj.save()
                        self.stdout.write(f"  UPDATED  {filepath.name}")
                        total_ok += 1
                    elif created:
                        self.stdout.write(
                            self.style.SUCCESS(
                                f"  IMPORTED {filepath.name}  [{level.upper()} {score}]"
                            )
                        )
                        total_ok += 1
                    else:
                        self.stdout.write(f"  SKIPPED  {filepath.name} (already imported)")
                        total_skip += 1

                except Exception as exc:
                    self.stderr.write(
                        self.style.ERROR(f"  DB ERROR  {filepath.name}: {exc}")
                    )
                    total_err += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"\nDone.  Imported: {total_ok}  Skipped: {total_skip}  Errors: {total_err}"
            )
        )

    def _handle_s3_import(self, os_filter, force, sync, os_map):
        """Handle import from S3."""
        try:
            s3_client = boto3.client("s3", region_name=settings.AWS_REGION)
        except Exception as e:
            self.stderr.write(self.style.ERROR(f"Failed to create S3 client: {e}"))
            sys.exit(1)

        # Map os_type to parser
        parser_map = {os_type: parser for os_type, (_, parser) in os_map.items()}

        # ── Sync: delete DB records whose S3 keys no longer exist ────────
        if sync:
            # Collect all S3 keys currently in storage
            existing_s3_keys = set()
            try:
                paginator = s3_client.get_paginator("list_objects_v2")
                for page in paginator.paginate(
                    Bucket=settings.AWS_REPORTS_BUCKET,
                    Prefix=settings.AWS_REPORTS_PREFIX,
                ):
                    if "Contents" in page:
                        for obj in page["Contents"]:
                            if obj["Key"].endswith(".html"):
                                existing_s3_keys.add(obj["Key"])
            except ClientError as e:
                self.stderr.write(self.style.ERROR(f"Failed to list S3 objects: {e}"))
                sys.exit(1)

            # Find DB records with s3_object_key not in S3
            stale = EndpointReport.objects.exclude(s3_object_key__in=existing_s3_keys).exclude(s3_object_key="")
            stale_count = stale.count()
            if stale_count:
                stale.delete()
                self.stdout.write(
                    self.style.WARNING(f"SYNC: deleted {stale_count} stale record(s) from DB")
                )
            else:
                self.stdout.write("SYNC: no stale records found")

            force = True

        total_ok = total_skip = total_err = 0

        # List all objects in S3 under the prefix
        try:
            paginator = s3_client.get_paginator("list_objects_v2")
            pages = paginator.paginate(
                Bucket=settings.AWS_REPORTS_BUCKET,
                Prefix=settings.AWS_REPORTS_PREFIX,
            )
        except ClientError as e:
            self.stderr.write(self.style.ERROR(f"Failed to paginate S3 objects: {e}"))
            sys.exit(1)

        for page in pages:
            if "Contents" not in page:
                continue

            for obj in page["Contents"]:
                s3_key = obj["Key"]

                # Only process HTML files
                if not s3_key.endswith(".html"):
                    continue

                # Parse S3 key: reports/{os_type}/{hostname}/{uuid}-{filename}.html
                parts = s3_key.split("/")
                if len(parts) < 4:
                    self.stderr.write(
                        self.style.WARNING(f"  SKIP  {s3_key} (unexpected key format)")
                    )
                    continue

                os_type_str = parts[1].lower()  # "linux", "windows", "macos"
                hostname = parts[2]

                if os_filter not in ("all", os_type_str):
                    continue

                if os_type_str not in parser_map:
                    self.stderr.write(
                        self.style.WARNING(f"  SKIP  {s3_key} (unknown OS type: {os_type_str})")
                    )
                    continue

                parser = parser_map[os_type_str]

                # Download S3 object to temporary file
                temp_file = None
                try:
                    temp_file = download_s3_report_to_temp(s3_key)
                    if temp_file is None:
                        self.stderr.write(
                            self.style.WARNING(f"  PARSE ERROR  {s3_key}: failed to download")
                        )
                        total_err += 1
                        continue

                    # Parse the temporary HTML file
                    data = parser.parse(temp_file.name)
                except Exception as exc:
                    self.stderr.write(
                        self.style.WARNING(f"  PARSE ERROR  {s3_key}: {exc}")
                    )
                    total_err += 1
                    continue
                finally:
                    if temp_file:
                        temp_file.close()
                        # Delete temporary file
                        try:
                            Path(temp_file.name).unlink()
                        except Exception:
                            pass

                # ── Risk scoring ──────────────────────────────────────────
                score, level, _ = calculate(data)
                data["risk_score"] = score
                data["risk_level"] = level

                # ── Pull out the fields we need ────────────────────────────
                report_hostname = data.get("hostname", hostname)
                report_date = data.get("report_date")
                bios = data.get("bios_version", "") or data.get("raw_data", {}).get("bios", "")

                defaults = _extract_model_kwargs(data)
                defaults["s3_object_key"] = s3_key  # Store S3 key instead of local path
                if bios:
                    defaults["bios_version"] = bios

                # ── Upsert ────────────────────────────────────────────────
                try:
                    obj, created = EndpointReport.objects.get_or_create(
                        hostname=report_hostname,
                        report_date=report_date,
                        defaults=defaults,
                    )
                    if not created and force:
                        for k, v in defaults.items():
                            setattr(obj, k, v)
                        obj.save()
                        self.stdout.write(f"  UPDATED  {s3_key}")
                        total_ok += 1
                    elif created:
                        self.stdout.write(
                            self.style.SUCCESS(
                                f"  IMPORTED {s3_key}  [{level.upper()} {score}]"
                            )
                        )
                        total_ok += 1
                    else:
                        self.stdout.write(f"  SKIPPED  {s3_key} (already imported)")
                        total_skip += 1

                except Exception as exc:
                    self.stderr.write(
                        self.style.ERROR(f"  DB ERROR  {s3_key}: {exc}")
                    )
                    total_err += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"\nDone.  Imported: {total_ok}  Skipped: {total_skip}  Errors: {total_err}"
            )
        )
