"""Health scoring for live endpoint telemetry."""


def calculate_health_score(
    cpu_percent=None,
    memory_percent=None,
    disk_percent=None,
    firewall_active=None,
    antivirus_active=None,
):
    """Return (score, status) for the latest endpoint health measurements."""
    deductions = 0

    for value in (cpu_percent, memory_percent):
        if value is not None:
            if value >= 95:
                deductions += 30
            elif value >= 85:
                deductions += 20
            elif value >= 75:
                deductions += 10

    if disk_percent is not None:
        if disk_percent >= 95:
            deductions += 25
        elif disk_percent >= 85:
            deductions += 15
        elif disk_percent >= 75:
            deductions += 5

    if firewall_active is False:
        deductions += 15
    if antivirus_active is False:
        deductions += 15

    score = max(0, 100 - deductions)
    status = "healthy" if score >= 75 else "warning" if score >= 50 else "critical"
    return score, status