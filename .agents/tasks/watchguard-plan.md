# Implementation Plan: WatchGuard Cloud Page

## Context

- **Backend**: Django REST Framework, `Backend/` directory. Views use `@api_view` + `@authentication_classes([TokenAuthentication])` + `@permission_classes([IsAuthenticated])`. All existing API views live in `dashboard/api_views.py`; new view goes in its own module `dashboard/watchguard_api.py`. Settings read from env via `config()` (python-decouple). URLs registered in `dashboard/urls.py`.
- **Frontend**: React 19 + TanStack Router, TypeScript strict mode. Routes registered as `createRoute(...)` objects assembled into `routeTree` in `App.tsx`. Sidebar nav items live in the `NAV_ITEMS` array in `Sidebar.tsx`. API calls go through the `APIClient` class in `lib/api-client.ts`. Types in `lib/types.ts`. Shadcn components. `timeAgo()` from `lib/format.ts` takes a unix-ms timestamp.
- **Lucide icons already in use in Sidebar**: `Activity`, `Gauge`, `LayoutDashboard`, `MonitorCheck`, `Power`, `Search`, `Server`, `ShieldCheck`. Use `ShieldAlert` for WatchGuard (confirmed present in lucide-react 0.511.0 by its use in `OverviewPage.tsx` and `SearchPage.tsx`).
- **WG credentials**: already present in `Backend/.env.development` under `WG_API_BASE`, `WG_ACCOUNT_ID`, `WG_ACCESS_ID`, `WG_API_KEY`, `WG_PASSWORD`.
- **Verification**:
  - Backend: `$env:ENDPOINT_SENTINEL_ENV_FILE='.env.development'; .\venv\Scripts\python.exe manage.py check` from `Backend/`
  - Frontend: `pnpm run typecheck` from `frontend/src/frontend/`

---

## Steps

- [ ] 1. Add WatchGuard settings to `Backend/core/settings.py`.

  Append five `config()` calls after the existing agent/CORS/REST config block. All five default to `''` so the app starts cleanly with no `.env` entry.

  **Files**: `Backend/core/settings.py`

  **What to add** (append near the bottom, after the `# ── Django Admin` block):
  ```python
  # ── WatchGuard Cloud Integration ───────────────────────────────────────────────
  WG_API_BASE     = config('WG_API_BASE',     default='')
  WG_ACCOUNT_ID   = config('WG_ACCOUNT_ID',   default='')
  WG_ACCESS_ID    = config('WG_ACCESS_ID',    default='')
  WG_PASSWORD     = config('WG_PASSWORD',     default='')
  WG_API_KEY      = config('WG_API_KEY',      default='')
  ```

  **Verify**: `$env:ENDPOINT_SENTINEL_ENV_FILE='.env.development'; .\venv\Scripts\python.exe manage.py check` from `Backend/` — exits 0 with "System check identified no issues."

---

