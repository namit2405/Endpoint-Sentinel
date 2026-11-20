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
import { useEffect, useMemo, useState } from "react";

function protectionBadge(status: WatchGuardDevice["protection_status"]) {
  switch (status) {
    case "protected":
      return (
        <Badge className="rounded-full border-transparent bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
          Protected
        </Badge>
      );
    case "unprotected":
      return (
        <Badge className="rounded-full border-transparent bg-destructive/15 text-destructive">
          Unprotected
        </Badge>
      );
    case "isolated":
      return (
        <Badge className="rounded-full border-transparent bg-amber-500/15 text-amber-600 dark:text-amber-400">
          Isolated
        </Badge>
      );
    default:
      return (
        <Badge className="rounded-full border-transparent bg-muted text-muted-foreground">
          Unknown
        </Badge>
      );
  }
}

function formatLastSeen(raw: string): string {
  if (!raw) return "—";
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

export default function WatchGuardPage() {
  const [data, setData] = useState<WatchGuardDevicesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [deviceTypeFilter, setDeviceTypeFilter] = useState("all");
  const [protectionFilter, setProtectionFilter] = useState<
    "all" | WatchGuardDevice["protection_status"]
  >("all");

  async function fetchDevices() {
    setLoading(true);
    setError(null);
    try {
      const result = await apiClient.getWatchGuardDevices();
      if (result.error) {
        setError(result.error);
      } else {
        setData(result);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load WatchGuard devices");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchDevices();
    const interval = window.setInterval(() => {
      void fetchDevices();
    }, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const devices = data?.devices ?? [];

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
      if (protectionFilter !== "all" && d.protection_status !== protectionFilter)
        return false;
      return true;
    });
  }, [devices, search, deviceTypeFilter, protectionFilter]);

  const totalDevices = devices.length;
  const protectedCount = devices.filter((d) => d.protection_status === "protected").length;
  const unprotectedCount = devices.filter((d) => d.protection_status === "unprotected").length;
  const isolatedCount = devices.filter((d) => d.protection_status === "isolated").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
          WatchGuard
        </h2>
        <p className="text-sm text-muted-foreground">
          WatchGuard Cloud endpoint protection status
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card className="shadow-subtle">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Devices</CardTitle>
            <Shield className="size-4 text-muted-foreground" aria-hidden="true" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-7 w-16" />
            ) : (
              <div className="text-2xl font-bold">{totalDevices}</div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-subtle">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Protected</CardTitle>
            <ShieldCheck className="size-4 text-emerald-500" aria-hidden="true" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-7 w-16" />
            ) : (
              <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                {protectedCount}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-subtle">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Unprotected</CardTitle>
            <ShieldX className="size-4 text-destructive" aria-hidden="true" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-7 w-16" />
            ) : (
              <div className="text-2xl font-bold text-destructive">
                {unprotectedCount}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-subtle">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Isolated</CardTitle>
            <ShieldAlert className="size-4 text-amber-500" aria-hidden="true" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-7 w-16" />
            ) : (
              <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                {isolatedCount}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Filter bar */}
      <Card className="shadow-subtle">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-0 w-full sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search hostname, IP, user…"
                aria-label="Search WatchGuard devices"
                className="pl-9"
              />
            </div>

            <Select
              value={deviceTypeFilter}
              onValueChange={(v) => setDeviceTypeFilter(v)}
            >
              <SelectTrigger className="w-44" aria-label="Filter by device type">
                <SelectValue placeholder="All Device Types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Device Types</SelectItem>
                {deviceTypes.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={protectionFilter}
              onValueChange={(v) =>
                setProtectionFilter(v as "all" | WatchGuardDevice["protection_status"])
              }
            >
              <SelectTrigger className="w-44" aria-label="Filter by protection status">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="protected">Protected</SelectItem>
                <SelectItem value="unprotected">Unprotected</SelectItem>
                <SelectItem value="isolated">Isolated</SelectItem>
                <SelectItem value="unknown">Unknown</SelectItem>
              </SelectContent>
            </Select>

            <Button
              variant="outline"
              size="sm"
              onClick={() => void fetchDevices()}
              disabled={loading}
              className="ml-auto"
            >
              <RefreshCw
                className={`size-4 ${loading ? "animate-spin" : ""}`}
                aria-hidden="true"
              />
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="shadow-subtle">
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-3 p-4">
              {["s1", "s2", "s3", "s4", "s5", "s6"].map((k) => (
                <div key={k} className="flex items-center gap-4">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-6 w-20 rounded-full" />
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-20" />
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
              <AlertTriangle className="size-8 text-destructive" aria-hidden="true" />
              <p className="text-sm font-medium text-foreground">
                Failed to load WatchGuard devices
              </p>
              <p className="max-w-sm text-sm text-muted-foreground">{error}</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
              <Shield className="size-8 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm font-medium text-foreground">No devices found</p>
              <p className="text-sm text-muted-foreground">
                No WatchGuard devices match your current filters.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
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
                    <TableRow key={device.id} className="transition-colors hover:bg-accent/40">
                      <TableCell className="font-mono text-sm font-semibold text-foreground">
                        {device.hostname}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {device.device_type || "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {device.os || "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {device.ip_address || "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatLastSeen(device.last_seen)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {device.user || "—"}
                      </TableCell>
                      <TableCell>{protectionBadge(device.protection_status)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {device.encryption || "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {device.site || "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
