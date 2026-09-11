"""
Management command to create sample licensing data for testing.

Usage: python manage.py create_sample_licenses
"""
from django.core.management.base import BaseCommand
from django.contrib.auth.models import User
from django.utils import timezone
from datetime import timedelta
from dashboard.models import Company, IndividualAccount, License


class Command(BaseCommand):
    help = "Create sample companies, users, and licenses for testing"

    def handle(self, *args, **options):
        self.stdout.write(self.style.WARNING("Creating sample data..."))

        # Create sample user for admin
        admin_user, created = User.objects.get_or_create(
            username='admin',
            defaults={
                'email': 'admin@example.com',
                'first_name': 'Admin',
                'last_name': 'User',
                'is_staff': True,
                'is_superuser': True,
            }
        )
        if created:
            admin_user.set_password('admin123')
            admin_user.save()
            self.stdout.write(self.style.SUCCESS(f"✓ Created superuser: {admin_user.username}"))
        else:
            self.stdout.write(f"Admin user already exists: {admin_user.username}")

        # Create sample company
        company, created = Company.objects.get_or_create(
            name="TechCorp Inc.",
            defaults={
                'email': 'contact@techcorp.example.com',
                'phone': '+1-555-0100',
                'website': 'https://techcorp.example.com',
                'city': 'San Francisco',
                'state': 'CA',
                'country': 'USA',
                'status': 'active',
                'admin_user': admin_user,
                'max_employees': 50,
            }
        )
        if created:
            self.stdout.write(self.style.SUCCESS(f"✓ Created company: {company.name}"))
        else:
            self.stdout.write(f"Company already exists: {company.name}")

        # Create sample individual account
        individual_user, _ = User.objects.get_or_create(
            username='john_doe',
            defaults={
                'email': 'john@example.com',
                'first_name': 'John',
                'last_name': 'Doe',
            }
        )
        individual_account, created = IndividualAccount.objects.get_or_create(
            user=individual_user,
            defaults={
                'phone': '+1-555-0101',
                'organization_name': 'Doe Consulting',
                'status': 'active',
            }
        )
        if created:
            self.stdout.write(self.style.SUCCESS(f"✓ Created individual account: {individual_user.username}"))
        else:
            self.stdout.write(f"Individual account already exists: {individual_user.username}")

        # Create sample licenses
        license1_key = License.generate_license_key()
        license1, created = License.objects.get_or_create(
            license_key=license1_key,
            defaults={
                'company': company,
                'license_type': 'commercial',
                'device_limit': 100,
                'status': 'active',
                'expires_at': timezone.now() + timedelta(days=365),
                'valid_from': timezone.now(),
                'description': 'Commercial license for TechCorp - 100 device limit',
                'issued_by': admin_user,
            }
        )
        if created:
            self.stdout.write(self.style.SUCCESS(f"✓ Created company license: {license1.license_key}"))
        else:
            self.stdout.write(f"License already exists: {license1.license_key}")

        license2_key = License.generate_license_key()
        license2, created = License.objects.get_or_create(
            license_key=license2_key,
            defaults={
                'individual': individual_account,
                'license_type': 'commercial',
                'device_limit': 10,
                'status': 'active',
                'expires_at': timezone.now() + timedelta(days=365),
                'valid_from': timezone.now(),
                'description': 'Commercial license for John Doe - 10 device limit',
                'issued_by': admin_user,
            }
        )
        if created:
            self.stdout.write(self.style.SUCCESS(f"✓ Created individual license: {license2.license_key}"))
        else:
            self.stdout.write(f"License already exists: {license2.license_key}")

        self.stdout.write(self.style.SUCCESS("\n✓ Sample data created successfully!"))
        self.stdout.write(f"\nCredentials for testing:")
        self.stdout.write(f"  Admin: admin / admin123")
        self.stdout.write(f"\nLicense keys for testing:")
        self.stdout.write(f"  Company: {license1.license_key}")
        self.stdout.write(f"  Individual: {license2.license_key}")