- [ ] 2. Create `Backend/dashboard/watchguard_api.py`.

  New module; no existing file to modify. Implements token caching at module level, OAuth2 Basic-auth token fetch, device list fetch, and clean device mapping. All HTTP via `urllib.request` only.

  **Files**: `Backend/dashboard/watchguard_api.py` (create)

  **Full module content**:

  ```python
  """
  WatchGuard Cloud API proxy view.

  Authenticates via OAuth2 client-credentials (Basic auth with access_id:password),
  caches the bearer token at module level to avoid re-authenticating on every request,
  and proxies the device list from the Endpoint Security Management API.
  """
  import base64
  import json
  import time
  import urllib.error
  import urllib.parse
  import urllib.request
  from datetime import datetime, timezone

  from django.conf import settings
  from rest_framework.authentication import TokenAuthentication
  from rest_framework.decorators import api_view, authentication_classes, permission_classes
  from rest_framework.permissions import IsAuthenticated
  from rest_framework.response import Response
  from rest_framework import status as drf_status

  # Module-level token cache: (access_token: str, expires_at: float)
  # expires_at is a unix timestamp (seconds). Refresh when < 300 s remain.
  _TOKEN_CACHE: tuple[str, float] | None = None
  _TOKEN_REFRESH_BUFFER = 300  # seconds


  def _get_token() -> str:
      """Return a valid WatchGuard bearer token, refreshing when needed."""
      global _TOKEN_CACHE

      if _TOKEN_CACHE is not None:
          token, expires_at = _TOKEN_CACHE
          if time.time() < expires_at - _TOKEN_REFRESH_BUFFER:
              return token

      access_id = settings.WG_ACCESS_ID
      password = settings.WG_PASSWORD
      api_base = settings.WG_API_BASE

      credentials = base64.b64encode(
          f"{access_id}:{password}".encode()
      ).decode()

      token_url = f"{api_base}/oauth/token"
      body = urllib.parse.urlencode({
          "grant_type": "client_credentials",
          "scope": "api-access",
      }).encode()

      req = urllib.request.Request(
          token_url,
          data=body,
          headers={
              "Authorization": f"Basic {credentials}",
              "Content-Type": "application/x-www-form-urlencoded",
          },
          method="POST",
      )

      with urllib.request.urlopen(req, timeout=15) as resp:
          data = json.loads(resp.read().decode())

      access_token = data["access_token"]
      expires_in = int(data.get("expires_in", 3600))
      _TOKEN_CACHE = (access_token, time.time() + expires_in)
      return access_token


  def _map_device(raw: dict) -> dict:
      """Map a raw WatchGuard device object to the clean structure used by the frontend."""
      # Protection status: derive from agent/policy fields
      protection_status = "unknown"
      agent_status = raw.get("agentStatus") or raw.get("agent_status") or ""
      if isinstance(agent_status, str):
          agent_status_lower = agent_status.lower()
          if "isolated" in agent_status_lower:
              protection_status = "isolated"
          elif agent_status_lower in ("active", "protected", "online"):
              protection_status = "protected"
          elif agent_status_lower in ("inactive", "unprotected", "offline"):
              protection_status = "unprotected"

      # Encryption: look for disk encryption or BitLocker fields
      encryption = raw.get("encryptionStatus") or raw.get("encryption_status") or raw.get("diskEncryption") or ""

      # Last seen: prefer ISO string fields; fall back to epoch ms
      last_seen_raw = (
          raw.get("lastSeen")
          or raw.get("last_seen")
          or raw.get("lastContact")
          or raw.get("lastCheckIn")
          or ""
      )

      return {
          "id": raw.get("deviceId") or raw.get("device_id") or raw.get("id") or "",
          "hostname": raw.get("hostName") or raw.get("hostname") or raw.get("name") or "",
          "device_type": raw.get("deviceType") or raw.get("device_type") or "",
          "os": raw.get("operatingSystem") or raw.get("os") or raw.get("osVersion") or "",
          "ip_address": raw.get("ipAddress") or raw.get("ip_address") or raw.get("ipv4Address") or "",
          "last_seen": last_seen_raw,
          "user": raw.get("lastLoggedInUser") or raw.get("user") or raw.get("userName") or "",
          "protection_status": protection_status,
          "encryption": encryption,
          "site": raw.get("site") or raw.get("siteName") or raw.get("location") or "",
          "agent_version": raw.get("agentVersion") or raw.get("agent_version") or "",
          "policy": raw.get("policyName") or raw.get("policy") or "",
      }


  @api_view(["GET"])
  @authentication_classes([TokenAuthentication])
  @permission_classes([IsAuthenticated])
  def watchguard_devices(request):
      """
      GET /api/watchguard/devices/
      Proxies the WatchGuard Endpoint Security device list to the frontend.
      Returns {"devices": [...], "total": N, "timestamp": "..."}.
      Returns {"devices": [], "total": 0, "error": "..."} when not configured or on error.
      """
      api_base = settings.WG_API_BASE
      account_id = settings.WG_ACCOUNT_ID

      if not api_base:
          return Response({
              "devices": [],
              "total": 0,
              "error": "WatchGuard not configured",
          })

      try:
          token = _get_token()
      except Exception as exc:
          return Response(
              {
                  "devices": [],
                  "total": 0,
                  "error": f"WatchGuard authentication failed: {exc}",
              },
              status=drf_status.HTTP_502_BAD_GATEWAY,
          )

      devices_url = (
          f"{api_base}/rest/endpoint-security/management/api/v1"
          f"/accounts/{account_id}/devices?pageSize=200"
      )

      req = urllib.request.Request(
          devices_url,
          headers={
              "Authorization": f"Bearer {token}",
              "Accept": "application/json",
              "WatchGuard-API-Key": settings.WG_API_KEY,
          },
          method="GET",
      )

      try:
          with urllib.request.urlopen(req, timeout=20) as resp:
              raw_data = json.loads(resp.read().decode())
      except urllib.error.HTTPError as exc:
          return Response(
              {
                  "devices": [],
                  "total": 0,
                  "error": f"WatchGuard API error: HTTP {exc.code}",
              },
              status=drf_status.HTTP_502_BAD_GATEWAY,
          )
      except Exception as exc:
          return Response(
              {
                  "devices": [],
                  "total": 0,
                  "error": f"WatchGuard API unreachable: {exc}",
              },
              status=drf_status.HTTP_502_BAD_GATEWAY,
          )

      # WG API may return a list directly, or wrap in {"data": [...]} / {"devices": [...]}
      if isinstance(raw_data, list):
          raw_list = raw_data
      elif isinstance(raw_data, dict):
          raw_list = (
              raw_data.get("data")
              or raw_data.get("devices")
              or raw_data.get("items")
              or []
          )
      else:
          raw_list = []

      devices = [_map_device(d) for d in raw_list]

      return Response({
          "devices": devices,
          "total": len(devices),
          "timestamp": datetime.now(timezone.utc).isoformat(),
      })
  ```

  **Verify**: `$env:ENDPOINT_SENTINEL_ENV_FILE='.env.development'; .\venv\Scripts\python.exe manage.py check` from `Backend/` — exits 0.

