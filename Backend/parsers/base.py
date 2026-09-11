"""
Shared utilities for all OS parsers.
Each parser returns a dict that maps directly to EndpointReport fields.
"""
import re
from datetime import datetime, timezone
from typing import Optional


def clean(text: str) -> str:
    """Strip extra whitespace from a string."""
    return re.sub(r"\s+", " ", text or "").strip()


def parse_bool_yn(value: str) -> Optional[bool]:
    """Convert common yes/no/enabled/disabled strings to bool."""
    v = clean(value).lower()
    if v in ("yes", "true", "enabled", "active", "on", "1", "installed"):
        return True
    if v in ("no", "false", "disabled", "inactive", "off", "0", "not installed", "none"):
        return False
    return None


def extract_int(text: str) -> Optional[int]:
    """Pull the first integer out of a string, or return None."""
    m = re.search(r"\d+", text or "")
    return int(m.group()) if m else None


def safe_dt(dt_str: str, fmt: str) -> Optional[datetime]:
    """Parse a datetime string; return None on failure."""
    try:
        return datetime.strptime(dt_str.strip(), fmt).replace(tzinfo=timezone.utc)
    except (ValueError, AttributeError):
        return None
