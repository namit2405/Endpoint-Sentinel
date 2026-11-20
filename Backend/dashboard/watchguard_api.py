"""
WatchGuard Cloud proxy API.

Provides a single Django REST Framework view that fetches endpoint device
data from the WatchGuard Cloud API and returns it in the same shape used
by the rest of the Endpoint Sentinel dashboard.

Authentication with WatchGuard uses OAuth2 client-credentials flow.
Tokens are cached at module level and refreshed automatically when fewer
than 300 seconds remain on the current token.

External HTTP is performed with urllib.request only (no third-party
requests library).
"""
import base64
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Optional, Tuple

from django.conf import settings
from rest_framework.authentication import TokenAuthentication
from rest_framework.decorators import (
    api_view,
    authentication_classes,
    permission_classes,
)
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response

# ── Token cache ──────────────────────────────────────────────────────────────
# Tuple of (bearer_token, expiry_epoch_seconds) or None when no token held.
_TOKEN_CACHE: Optional[Tuple[str, float]] = None


def _get_token() -> str:
    """Return a valid OAuth2 bearer token, refreshing when needed."""
    global _TOKEN_CACHE

    now = time.time()
    if _TOKEN_CACHE is not None:
        token, expires_at = _TOKEN_CACHE
        if expires_at - now > 300:
            return token

    api_base   = settings.WG_API_BASE
    access_id  = settings.WG_ACCESS_ID
    password   = settings.WG_PASSWORD

    credentials = base64.b64encode(
        f"{access_id}:{password}".encode()
    ).decode()

    body = urllib.parse.urlencode({
        "grant_type": "client_credentials",
        "scope": "api-access",
    }).encode()

    req = urllib.request.Request(
        url=f"{api_base}/oauth/token",
        data=body,
        method="POST",
        headers={
            "Authorization": f"Basic {credentials}",
            "Content-Type": "application/x-www-form-urlencoded",
        },
    )

    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read())

    token      = data["access_token"]
    expires_in = int(data.get("expires_in", 3600))
    _TOKEN_CACHE = (token, now + expires_in)
    return token


# ── Device mapping ───────────────────────────────────────────────────────────

def _map_device(raw: dict) -> dict:
    """Map a raw WatchGuard device object to the dashboard device shape."""
    type_num = raw.get("type", 1)
    device_type = "server" if type_num == 3 else "laptop" if type_num == 2 else "desktop"

    mac_addresses = raw.get("mac_addresses") or []
    mac = mac_addresses[0] if mac_addresses else ""

    logged_on = raw.get("logged_on_users_list") or []
    user = logged_on[0] if logged_on else ""

    enc = raw.get("encryption", 0)
    if enc == 6:
        encryption = "BitLocker+TPM"
    elif enc == 2:
        encryption = "BitLocker"
    else:
        encryption = "none"

    if raw.get("isolation_state", 0) == 1:
        protection_status = "isolated"
    elif raw.get("reinstall_protection_requested") or raw.get("reinstall_agent_requested"):
        protection_status = "error"
    else:
        protection_status = "protected"

    return {
        "id":                  raw.get("device_id", ""),
        "hostname":            raw.get("host_name", ""),
        "device_type":         device_type,
        "os":                  raw.get("operating_system", ""),
        "ip_address":          raw.get("ip_address", ""),
        "mac_address":         mac,
        "last_seen":           raw.get("last_connection", ""),
        "user":                user,
        "protection_status":   protection_status,
        "encryption":          encryption,
        "site":                raw.get("site_name", ""),
        "agent_version":       raw.get("agent_version", ""),
        "policy":              raw.get("security_configuration_name", ""),
        "domain":              raw.get("domain", ""),
        "group_path":          raw.get("custom_group_folder_path", ""),
        "ad_path":             raw.get("active_directory_canonical_name", ""),
        "reboot_requested":    raw.get("reboot_requested", False),
        "reinstall_protection": raw.get("reinstall_protection_requested", False),
        "reinstall_agent":     raw.get("reinstall_agent_requested", False),
        "isolation_state":     raw.get("isolation_state", 0),
        "platform_id":         raw.get("platform_id", 1),
    }


# ── View ─────────────────────────────────────────────────────────────────────

@api_view(["GET"])
@authentication_classes([TokenAuthentication])
@permission_classes([IsAuthenticated])
def watchguard_devices(request: Request) -> Response:
    """
    GET /api/watchguard/devices/

    Returns the list of endpoint devices registered in WatchGuard Cloud.
    Requires a valid DRF Token in the Authorization header.

    Responses:
      200  {"devices": [...], "total": N, "timestamp": "..."}
      200  {"devices": [], "total": 0, "error": "WatchGuard not configured"}
           — when WG_API_BASE is empty / not set.
      502  {"error": "<message>"}
           — on network or authentication failure.
    """
    api_base   = settings.WG_API_BASE
    account_id = settings.WG_ACCOUNT_ID
    api_key    = settings.WG_API_KEY

    if not api_base:
        return Response({"devices": [], "total": 0, "error": "WatchGuard not configured"})

    try:
        token = _get_token()
    except urllib.error.HTTPError as exc:
        return Response(
            {"error": f"WatchGuard auth failed: HTTP {exc.code}"},
            status=502,
        )
    except Exception as exc:  # noqa: BLE001
        return Response(
            {"error": f"WatchGuard auth error: {exc}"},
            status=502,
        )

    url = (
        f"{api_base}/rest/endpoint-security/management/api/v1"
        f"/accounts/{account_id}/devices?pageSize=200"
    )

    req = urllib.request.Request(
        url=url,
        method="GET",
        headers={
            "Authorization": f"Bearer {token}",
            "WatchGuard-API-Key": api_key,
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        return Response(
            {"error": f"WatchGuard API error: HTTP {exc.code}"},
            status=502,
        )
    except Exception as exc:  # noqa: BLE001
        return Response(
            {"error": f"WatchGuard request failed: {exc}"},
            status=502,
        )

    # WatchGuard may return the list under various top-level keys.
    raw_devices = (
        data.get("devices")
        or data.get("data")
        or data.get("items")
        or (data if isinstance(data, list) else [])
    )

    devices = [_map_device(d) for d in raw_devices]

    # Fetch license counts; silently default to 0 on any failure.
    assigned_licenses = 0
    unassigned_licenses = 0
    try:
        lic_url = (
            f"{api_base}/rest/endpoint-security/management/api/v1"
            f"/accounts/{account_id}/licenses"
        )
        lic_req = urllib.request.Request(
            url=lic_url,
            method="GET",
            headers={
                "Authorization": f"Bearer {token}",
                "WatchGuard-API-Key": api_key,
            },
        )
        with urllib.request.urlopen(lic_req, timeout=20) as lic_resp:
            lic_data = json.loads(lic_resp.read())
        counter = (lic_data.get("product_license_counter") or [{}])[0]
        assigned_licenses = counter.get("assigned_licenses", 0)
        unassigned_licenses = counter.get("unassigned_licenses", 0)
    except Exception:  # noqa: BLE001
        pass

    return Response({
        "devices":             devices,
        "total":               len(devices),
        "assigned_licenses":   assigned_licenses,
        "unassigned_licenses": unassigned_licenses,
        "timestamp":           time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    })