---

- [ ] 3. Register the WatchGuard URL in `Backend/dashboard/urls.py`.

  Depends on step 2 (module must exist before import). Add the import and the path entry following the existing section pattern.

  **Files**: `Backend/dashboard/urls.py`

  **Change 1 — add import** at the top of the existing `from . import ...` line:
  ```python
  from . import views, api_views, auth_api, licensing_api, views_realtime_monitoring, watchguard_api
  ```

  **Change 2 — add URL** in the `urlpatterns` list, append a new section after the Real-Time Monitoring block:
  ```python
      # ── WatchGuard Cloud APIs ──────────────────────────────────────────────
      path("api/watchguard/devices/", watchguard_api.watchguard_devices, name="watchguard_devices"),
  ```

  Also add the new section header to the module docstring to match the existing documentation style.

  **Verify**: `$env:ENDPOINT_SENTINEL_ENV_FILE='.env.development'; .\venv\Scripts\python.exe manage.py check` from `Backend/` — exits 0 and URL `api/watchguard/devices/` appears in `python manage.py show_urls` output (optional visual check).

---

- [ ] 4. Add `WatchGuardDevice` interface to `frontend/src/frontend/src/lib/types.ts`.

  Append the new interface at the end of the file; do not change any existing exports.

  **Files**: `frontend/src/frontend/src/lib/types.ts`

  **What to append**:
  ```typescript
  export interface WatchGuardDevice {
    id: string;
    hostname: string;
    device_type: string;
    os: string;
    ip_address: string;
    last_seen: string;      // ISO 8601 string from WatchGuard API
    user: string;
    protection_status: "protected" | "unprotected" | "isolated" | "unknown";
    encryption: string;
    site: string;
    agent_version: string;
    policy: string;
  }

  export interface WatchGuardDevicesResponse {
    devices: WatchGuardDevice[];
    total: number;
    timestamp?: string;
    error?: string;
  }
  ```

  **Verify**: `pnpm run typecheck` from `frontend/src/frontend/` — exits 0 (no new type errors).

---

