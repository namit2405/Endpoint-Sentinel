"""
Risk scoring engine.

Each machine starts at 100.  Points are deducted for each security gap.
The final score maps to a risk level:
  75-100  → healthy   🟢
  50-74   → warning   🟡
  0-49    → critical  🔴

Deduction weights are calibrated for a mixed enterprise/SMB environment:
 - Active threats (no AV, no firewall) are weighted highest
 - Hardening gaps (encryption, secure boot) are moderate — important but not emergency
 - Configuration gaps (screen lock, USB) are low — worth fixing but not critical
"""

DEDUCTIONS = {
    "firewall_off":          10,   # was 15 — common on Linux desktops
    "antivirus_missing":     20,   # was 25 — still high, AV is fundamental
    "encryption_off":        10,   # was 20 — important but very common gap
    "secure_boot_off":        5,   # was 10 — hardware limitation often
    "tpm_missing":            3,   # was 5  — informational mostly
    "ssh_enabled":            3,   # was 5  — SSH is often legitimate
    "auditd_missing":         5,   # unchanged — Linux logging important
    "passwordless_sudo":     15,   # unchanged — high risk
    "sip_disabled":           8,   # was 10
    "gatekeeper_disabled":    8,   # was 10
    "anydesk_running":        5,   # unchanged
    "teamviewer_running":     5,   # unchanged
    "chrome_remote_desktop":  5,   # unchanged
    "rdp_open":               5,   # unchanged
    "usb_storage_enabled":    3,   # was 5  — very common, low severity
    "screen_lock_missing":    3,   # was 5  — low severity
    "updates_6_20":           5,   # unchanged
    "updates_20_plus":       10,   # was 15 — still significant
    "pass_never_expires":     5,   # unchanged
    "no_lockout":             5,   # unchanged
    "tamper_protection_off":  3,   # was 5
}


def calculate(data: dict) -> tuple[int, str, list]:
    """
    Given a parsed report dict (same keys as EndpointReport fields),
    return (score, level, reasons) where level is 'healthy', 'warning', or 'critical'.
    """
    score = 100
    reasons = []

    def deduct(key: str):
        nonlocal score
        score -= DEDUCTIONS[key]
        reasons.append(key)

    # Firewall
    if data.get("firewall_enabled") is False:
        deduct("firewall_off")

    # Antivirus
    if data.get("antivirus_installed") is False:
        deduct("antivirus_missing")

    # Tamper protection (Windows Defender)
    if data.get("antivirus_tamper") is False:
        deduct("tamper_protection_off")

    # Encryption
    if data.get("encryption_enabled") is False:
        deduct("encryption_off")

    # Secure Boot
    if data.get("secure_boot_enabled") is False:
        deduct("secure_boot_off")

    # TPM
    if data.get("tpm_present") is False:
        deduct("tpm_missing")

    # SSH (Linux — only penalise if enabled)
    if data.get("ssh_enabled") is True and data.get("os_type") == "linux":
        deduct("ssh_enabled")

    # Auditd (Linux)
    if data.get("auditd_enabled") is False and data.get("os_type") == "linux":
        deduct("auditd_missing")

    # Passwordless sudo (Linux / macOS)
    if data.get("passwordless_sudo") is True:
        deduct("passwordless_sudo")

    # macOS SIP
    if data.get("sip_enabled") is False:
        deduct("sip_disabled")

    # macOS Gatekeeper
    if data.get("gatekeeper_enabled") is False:
        deduct("gatekeeper_disabled")

    # Remote access tools
    if data.get("anydesk_running"):
        deduct("anydesk_running")
    if data.get("teamviewer_running"):
        deduct("teamviewer_running")
    if data.get("chrome_remote_desktop"):
        deduct("chrome_remote_desktop")
    if data.get("rdp_open"):
        deduct("rdp_open")

    # USB storage (Windows)
    if data.get("usb_storage_enabled") is True and data.get("os_type") == "windows":
        deduct("usb_storage_enabled")

    # Screen lock not configured
    if data.get("screen_lock_enabled") is False:
        deduct("screen_lock_missing")

    # Pending updates
    n = data.get("pending_updates")
    if n is not None:
        if n > 20:
            deduct("updates_20_plus")
        elif n > 5:
            deduct("updates_6_20")

    # Password never expires (Linux/Windows)
    pmd = data.get("pass_max_days")
    if pmd is not None and (pmd == 0 or pmd >= 99999):
        deduct("pass_never_expires")

    # No account lockout (Windows)
    lt = data.get("lockout_threshold")
    if lt is not None and lt == 0 and data.get("os_type") == "windows":
        deduct("no_lockout")

    score = max(0, score)

    if score >= 75:
        level = "healthy"
    elif score >= 50:
        level = "warning"
    else:
        level = "critical"

    return score, level, reasons
