import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  connectionStatusBg,
  connectionStatusColor,
  formatPercent,
  healthStatusBg,
  riskScoreBg,
  timeAgo,
  utilizationBarColor,
} from "@/lib/format";
import type {
  ConnectionStatus,
  EndpointStatus,
  OS,
  RiskLevel,
} from "@/lib/types";
import { useEndpoints } from "@/lib/useEndpoints";
import { cn } from "@/lib/utils";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Columns3,
  RefreshCw,
} from "lucide-react";
import { useMemo, useState } from "react";

type SortKey =
  | "hostname"
  | "status"
  | "last_seen"
  | "cpu_percent"
  | "memory_percent"
  | "disk_percent"
  | "health_score"
  | "risk";

type SortDir = "asc" | "desc";

const PAGE_SIZES = [25, 50, 100] as const;

const OS_OPTIONS: Array<{ value: "all" | OS; label: string }> = [
  { value: "all", label: "All OS" },
  { value: "Windows", label: "Windows" },
  { value: "Linux", label: "Linux" },
  { value: "macOS", label: "macOS" },
];

const STATUS_OPTIONS: Array<{
  value: "all" | ConnectionStatus;
  label: string;
}> = [
  { value: "all", label: "All Status" },
  { value: "online", label: "Online" },
  { value: "warning", label: "Warning" },
  { value: "offline", label: "Offline" },
];

