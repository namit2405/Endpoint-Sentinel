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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
  Key,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatLastSeen(raw: string): string {
  if (!raw) return "—";
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function capitalize(s: string): string {
  if (!s) return "—";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function ProtectionBadge({ status }: { status: WatchGuardDevice["protection_status"] }) {
  switch (status) {
    case "protected":
      return (
        <Badge className="rounded-full border-transparent bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
          Protected
        </Badge>
      );
    case "error":
      return (
        <Badge className="inline-flex items-center gap-1 rounded-full border-transparent bg-destructive/15 text-destructive">
          <AlertTriangle className="size-3" aria-hidden="true" />
          Error
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

function EncryptionBadge({ encryption }: { encryption: WatchGuardDevice["encryption"] }) {
  if (encryption === "none") {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <Badge className="rounded-full border-transparent bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
      {encryption}
    </Badge>
  );
}

// ── Detail panel ─────────────────────────────────────────────────────────────

function DeviceDetailPanel({
  device,
  open,
  onClose,
}: {
  device: WatchGuardDevice | null;
  open: boolean;
  onClose: () => void;
}) {
  if (!device) return null;

  const flags: string[] = [];
  if (device.reboot_requested) flags.push("Reboot Pending");
  if (device.reinstall_protection) flags.push("Reinstall Protection");
  if (device.reinstall_agent) flags.push("Reinstall Agent");

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader className="mb-6">
          <SheetTitle className="font-mono text-lg font-bold">{device.hostname}</SheetTitle>
          <SheetDescription>Device details from WatchGuard Cloud</SheetDescription>
        </SheetHeader>

        <div className="space-y-6">
          {/* Basic Info */}
          <section>
            <h3 className="mb-3 text-sm font-semibold text-foreground">Basic Info</h3>
            <dl className="space-y-2 text-sm">
              <DetailRow label="Hostname" value={device.hostname} mono />
              <DetailRow label="OS" value={device.os} />
              <DetailRow label="Device Type" value={capitalize(device.device_type)} />
              <DetailRow label="IP Address" value={device.ip_address} mono />
              <DetailRow label="MAC Address" value={device.mac_address} mono />
              <DetailRow label="Domain" value={device.domain} />
              <DetailRow label="AD Path" value={device.ad_path} />
            </dl>
          </section>

          {/* Security Status */}
          <section>
            <h3 className="mb-3 text-sm font-semibold text-foreground">Security Status</h3>
            <dl className="space-y-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">Protection Status</dt>
                <dd><ProtectionBadge status={device.protection_status} /></dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">Encryption</dt>
                <dd><EncryptionBadge encryption={device.encryption} /></dd>
              </div>
              <DetailRow label="Agent Version" value={device.agent_version} />
            </dl>
          </section>

          {/* Policy */}
          <section>
            <h3 className="mb-3 text-sm font-semibold text-foreground">Policy</h3>
            <dl className="space-y-2 text-sm">
              <DetailRow label="Policy Name" value={device.policy} />
              <DetailRow label="Group Path" value={device.group_path} />
            </dl>
          </section>

          {/* Status Flags */}
          <section>
            <h3 className="mb-3 text-sm font-semibold text-foreground">Status Flags</h3>
            {flags.length === 0 ? (
              <p className="text-sm text-muted-foreground">No pending actions</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {flags.map((f) => (
                  <Badge
                    key={f}
                    className="rounded-full border-transparent bg-amber-500/15 text-amber-600 dark:text-amber-400"
                  >
                    {f}
                  </Badge>
                ))}
              </div>
            )}
          </section>

          {/* Last Activity */}
          <section>
            <h3 className="mb-3 text-sm font-semibold text-foreground">Last Activity</h3>
            <dl className="space-y-2 text-sm">
              <DetailRow label="Last Seen" value={formatLastSeen(device.last_seen)} />
              <DetailRow label="Logged On User" value={device.user} />
              <DetailRow label="Site" value={device.site} />
            </dl>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd
        className={`min-w-0 break-all text-right ${mono ? "font-mono text-xs" : ""} ${!value ? "text-muted-foreground" : ""}`}
      >
        {value || "—"}
      </dd>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function WatchGuardPage() {
  const [data, setData] = useState<WatchGuardDevicesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [deviceTypeFilter, setDeviceTypeFilter] = useState("all");
  const [protectionFilter, setProtectionFilter] = useState<
    "all" | WatchGuardDevice["protection_status"]
  >("all");
  const [encryptionFilter, setEncryptionFilter] = useState<"all" | "encrypted" | "none">("all");
  const [selectedDevice, setSelectedDevice] = useState<WatchGuardDevice | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return devices.filter((d) => {
      if (
        q &&
        !d.hostname.toLowerCase().includes(q) &&
        !d.ip_address.toLowerCase().includes(q) &&
        !d.user.toLowerCase().includes(q) &&
        !d.domain.toLowerCase().includes(q) &&
        !d.mac_address.toLowerCase().includes(q)
      )
        return false;
      if (deviceTypeFilter !== "all" && d.device_type !== deviceTypeFilter) return false;
      if (protectionFilter !== "all" && d.protection_status !== protectionFilter) return false;
      if (encryptionFilter === "encrypted" && d.encryption === "none") return false;
      if (encryptionFilter === "none" && d.encryption !== "none") return false;
      return true;
    });
  }, [devices, search, deviceTypeFilter, protectionFilter, encryptionFilter]);

  const totalDevices = data?.total ?? 0;
  const protectedCount = devices.filter((d) => d.protection_status === "protected").length;
  const errorCount = devices.filter((d) => d.protection_status === "error").length;
  const isolatedCount = devices.filter((d) => d.protection_status === "isolated").length;
  const availableLicenses = data?.unassigned_licenses ?? 0;

  function openDetail(device: WatchGuardDevice) {
    setSelectedDevice(device);
    setPanelOpen(true);
  }

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

      {/* Summary cards — 5 columns */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
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
            <CardTitle className="text-sm font-medium">With Errors</CardTitle>
            <ShieldAlert className="size-4 text-destructive" aria-hidden="true" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-7 w-16" />
            ) : (
              <div className="text-2xl font-bold text-destructive">{errorCount}</div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-subtle">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Isolated</CardTitle>
            <ShieldX className="size-4 text-amber-500" aria-hidden="true" />
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

        <Card className="shadow-subtle">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Available Licenses</CardTitle>
            <Key className="size-4 text-blue-500" aria-hidden="true" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-7 w-16" />
            ) : (
              <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                {availableLicenses}
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
                placeholder="Search hostname, IP, user, domain, MAC…"
                aria-label="Search WatchGuard devices"
                className="pl-9"
              />
            </div>

            <Select value={deviceTypeFilter} onValueChange={setDeviceTypeFilter}>
              <SelectTrigger className="w-44" aria-label="Filter by device type">
                <SelectValue placeholder="All Device Types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Device Types</SelectItem>
                <SelectItem value="desktop">Desktop</SelectItem>
                <SelectItem value="laptop">Laptop</SelectItem>
                <SelectItem value="server">Server</SelectItem>
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
                <SelectItem value="error">Error</SelectItem>
                <SelectItem value="isolated">Isolated</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={encryptionFilter}
              onValueChange={(v) =>
                setEncryptionFilter(v as "all" | "encrypted" | "none")
              }
            >
              <SelectTrigger className="w-44" aria-label="Filter by encryption">
                <SelectValue placeholder="All Encryption" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Encryption</SelectItem>
                <SelectItem value="encrypted">Encrypted</SelectItem>
                <SelectItem value="none">Not Encrypted</SelectItem>
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
                    <TableHead>MAC Address</TableHead>
                    <TableHead>Last Seen</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Protection</TableHead>
                    <TableHead>Encryption</TableHead>
                    <TableHead>Site</TableHead>
                    <TableHead>Agent Version</TableHead>
                    <TableHead>Policy</TableHead>
                    <TableHead className="w-10">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((device) => {
                    const needsAction =
                      device.reboot_requested ||
                      device.reinstall_protection ||
                      device.reinstall_agent;
                    const actionFlags: string[] = [];
                    if (device.reboot_requested) actionFlags.push("Reboot Pending");
                    if (device.reinstall_protection) actionFlags.push("Reinstall Protection");
                    if (device.reinstall_agent) actionFlags.push("Reinstall Agent");

                    return (
                      <TableRow
                        key={device.id}
                        className="cursor-pointer transition-colors hover:bg-accent/40"
                        onClick={() => openDetail(device)}
                      >
                        <TableCell className="font-mono text-sm font-semibold text-foreground">
                          {device.hostname}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {capitalize(device.device_type)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {device.os || "—"}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {device.ip_address || "—"}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {device.mac_address || "—"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {formatLastSeen(device.last_seen)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {device.user || "—"}
                        </TableCell>
                        <TableCell>
                          <ProtectionBadge status={device.protection_status} />
                        </TableCell>
                        <TableCell>
                          <EncryptionBadge encryption={device.encryption} />
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {device.site || "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {device.agent_version || "—"}
                        </TableCell>
                        <TableCell
                          className="max-w-[10rem] truncate text-xs text-muted-foreground"
                          title={device.policy}
                        >
                          {device.policy
                            ? device.policy.length > 20
                              ? device.policy.slice(0, 20) + "…"
                              : device.policy
                            : "—"}
                        </TableCell>
                        <TableCell>
                          {needsAction ? (
                            <button
                              type="button"
                              title={actionFlags.join(", ")}
                              aria-label={actionFlags.join(", ")}
                              className="rounded p-1 text-orange-500 hover:bg-orange-500/10"
                              onClick={(e) => {
                                e.stopPropagation();
                                openDetail(device);
                              }}
                            >
                              <AlertTriangle className="size-4" aria-hidden="true" />
                            </button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail side panel */}
      <DeviceDetailPanel
        device={selectedDevice}
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
      />
    </div>
  );
}
