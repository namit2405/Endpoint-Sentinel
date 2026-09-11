from django.db import migrations


def backfill_endpoint_devices(apps, schema_editor):
    EndpointDevice = apps.get_model("dashboard", "EndpointDevice")
    EndpointStatus = apps.get_model("dashboard", "EndpointStatus")
    EndpointReport = apps.get_model("dashboard", "EndpointReport")
    EndpointMetricsHistory = apps.get_model("dashboard", "EndpointMetricsHistory")
    EndpointCommand = apps.get_model("dashboard", "EndpointCommand")
    PowerActionLog = apps.get_model("dashboard", "PowerActionLog")
    LicenseDeviceRecord = apps.get_model("dashboard", "LicenseDeviceRecord")
    LicenseUsageLog = apps.get_model("dashboard", "LicenseUsageLog")
    License = apps.get_model("dashboard", "License")

    devices_by_mac = {}
    devices_by_hostname = {}

    def device_for_identity(mac_address, hostname, ip_address=None, os_name=None):
        mac_address = (mac_address or "").strip()
        hostname = (hostname or "").strip()
        device = None

        if mac_address:
            device = devices_by_mac.get(mac_address)
            if device is None:
                device = EndpointDevice.objects.filter(mac_address=mac_address).first()

        if device is None and hostname:
            device = devices_by_hostname.get(hostname)
            if device is None:
                device = EndpointDevice.objects.filter(hostname=hostname).first()

        if device is None and not mac_address:
            return None

        if device is None:
            device = EndpointDevice.objects.create(
                mac_address=mac_address,
                hostname=hostname or mac_address,
                ip_address=ip_address,
                os=os_name,
            )
        else:
            changed = []
            if hostname and device.hostname == device.mac_address:
                device.hostname = hostname
                changed.append("hostname")
            if ip_address and not device.ip_address:
                device.ip_address = ip_address
                changed.append("ip_address")
            if os_name and not device.os:
                device.os = os_name
                changed.append("os")
            if changed:
                device.save(update_fields=changed + ["updated_at"])

        if mac_address:
            devices_by_mac[mac_address] = device
        if hostname:
            devices_by_hostname[hostname] = device
        return device

    for status in EndpointStatus.objects.all().iterator():
        device = device_for_identity(
            status.mac_address,
            status.hostname,
            status.ip_address,
            status.os,
        )
        if device is not None and status.endpoint_device_id is None:
            status.endpoint_device_id = device.pk
            status.save(update_fields=["endpoint_device"])

    for report in EndpointReport.objects.all().iterator():
        device = device_for_identity(
            report.mac_address,
            report.hostname,
            None,
            report.os_type,
        )
        if device is not None and report.endpoint_device_id is None:
            report.endpoint_device_id = device.pk
            report.save(update_fields=["endpoint_device"])

    for history in EndpointMetricsHistory.objects.all().iterator():
        if history.endpoint_device_id is None:
            device_id = EndpointStatus.objects.filter(
                pk=history.endpoint_id
            ).values_list("endpoint_device_id", flat=True).first()
            if device_id:
                history.endpoint_device_id = device_id
                history.save(update_fields=["endpoint_device"])

    for command in EndpointCommand.objects.all().iterator():
        if command.endpoint_device_id is None:
            device_id = EndpointStatus.objects.filter(
                pk=command.endpoint_id
            ).values_list("endpoint_device_id", flat=True).first()
            if device_id:
                command.endpoint_device_id = device_id
                command.save(update_fields=["endpoint_device"])

    for power_log in PowerActionLog.objects.all().iterator():
        if power_log.endpoint_device_id is None:
            device_id = EndpointStatus.objects.filter(
                pk=power_log.endpoint_id
            ).values_list("endpoint_device_id", flat=True).first()
            if device_id:
                power_log.endpoint_device_id = device_id
                power_log.save(update_fields=["endpoint_device"])

    for record in LicenseDeviceRecord.objects.all().iterator():
        if record.endpoint_device_id is None:
            device_id = None
            if record.endpoint_id:
                device_id = EndpointStatus.objects.filter(
                    pk=record.endpoint_id
                ).values_list("endpoint_device_id", flat=True).first()
            if device_id is None:
                device_id = devices_by_mac.get(record.mac_address)
                device_id = device_id.pk if device_id else None
            if device_id:
                record.endpoint_device_id = device_id
                record.save(update_fields=["endpoint_device"])

        if record.endpoint_device_id:
            company_id = License.objects.filter(
                pk=record.license_id,
                company_id__isnull=False,
            ).values_list("company_id", flat=True).first()
            if company_id:
                EndpointDevice.objects.filter(
                    pk=record.endpoint_device_id,
                    company_id__isnull=True,
                ).update(company_id=company_id)

    for usage_log in LicenseUsageLog.objects.filter(endpoint_device__isnull=True):
        device = devices_by_mac.get(usage_log.mac_address)
        if device is not None:
            usage_log.endpoint_device_id = device.pk
            usage_log.save(update_fields=["endpoint_device"])


def reverse_backfill_endpoint_devices(apps, schema_editor):
    EndpointDevice = apps.get_model("dashboard", "EndpointDevice")
    EndpointStatus = apps.get_model("dashboard", "EndpointStatus")
    EndpointReport = apps.get_model("dashboard", "EndpointReport")
    EndpointMetricsHistory = apps.get_model("dashboard", "EndpointMetricsHistory")
    EndpointCommand = apps.get_model("dashboard", "EndpointCommand")
    PowerActionLog = apps.get_model("dashboard", "PowerActionLog")
    LicenseDeviceRecord = apps.get_model("dashboard", "LicenseDeviceRecord")
    LicenseUsageLog = apps.get_model("dashboard", "LicenseUsageLog")

    for model in (
        EndpointStatus,
        EndpointReport,
        EndpointMetricsHistory,
        EndpointCommand,
        PowerActionLog,
        LicenseDeviceRecord,
        LicenseUsageLog,
    ):
        model.objects.update(endpoint_device=None)
    EndpointDevice.objects.all().delete()


class Migration(migrations.Migration):
    dependencies = [("dashboard", "0016_alter_endpointdevice_id")]

    operations = [
        migrations.RunPython(
            backfill_endpoint_devices,
            reverse_code=reverse_backfill_endpoint_devices,
        ),
    ]