const RISK_OPTIONS: Array<{ value: "all" | RiskLevel; label: string }> = [
  { value: "all", label: "All Risk" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

const MIN = 60_000;

/** Derive connection status from last-seen recency: ≤1min online, ≤2min warning, else offline. */
function connectionStatus(
  lastSeen: number,
  now = Date.now(),
): ConnectionStatus {
  const diff = now - lastSeen;
  if (diff <= MIN) return "online";
  if (diff <= 2 * MIN) return "warning";
  return "offline";
}

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  online: "Online",
  warning: "Warning",
  offline: "Offline",
};

const COLUMNS: Array<{ key: SortKey; label: string; sortable: boolean }> = [
  { key: "hostname", label: "Hostname", sortable: true },
  { key: "status", label: "Status", sortable: true },
  { key: "last_seen", label: "Last Seen", sortable: true },
  { key: "cpu_percent", label: "CPU", sortable: true },
  { key: "memory_percent", label: "Memory", sortable: true },
  { key: "disk_percent", label: "Disk", sortable: true },
  { key: "health_score", label: "Health", sortable: true },
  { key: "risk", label: "Risk", sortable: true },
];

function sortValue(e: EndpointStatus, key: SortKey): string | number {
  switch (key) {
    case "hostname":
      return e.hostname;
    case "status":
      return connectionStatus(e.last_seen);
    case "last_seen":
      return e.last_seen;
    case "cpu_percent":
      return e.cpu_percent;
    case "memory_percent":
      return e.memory_percent;
    case "disk_percent":
      return e.disk_percent;
    case "health_score":
      return e.health_score;
    case "risk":
      return e.audit.riskScore;
  }
}

function MetricCell({ value }: { value: number }) {
  const normalizedValue = Math.min(100, Math.max(0, value ?? 0));

  return (
    <div className="flex min-w-[7rem] items-center gap-2">
      <div
        role="progressbar"
        aria-valuenow={Math.round(normalizedValue)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${Math.round(normalizedValue)}% utilization`}
        tabIndex={0}
        className="h-2 w-16 overflow-hidden rounded-full bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div
          className={cn("h-full rounded-full", utilizationBarColor(normalizedValue))}
          style={{ width: `${normalizedValue}%` }}
        />
      </div>
      <span className="w-9 shrink-0 text-right font-mono text-xs text-muted-foreground">
        {formatPercent(normalizedValue)}
      </span>
    </div>
  );
}

function SortHeader({
  column,
  sortKey,
  sortDir,
  onSort,
}: {
  column: (typeof COLUMNS)[number];
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const isActive = sortKey === column.key;
  const Icon = !column.sortable
    ? null
    : isActive
      ? sortDir === "asc"
        ? ArrowUp
        : ArrowDown
      : ArrowUpDown;
  return (
    <TableHead className="whitespace-nowrap">
      {column.sortable ? (
        <button
          type="button"
          onClick={() => onSort(column.key)}
          aria-label={`Sort by ${column.label}${isActive ? `, currently ${sortDir === "asc" ? "ascending" : "descending"}` : ""}`}
          className="inline-flex items-center gap-1 rounded font-medium text-foreground outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
          data-ocid={`live_status.sort_${column.key}`}
        >
          {column.label}
          {Icon && <Icon className="size-3.5" aria-hidden="true" />}
        </button>
      ) : (
        column.label
      )}
    </TableHead>
  );
}

export default function LiveStatusPage() {
  const navigate = useNavigate();
  const { endpoints, isRefreshing, lastRefreshed, refresh } = useEndpoints();

  const [osFilter, setOsFilter] = useState<"all" | OS>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | ConnectionStatus>(
    "all",
  );
  const [riskFilter, setRiskFilter] = useState<"all" | RiskLevel>("all");
  const [sortKey, setSortKey] = useState<SortKey>("hostname");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [pageSize, setPageSize] = useState<number>(25);
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const now = Date.now();
    const list = endpoints.filter((e) => {
      if (osFilter !== "all" && e.os !== osFilter) return false;
      if (
        statusFilter !== "all" &&
        connectionStatus(e.last_seen, now) !== statusFilter
      )
        return false;
      if (riskFilter !== "all" && e.audit.riskLevel !== riskFilter)
        return false;
      return true;
    });

    const dir = sortDir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      if (typeof av === "string" && typeof bv === "string") {
        return av.localeCompare(bv) * dir;
      }
      return ((av as number) - (bv as number)) * dir;
    });
  }, [endpoints, osFilter, statusFilter, riskFilter, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize,
  );

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const handlePageSize = (value: string) => {
    setPageSize(Number(value));
    setPage(1);
  };

  const handleRefresh = (_mac: string) => {
    refresh();
  };

  const goToDetail = (mac: string) => {
    void navigate({ to: "/endpoints/$mac", params: { mac } });
  };

  const goToCompare = (mac: string) => {
    void navigate({ to: "/compare", search: { mac: [mac] } });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
          Live Status
        </h2>
        <p className="text-sm text-muted-foreground">
          Real-time endpoint health, metrics, and connectivity.
        </p>
      </div>

      {/* Auto-refresh indicator */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground shadow-subtle"
          data-ocid="live_status.refresh_indicator"
        >
          <RefreshCw
            className={cn(
              "size-3.5",
              isRefreshing && "animate-spin text-primary",
            )}
            aria-hidden="true"
          />
          <span>
            {isRefreshing
              ? "Refreshing…"
              : `Last refreshed ${timeAgo(lastRefreshed)}`}
          </span>
          <span className="sr-only">
            {isRefreshing
              ? "Data is refreshing"
              : "Auto-refreshes every 10 seconds"}
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={refresh}
          disabled={isRefreshing}
          data-ocid="live_status.refresh_button"
        >
          <RefreshCw
            className={cn("size-4", isRefreshing && "animate-spin")}
            aria-hidden="true"
          />
          Refresh now
        </Button>
      </div>

      {/* Filter bar */}
      <Card className="shadow-subtle">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <Select
              value={osFilter}
              onValueChange={(v) => {
                setOsFilter(v as "all" | OS);
                setPage(1);
              }}
            >
              <SelectTrigger
                className="w-40"
                aria-label="Filter by operating system"
                data-ocid="live_status.filter_os"
              >
                <SelectValue placeholder="All OS" />
              </SelectTrigger>
              <SelectContent>
                {OS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={statusFilter}
              onValueChange={(v) => {
                setStatusFilter(v as "all" | ConnectionStatus);
                setPage(1);
              }}
            >
              <SelectTrigger
                className="w-40"
                aria-label="Filter by connection status"
                data-ocid="live_status.filter_status"
              >
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={riskFilter}
              onValueChange={(v) => {
                setRiskFilter(v as "all" | RiskLevel);
                setPage(1);
              }}
            >
              <SelectTrigger
                className="w-40"
                aria-label="Filter by risk level"
                data-ocid="live_status.filter_risk"
              >
                <SelectValue placeholder="All Risk" />
              </SelectTrigger>
              <SelectContent>
                {RISK_OPTIONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <span className="ml-auto text-sm text-muted-foreground">
              {filtered.length} of {endpoints.length} endpoints
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="shadow-subtle">
        <CardHeader className="flex flex-row items-center justify-between gap-3 border-b border-border px-4 py-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Columns3 className="size-4 text-primary" aria-hidden="true" />
            Endpoint Fleet
          </CardTitle>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Rows per page</span>
            <Select value={String(pageSize)} onValueChange={handlePageSize}>
              <SelectTrigger
                className="h-8 w-20"
                aria-label="Rows per page"
                data-ocid="live_status.page_size"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZES.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  {COLUMNS.map((c) => (
                    <SortHeader
                      key={c.key}
                      column={c}
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onSort={handleSort}
                    />
                  ))}
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.map((e, i) => {
                  const status = connectionStatus(e.last_seen);
                  const rowIndex = (safePage - 1) * pageSize + i;
                  return (
                    <TableRow
                      key={e.mac_address}
                      className="cursor-pointer transition-colors hover:bg-accent/40"
                      onClick={() => goToDetail(e.mac_address)}
                      onKeyDown={(ev) => {
                        if (ev.key === "Enter" || ev.key === " ") {
                          ev.preventDefault();
                          goToDetail(e.mac_address);
                        }
                      }}
                      tabIndex={0}
                      aria-label={`View details for ${e.hostname}`}
                      data-ocid={`live_status.row.${rowIndex}`}
                    >
                      <TableCell>
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate font-mono text-sm font-semibold text-foreground">
                            {e.hostname}
                          </span>
                          <span className="truncate font-mono text-xs text-muted-foreground">
                            {e.ip_address}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={cn(
                            "gap-1.5 rounded-full border-transparent",
                            connectionStatusBg(status),
                          )}
                        >
                          <span
                            className={cn(
                              "size-1.5 rounded-full",
                              connectionStatusColor(status),
                            )}
                            aria-hidden="true"
                          />
                          {STATUS_LABEL[status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                        {timeAgo(e.last_seen)}
                      </TableCell>
                      <TableCell>
                        <MetricCell value={e.cpu_percent} />
                      </TableCell>
                      <TableCell>
                        <MetricCell value={e.memory_percent} />
                      </TableCell>
                      <TableCell>
                        <MetricCell value={e.disk_percent} />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Badge
                            className={cn(
                              "rounded-full border-transparent",
                              healthStatusBg(e.health_status),
                            )}
                          >
                            {e.health_score}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={cn(
                            "rounded-full border-transparent",
                            riskScoreBg(e.audit.riskScore),
                          )}
                        >
                          {e.audit.riskScore}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div
                          className="flex items-center justify-end gap-1"
                          onClick={(ev) => ev.stopPropagation()}
                          onKeyDown={(ev) => ev.stopPropagation()}
                        >
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label={`Refresh ${e.hostname}`}
                                  onClick={() => handleRefresh(e.mac_address)}
                                  data-ocid={`live_status.refresh_row.${rowIndex}`}
                                >
                                  <RefreshCw
                                    className="size-4"
                                    aria-hidden="true"
                                  />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Manual refresh</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label={`Add ${e.hostname} to compare`}
                                  onClick={() => goToCompare(e.mac_address)}
                                  data-ocid={`live_status.compare_row.${rowIndex}`}
                                >
                                  <Columns3
                                    className="size-4"
                                    aria-hidden="true"
                                  />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Add to compare</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {pageRows.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={COLUMNS.length + 1}
                      className="h-40 text-center"
                    >
                      <div
                        className="flex flex-col items-center gap-2"
                        data-ocid="live_status.empty_state"
                      >
                        <p className="text-sm font-medium text-foreground">
                          No endpoints match your filters
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Try adjusting the OS, status, or risk filters.
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          <div className="flex flex-col items-center justify-between gap-3 border-t border-border px-4 py-3 sm:flex-row">
            <p className="text-sm text-muted-foreground">
              Showing{" "}
              <span className="font-medium text-foreground">
                {filtered.length === 0 ? 0 : (safePage - 1) * pageSize + 1}–
                {Math.min(safePage * pageSize, filtered.length)}
              </span>{" "}
              of{" "}
              <span className="font-medium text-foreground">
                {filtered.length}
              </span>{" "}
              endpoints
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage <= 1}
                data-ocid="live_status.pagination_prev"
              >
                Previous
              </Button>
              <span className="px-3 text-sm text-muted-foreground">
                Page{" "}
                <span className="font-medium text-foreground">{safePage}</span>{" "}
                of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage >= totalPages}
                data-ocid="live_status.pagination_next"
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