- [ ] 5. Add `getWatchGuardDevices()` to the `APIClient` class in `frontend/src/frontend/src/lib/api-client.ts`.

  Depends on step 4 (types must exist). Import the new types and add the method following the existing pattern used by `getInventory()`.

  **Files**: `frontend/src/frontend/src/lib/api-client.ts`

  **Change 1 — extend the import from `./types`** to include the new types:
  ```typescript
  import type {
    DashboardSummary,
    EndpointStatus,
    HealthTrendPoint,
    OSDistribution,
    QuickAlert,
    WatchGuardDevicesResponse,
  } from "./types";
  ```

  **Change 2 — add method** at the end of the `APIClient` class body, before the closing `}`:
  ```typescript
  // ── WatchGuard Cloud ────────────────────────────────────────────────
  async getWatchGuardDevices(): Promise<WatchGuardDevicesResponse> {
    return this.request("/api/watchguard/devices/");
  }
  ```

  **Verify**: `pnpm run typecheck` from `frontend/src/frontend/` — exits 0.

---

- [ ] 6. Create `frontend/src/frontend/src/pages/WatchGuardPage.tsx`.

  Depends on steps 4 and 5. New file; no existing page is modified. Follow the same structure as `InventoryPage.tsx` / `LiveStatusPage.tsx`: Card summary row, filter bar (Input + two Selects), Table, loading skeleton, error state, 60-second auto-refresh via `setInterval`.

  **Files**: `frontend/src/frontend/src/pages/WatchGuardPage.tsx` (create)

  **Full component content**:

  ```tsx
  import { Badge } from "@/components/ui/badge";
  import { Button } from "@/components/ui/button";
  import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
  import { Input } from "@/components/ui/input";
  import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
  } from "@/components/ui/select";
  import { Skeleton } from "@/components/ui/skeleton";
  import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
  } from "@/components/ui/table";
  import { apiClient } from "@/lib/api-client";
  import type { WatchGuardDevice, WatchGuardDevicesResponse } from "@/lib/types";
  import {
    AlertTriangle,
    RefreshCw,
    Search,
    Shield,
    ShieldAlert,
    ShieldCheck,
    ShieldX,
  } from "lucide-react";
  import { useCallback, useEffect, useMemo, useState } from "react";

  const REFRESH_INTERVAL_MS = 60_000;

  function protectionBadge(status: WatchGuardDevice["protection_status"]) {
    switch (status) {
      case "protected":
        return (
          <Badge className="bg-success/15 text-success">
            <ShieldCheck className="mr-1 size-3" />
            Protected
          </Badge>
        );
      case "unprotected":
        return (
          <Badge className="bg-destructive/15 text-destructive">
            <ShieldX className="mr-1 size-3" />
            Unprotected
          </Badge>
        );
      case "isolated":
        return (
          <Badge className="bg-warning/15 text-warning">
            <ShieldAlert className="mr-1 size-3" />
            Isolated
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="text-muted-foreground">
            Unknown
          </Badge>
        );
    }
  }

  function formatLastSeen(raw: string): string {
    if (!raw) return "—";
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return raw;
    return d.toLocaleString();
  }

  export default function WatchGuardPage() {
    const [data, setData] = useState<WatchGuardDevicesResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isRefreshing, setIsRefreshing] = useState(false);

    const [search, setSearch] = useState("");
    const [deviceTypeFilter, setDeviceTypeFilter] = useState("all");
    const [protectionFilter, setProtectionFilter] = useState("all");

    const fetchDevices = useCallback(async (silent = false) => {
      if (!silent) setLoading(true);
      else setIsRefreshing(true);
      setError(null);
      try {
        const result = await apiClient.getWatchGuardDevices();
        if (result.error && result.total === 0) {
          setError(result.error);
        }
        setData(result);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load WatchGuard devices",
        );
      } finally {
        setLoading(false);
        setIsRefreshing(false);
      }
    }, []);

    // Initial load
    useEffect(() => {
      fetchDevices(false);
    }, [fetchDevices]);

    // Auto-refresh every 60 s
    useEffect(() => {
      const id = window.setInterval(() => fetchDevices(true), REFRESH_INTERVAL_MS);
      return () => window.clearInterval(id);
    }, [fetchDevices]);

    const devices = data?.devices ?? [];

    // Derive unique device types for filter dropdown
    const deviceTypes = useMemo(() => {
      const types = new Set(devices.map((d) => d.device_type).filter(Boolean));
      return Array.from(types).sort();
    }, [devices]);

    const filtered = useMemo(() => {
      const q = search.trim().toLowerCase();
      return devices.filter((d) => {
        if (
          q &&
          !d.hostname.toLowerCase().includes(q) &&
          !d.ip_address.toLowerCase().includes(q) &&
          !d.user.toLowerCase().includes(q)
        )
          return false;
        if (deviceTypeFilter !== "all" && d.device_type !== deviceTypeFilter)
          return false;
        if (
          protectionFilter !== "all" &&
          d.protection_status !== protectionFilter
        )
          return false;
        return true;
      });
    }, [devices, search, deviceTypeFilter, protectionFilter]);

    // Summary card counts
    const total = devices.length;
    const protected_ = devices.filter((d) => d.protection_status === "protected").length;
    const unprotected = devices.filter(
      (d) => d.protection_status === "unprotected",
    ).length;
    const isolated = devices.filter((d) => d.protection_status === "isolated").length;

    return (
      <div className="min-w-0 space-y-6">
        {/* Summary cards */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Shield className="size-4" />
                Total Devices
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-foreground">{total}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <ShieldCheck className="size-4 text-success" />
                Protected
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-success">{protected_}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <ShieldX className="size-4 text-destructive" />
                Unprotected
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-destructive">{unprotected}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <ShieldAlert className="size-4 text-warning" />
                Isolated
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-warning">{isolated}</p>
            </CardContent>
          </Card>
        </div>

        {/* Filter bar */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative min-w-0 w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search hostname, IP, user…"
              className="pl-9"
            />
          </div>

          <Select value={deviceTypeFilter} onValueChange={setDeviceTypeFilter}>
            <SelectTrigger className="w-full sm:w-44">
              <SelectValue placeholder="Device type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All device types</SelectItem>
              {deviceTypes.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={protectionFilter} onValueChange={setProtectionFilter}>
            <SelectTrigger className="w-full sm:w-44">
              <SelectValue placeholder="Protection status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="protected">Protected</SelectItem>
              <SelectItem value="unprotected">Unprotected</SelectItem>
              <SelectItem value="isolated">Isolated</SelectItem>
              <SelectItem value="unknown">Unknown</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchDevices(false)}
            disabled={loading || isRefreshing}
            className="ml-auto"
          >
            <RefreshCw
              className={`size-4 ${isRefreshing ? "animate-spin" : ""}`}
            />
            {isRefreshing ? "Refreshing…" : "Refresh"}
          </Button>
        </div>

        {/* Result count / refresh indicator */}
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <p>
            {loading
              ? "Loading WatchGuard devices…"
              : `${filtered.length} of ${total} devices`}
          </p>
          {isRefreshing && (
            <span className="flex items-center gap-1.5 text-xs">
              <span className="size-2 animate-pulse rounded-full bg-primary" />
              Refreshing
            </span>
          )}
        </div>

        {/* Error state */}
        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <AlertTriangle className="size-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Table */}
        <div className="min-w-0 max-w-full overflow-hidden rounded-xl border border-border bg-card shadow-subtle">
          {loading ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-6 w-24 rounded-full" />
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-20" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-muted">
                <Shield className="size-6 text-muted-foreground" />
              </div>
              <h3 className="font-display text-lg font-semibold text-foreground">
                No devices found
              </h3>
              <p className="max-w-sm text-sm text-muted-foreground">
                {total === 0
                  ? "No devices were returned from WatchGuard Cloud."
                  : "No devices match your current filters."}
              </p>
            </div>
          ) : (
            <Table className="min-w-[900px]">
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead>Hostname</TableHead>
                  <TableHead>Device Type</TableHead>
                  <TableHead>OS</TableHead>
                  <TableHead>IP Address</TableHead>
                  <TableHead>Last Seen</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Protection</TableHead>
                  <TableHead>Encryption</TableHead>
                  <TableHead>Site</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((device) => (
                  <TableRow key={device.id || device.hostname}>
                    <TableCell className="font-medium">
                      {device.hostname || "—"}
                    </TableCell>
                    <TableCell>{device.device_type || "—"}</TableCell>
                    <TableCell>{device.os || "—"}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {device.ip_address || "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatLastSeen(device.last_seen)}
                    </TableCell>
                    <TableCell>{device.user || "—"}</TableCell>
                    <TableCell>{protectionBadge(device.protection_status)}</TableCell>
                    <TableCell>
                      {device.encryption ? (
                        <span className="text-xs">{device.encryption}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>{device.site || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    );
  }
  ```

  **Verify**: `pnpm run typecheck` from `frontend/src/frontend/` — exits 0.

