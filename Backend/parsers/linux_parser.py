"""
Linux HTML audit report parser.
Returns a dict with keys matching EndpointReport model fields.
"""
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from bs4 import BeautifulSoup

from .base import clean, extract_int, safe_dt


# ── helpers ──────────────────────────────────────────────────────────────────

def _label_value(soup: BeautifulSoup, label: str) -> Optional[str]:
    for row in soup.find_all("tr"):
        cells = [clean(td.get_text()) for td in row.find_all(["td", "th"])]
        if len(cells) >= 2 and label.lower() == cells[0].lower():
            return cells[1]
    return None


def _section_text(soup: BeautifulSoup, section_heading: str) -> str:
    heading = soup.find(
        lambda tag: tag.name in ("h2", "h3", "h4")
        and section_heading.lower() in tag.get_text(strip=True).lower(),
    )
    if not heading:
        return ""
    parts = []
    for sib in heading.find_next_siblings():
        if sib.name in ("h2", "h3", "h4"):
            break
        parts.append(clean(sib.get_text()))
    return " ".join(parts)


def _scorecard(soup: BeautifulSoup, check_label: str) -> tuple[str, str]:
    """
    Return (result, detail) from the Security Scorecard for *check_label*.
    result is 'pass', 'fail', 'warn', 'info', or ''.
    detail is the raw detail string.
    Both are lowercased for easy comparison.
    """
    sc_heading = soup.find(
        lambda t: t.name in ("h1", "h2", "h3", "h4")
        and "security scorecard" in t.get_text(strip=True).lower(),
    )
    if not sc_heading:
        return "", ""
    sc_tbl = sc_heading.find_next("table")
    if not sc_tbl:
        return "", ""
    for row in sc_tbl.find_all("tr"):
        cells = [clean(td.get_text()) for td in row.find_all(["td", "th"])]
        if len(cells) >= 3 and check_label.lower() in cells[0].lower():
            return cells[1].lower().strip(), cells[2].lower().strip()
    return "", ""


def _table_rows(table) -> list[list[str]]:
    rows = []
    for tr in table.find_all("tr"):
        cols = [clean(td.get_text()) for td in tr.find_all(["td", "th"])]
        if any(c for c in cols):
            rows.append(cols)
    return rows


# ── main parser ──────────────────────────────────────────────────────────────