---

- [ ] 7. Register the `/watchguard` route and TITLES entry in `frontend/src/frontend/src/App.tsx`.

  Depends on step 6. Three additions: import, route object, `routeTree` child, and TITLES entry.

  **Files**: `frontend/src/frontend/src/App.tsx`

  **Change 1 — add import** (alongside the other page imports near the top):
  ```typescript
  import WatchGuardPage from "@/pages/WatchGuardPage";
  ```

  **Change 2 — add TITLES entry** (inside the `TITLES` object, after the `/power` entry):
  ```typescript
  "/watchguard": {
    title: "WatchGuard",
    subtitle: "WatchGuard Cloud endpoint protection status",
  },
  ```

  **Change 3 — add route object** (after `powerRoute` definition):
  ```typescript
  const watchguardRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/watchguard",
    component: WatchGuardPage,
  });
  ```

  **Change 4 — add to routeTree** (inside the `rootRoute.addChildren([...])` array, after `powerRoute`):
  ```typescript
  watchguardRoute,
  ```

  **Verify**: `pnpm run typecheck` from `frontend/src/frontend/` — exits 0.

---

- [ ] 8. Add WatchGuard nav item to `frontend/src/frontend/src/components/Sidebar.tsx`.

  Depends on step 7 (route must exist for navigation to be meaningful). `ShieldAlert` is already available in lucide-react 0.511.0 (confirmed used in `OverviewPage.tsx`).

  **Files**: `frontend/src/frontend/src/components/Sidebar.tsx`

  **Change 1 — add `ShieldAlert` to the lucide-react import** (alongside the existing icons):
  ```typescript
  import {
    Activity,
    Gauge,
    LayoutDashboard,
    type LucideIcon,
    MonitorCheck,
    Power,
    Search,
    Server,
    ShieldAlert,
    ShieldCheck,
  } from "lucide-react";
  ```

  **Change 2 — append nav item to `NAV_ITEMS`** (after the `Search` entry):
  ```typescript
  { label: "WatchGuard", to: "/watchguard", icon: ShieldAlert },
  ```

  **Verify**: `pnpm run typecheck` from `frontend/src/frontend/` — exits 0.

---

## Dependency Order Summary

```
1 → settings.py        (no deps)
2 → watchguard_api.py  (needs step 1 for settings.WG_*)
3 → urls.py            (needs step 2 for import)
4 → types.ts           (no deps)
5 → api-client.ts      (needs step 4)
6 → WatchGuardPage.tsx (needs steps 4, 5)
7 → App.tsx            (needs step 6)
8 → Sidebar.tsx        (needs step 7)
```

Backend steps (1–3) and frontend steps (4–8) are independent of each other and can be done in either order, but within each track the numbered order must be followed.

## Final verification

After all steps:

**Backend** (from `Backend/` directory):
```powershell
$env:ENDPOINT_SENTINEL_ENV_FILE='.env.development'; .\venv\Scripts\python.exe manage.py check
```
Expected: `System check identified no issues (0 silenced).`

**Frontend** (from `frontend/src/frontend/` directory):
```powershell
pnpm run typecheck
```
Expected: exits 0, no TypeScript errors.