def parse(filepath: str | Path) -> dict:
    filepath = Path(filepath)
    html = filepath.read_text(errors="replace")
    soup = BeautifulSoup(html, "lxml")

    page_text = soup.get_text()
    if "linux" not in page_text.lower() and "ubuntu" not in page_text.lower():
        raise ValueError(f"{filepath.name} does not appear to be a Linux report")

    # ── Report date ───────────────────────────────────────────────────────
    report_date = None
    gen_match = re.search(
        r"Generated[:\s]+\w+\s+(\d{1,2}\s+\w+\s+\d{4}\s+[\d:]+\s*(?:AM|PM)?\s*\w*)",
        page_text, re.IGNORECASE,
    )
    if gen_match:
        raw_dt = gen_match.group(1).strip()
        for fmt in ("%d %B %Y %I:%M:%S %p %Z", "%d %B %Y %I:%M:%S %p",
                    "%d %B %Y %H:%M:%S %Z", "%d %B %Y %H:%M:%S"):
            dt = safe_dt(raw_dt, fmt)
            if dt:
                report_date = dt
                break
    if not report_date:
        gen_match2 = re.search(
            r"Generated[:\s]+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s*(?:AM|PM)?\s*\w+\s+\d{4})",
            page_text, re.IGNORECASE,
        )
        if gen_match2:
            raw_dt = gen_match2.group(1).strip()
            for fmt in ("%a %b %d %I:%M:%S %p %Z %Y", "%a %b %d %H:%M:%S %Z %Y"):
                dt = safe_dt(raw_dt, fmt)
                if dt:
                    report_date = dt
                    break
    if not report_date:
        report_date = datetime.fromtimestamp(filepath.stat().st_mtime, tz=timezone.utc)

    # ── System Information ────────────────────────────────────────────────
    hostname   = _label_value(soup, "Hostname") or filepath.stem.split("-")[0]
    os_name    = _label_value(soup, "OS") or ""
    kernel     = _label_value(soup, "Kernel") or ""
    arch       = _label_value(soup, "Architecture") or ""
    cpu        = _label_value(soup, "CPU") or ""
    ram        = _label_value(soup, "RAM") or ""
    ip_address = _label_value(soup, "IP Address") or ""

    # ── Disk Encryption (LUKS) ────────────────────────────────────────────
    result, detail = _scorecard(soup, "Disk Encryption")
    if result:
        encryption_enabled = result == "pass"
    else:
        enc_text = _section_text(soup, "Disk Encryption") or _section_text(soup, "Security Controls")
        enc_lower = enc_text.lower()
        if "no encrypted" in enc_lower or "not detected" in enc_lower:
            encryption_enabled = False
        elif "luks" in enc_lower and ("found" in enc_lower or "volume" in enc_lower):
            encryption_enabled = True
        else:
            encryption_enabled = None

    # ── Antivirus / EDR ───────────────────────────────────────────────────
    result, detail = _scorecard(soup, "Antivirus")
    if result:
        if "no antivirus" in detail or "not detected" in detail:
            antivirus_installed = False
        elif result == "pass":
            antivirus_installed = True
        else:
            antivirus_installed = False
    else:
        # Older format: plain text under Security Controls
        av_text = _section_text(soup, "Antivirus")
        if not av_text:
            # Extract antivirus paragraph from Security Controls block
            sc_block = _section_text(soup, "Security Controls")
            m = re.search(r"Antivirus[:\s]*(.*?)(?:Pending|Firewall|$)", sc_block, re.IGNORECASE | re.DOTALL)
            av_text = m.group(1)[:120] if m else ""
        if av_text:
            antivirus_installed = (
                "no antivirus" not in av_text.lower()
                and "not detected" not in av_text.lower()
                and "not installed" not in av_text.lower()
            )
        else:
            antivirus_installed = None

    # ── Firewall ─────────────────────────────────────────────────────────
    # Scorecard: Result=Fail, Detail="Tool: ufw"  → firewall inactive
    # Scorecard: Result=Pass, Detail="Status: active" → firewall active
    result, detail = _scorecard(soup, "Firewall")
    if result:
        if result == "pass":
            firewall_enabled = True
        elif result in ("fail", "warn"):
            # Detail may say "Tool: ufw" (inactive) or "Status: active"
            if "active" in detail:
                firewall_enabled = True
            else:
                firewall_enabled = False
        else:
            firewall_enabled = None
    else:
        fw_match = re.search(r"Status:\s*(active|inactive)", page_text, re.IGNORECASE)
        firewall_enabled = fw_match.group(1).lower() == "active" if fw_match else None

    # ── Pending updates ───────────────────────────────────────────────────
    result, detail = _scorecard(soup, "Pending OS Updates")
    if result:
        if "up to date" in detail:
            pending_updates = 0
        else:
            m = re.search(r"(\d+)", detail)
            pending_updates = int(m.group(1)) if m else 0
    else:
        m = re.search(r"Pending Updates[:\s]*(\d+)", page_text, re.IGNORECASE)
        pending_updates = int(m.group(1)) if m else None

    # ── Secure Boot ───────────────────────────────────────────────────────
    result, detail = _scorecard(soup, "Secure Boot")
    if result:
        if "legacy" in detail or "n/a" in detail or "uefi required" in detail:
            secure_boot_enabled = False
        elif result == "pass":
            secure_boot_enabled = True
        else:
            secure_boot_enabled = False
    else:
        secure_boot_enabled = None

    # ── TPM ───────────────────────────────────────────────────────────────
    result, detail = _scorecard(soup, "TPM")
    if result:
        tpm_present = "not detected" not in detail and result != "fail"
    else:
        tpm_present = None

    # ── SSH ───────────────────────────────────────────────────────────────
    result, detail = _scorecard(soup, "SSH Service")
    if result:
        if "not installed" in detail or "not running" in detail:
            ssh_enabled = False
        elif "active" in detail:
            ssh_enabled = True
        else:
            ssh_enabled = result == "pass"
    else:
        ssh_match = re.search(r"SSH.*?Status[:\s]*(active|inactive)", page_text, re.IGNORECASE)
        if ssh_match:
            ssh_enabled = ssh_match.group(1).lower() == "active"
        elif "ssh not installed" in page_text.lower():
            ssh_enabled = False
        else:
            ssh_enabled = None

    # ── Auditd ────────────────────────────────────────────────────────────
    result, detail = _scorecard(soup, "Audit Daemon")
    if result:
        if "not installed" in detail or "inactive" in detail:
            auditd_enabled = False
        elif result == "pass" or "loaded" in detail or "active" in detail:
            auditd_enabled = True
        else:
            auditd_enabled = False
    else:
        auditd_enabled = None

    # ── Passwordless sudo ─────────────────────────────────────────────────
    result, detail = _scorecard(soup, "Passwordless Sudo")
    if result:
        passwordless_sudo = result != "pass" and "none found" not in detail
    else:
        passwordless_sudo = False

    # ── Screen lock ───────────────────────────────────────────────────────
    screen_lock_enabled = None   # Linux dconf requires live query — leave as None

    # ── Password policy ───────────────────────────────────────────────────
    pass_max_days = extract_int(_label_value(soup, "PASS_MAX_DAYS") or "")
    pass_min_days = extract_int(_label_value(soup, "PASS_MIN_DAYS") or "")
    if pass_max_days is None:
        m = re.search(r"PASS_MAX_DAYS\s+(\d+)", page_text)
        pass_max_days = int(m.group(1)) if m else None
    if pass_min_days is None:
        m = re.search(r"PASS_MIN_DAYS\s+(\d+)", page_text)
        pass_min_days = int(m.group(1)) if m else None

    # ── Remote access tools ───────────────────────────────────────────────
    anydesk_running       = False
    teamviewer_running    = False
    chrome_remote_desktop = False
    svc_text = _section_text(soup, "Running Services")
    combined = (svc_text + page_text).lower()
    if "anydesk" in combined:
        anydesk_running = True
    if "teamviewerd" in combined or "teamviewer_service" in combined:
        teamviewer_running = True
    if "chromoting" in combined or "chrome remote desktop" in combined:
        chrome_remote_desktop = True

    # ── World-writable dirs ───────────────────────────────────────────────
    _, ww_detail = _scorecard(soup, "World-Writable")
    ww_count = 0
    ww_m = re.search(r"(\d+)\s+potential", ww_detail)
    if ww_m:
        ww_count = int(ww_m.group(1))

    # ── Samba / NFS shares ────────────────────────────────────────────────
    shares = []
    samba_text = _section_text(soup, "Network Shares") or _section_text(soup, "Samba")
    for m in re.finditer(r"\[(\w[\w\s]+)\]", samba_text):
        shares.append(m.group(1).strip())

    # ── Running services ─────────────────────────────────────────────────
    services = []
    svc_heading = soup.find(
        lambda t: t.name in ("h2", "h3") and "running services" in t.get_text(strip=True).lower()
    )
    if svc_heading:
        svc_table = svc_heading.find_next("table")
        if svc_table:
            for row in svc_table.find_all("tr"):
                cols = [clean(td.get_text()) for td in row.find_all(["td", "th"])]
                if cols and cols[0] not in ("UNIT", ""):
                    services.append(cols[0])

    # ── Network listeners ─────────────────────────────────────────────────
    listeners = []
    net_heading = soup.find(
        lambda t: t.name in ("h2", "h3") and "open port" in t.get_text(strip=True).lower()
    ) or soup.find(
        lambda t: t.name in ("h2", "h3") and "network" in t.get_text(strip=True).lower()
    )
    if net_heading:
        pre = net_heading.find_next("pre")
        if pre:
            for line in pre.get_text().splitlines():
                line = line.strip()
                if line and not line.startswith("Netid"):
                    listeners.append(line)

    sw_count = len(re.findall(r"^ii\s", page_text, re.MULTILINE))

    raw_data = {
        "hostname": hostname, "os": os_name, "kernel": kernel, "arch": arch,
        "cpu": cpu, "ram": ram, "ip": ip_address,
        "firewall": "active" if firewall_enabled else "inactive",
        "encryption": str(encryption_enabled),
        "antivirus": "installed" if antivirus_installed else "not detected",
        "secure_boot": str(secure_boot_enabled), "tpm": str(tpm_present),
        "ssh": "active" if ssh_enabled else "inactive",
        "auditd": "active" if auditd_enabled else "inactive",
        "passwordless_sudo": str(passwordless_sudo),
        "pending_updates": str(pending_updates),
        "pass_max_days": str(pass_max_days), "pass_min_days": str(pass_min_days),
        "anydesk": str(anydesk_running), "teamviewer": str(teamviewer_running),
        "chrome_remote_desktop": str(chrome_remote_desktop),
        "world_writable_dirs": ww_count, "network_shares": shares,
        "running_services": services, "network_listeners": listeners,
        "installed_packages_count": sw_count,
    }

    return {
        "hostname": hostname, "os_type": "linux", "os_name": os_name,
        "os_version": kernel, "architecture": arch, "ip_address": ip_address,
        "report_date": report_date, "report_file": str(filepath),
        "cpu": cpu, "ram": ram,
        "firewall_enabled": firewall_enabled,
        "encryption_enabled": encryption_enabled,
        "antivirus_installed": antivirus_installed,
        "antivirus_name": "", "antivirus_realtime": None,
        "antivirus_updated_at": None, "antivirus_tamper": None,
        "secure_boot_enabled": secure_boot_enabled,
        "tpm_present": tpm_present, "ssh_enabled": ssh_enabled,
        "auditd_enabled": auditd_enabled, "passwordless_sudo": passwordless_sudo,
        "sip_enabled": None, "gatekeeper_enabled": None,
        "usb_storage_enabled": None, "screen_lock_enabled": screen_lock_enabled,
        "chrome_remote_desktop": chrome_remote_desktop,
        "pending_updates": pending_updates, "last_patch_date": None,
        "pass_max_days": pass_max_days, "pass_min_days": pass_min_days,
        "pass_min_len": None, "lockout_threshold": None,
        "anydesk_running": anydesk_running, "teamviewer_running": teamviewer_running,
        "rdp_open": False, "raw_data": raw_data,
    }
