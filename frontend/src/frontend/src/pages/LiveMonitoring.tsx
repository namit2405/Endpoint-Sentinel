import { MetricsChart } from "@/components/MetricsChart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  type LiveAlert,
  type MetricKey,
  type TrendPoint,
  useLiveMetrics,
} from "@/hooks/useLiveMetrics";
import {
  connectionStatusBg,
  connectionStatusColor,
  formatPercent,
  timeAgo,
} from "@/lib/format";
import type { ConnectionStatus, EndpointStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Cpu,
  HardDrive,
  MemoryStick,
  MonitorCheck,
  RefreshCw,
  Server,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Line,
  LineChart,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

const MIN = 60_000;

const METRIC_LABEL: Record<MetricKey, string> = {
  cpu: "CPU",
  memory: "Memory",
  disk: "Disk",
};

const METRIC_ICON: Record<MetricKey, React.ReactNode> = {
  cpu: <Cpu className="size-5" aria-hidden="true" />,
  memory: <MemoryStick className="size-5" aria-hidden="true" />,
  disk: <HardDrive className="size-5" aria-hidden="true" />,
};

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

function kpiColor(value: number): string {
  if (value < 70) return "text-success";
  if (value <= 85) return "text-warning";
  return "text-destructive";
}

function kpiDot(value: number): string {
  if (value < 70) return "bg-success";
  if (value <= 85) return "bg-warning";
  return "bg-destructive";
}

function Sparkline({ data, color }: { data: TrendPoint[]; color: string }) {
  return (
    <div className="h-12 w-full" aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 2, right: 0, left: 0, bottom: 0 }}
        >
          <defs>
            <linearGradient id={`spark-${color}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            fill={`url(#spark-${color})`}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function KpiCard({
  label,
  value,
  unit,
  icon,
  trend,
  ocid,
}: {
  label: string;
  value: number;
  unit?: string;
  icon: React.ReactNode;
  trend: TrendPoint[];
  ocid: string;
}) {
  const color = unit ? kpiColor(value) : "text-success";
  const dot = unit ? kpiDot(value) : "bg-success";
  const chartColor = unit
    ? value < 70
      ? "oklch(var(--success))"
      : value <= 85
        ? "oklch(var(--warning))"
        : "oklch(var(--destructive))"
    : "oklch(var(--success))";

  return (
    <Card data-ocid={ocid} className="gap-3 py-5">
      <CardContent className="px-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-muted-foreground">{label}</p>
            <p
              className={cn(
                "mt-1 font-display text-3xl font-bold tracking-tight",
                color,
              )}
            >
              {value}
              {unit && <span className="text-lg">{unit}</span>}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <span
              className={cn("size-2.5 rounded-full", dot)}
              aria-hidden="true"
            />
            <span className="flex size-9 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              {icon}
            </span>
          </div>
        </div>
        <div className="mt-3">
          <Sparkline data={trend} color={chartColor} />
        </div>
      </CardContent>
    </Card>
  );
}

function KpiSkeleton() {
  return (
    <Card className="gap-3 py-5">
      <CardContent className="px-5">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-2 h-8 w-16" />
        <Skeleton className="mt-4 h-12 w-full" />
      </CardContent>
    </Card>
  );
}

type SortKey = "hostname" | "cpu" | "memory" | "disk";
type SortDir = "asc" | "desc";

const SORT_COLUMNS: Array<{ key: SortKey; label: string }> = [
  { key: "hostname", label: "Hostname" },
  { key: "cpu", label: "CPU" },
  { key: "memory", label: "Memory" },
  { key: "disk", label: "Disk" },
];

function sortValue(e: EndpointStatus, key: SortKey): string | number {
  switch (key) {
    case "hostname":
      return e.hostname;
    case "cpu":
      return e.cpu_percent;
    case "memory":
      return e.memory_percent;
    case "disk":
      return e.disk_percent;
  }
}

function SortHeader({
  column,
  sortKey,
  sortDir,
  onSort,
}: {
  column: (typeof SORT_COLUMNS)[number];
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const isActive = sortKey === column.key;
  const Icon = isActive
    ? sortDir === "asc"
      ? ArrowUp
      : ArrowDown
    : ArrowUpDown;
  return (
    <TableHead className="whitespace-nowrap">
      <button
        type="button"
        onClick={() => onSort(column.key)}
        aria-label={`Sort by ${column.label}${isActive ? `, currently ${sortDir === "asc" ? "ascending" : "descending"}` : ""}`}
        className="inline-flex items-center gap-1 rounded font-medium text-foreground outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
        data-ocid={`live_monitoring.sort_${column.key}`}
      >
        {column.label}
        <Icon className="size-3.5" aria-hidden="true" />
      </button>
    </TableHead>
  );
}

function MetricCell({ value }: { value: number }) {
  const normalizedValue = Math.min(100, Math.max(0, value ?? 0));

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 font-mono text-xs font-semibold",
        normalizedValue < 70
          ? "bg-success/15 text-success"
          : normalizedValue <= 85
            ? "bg-warning/15 text-warning"
            : "bg-destructive/15 text-destructive",
      )}
    >
      {formatPercent(normalizedValue)}
    </span>
  );
}

function AlertBanner({ alerts }: { alerts: LiveAlert[] }) {
  const navigate = useNavigate();
  if (alerts.length === 0) return null;

  return (
    <section
      aria-label="Active threshold alerts"
      data-ocid="live_monitoring.alerts"
      className="rounded-xl border border-destructive/40 bg-destructive/10 p-4"
    >
      <div className="flex items-center gap-2">
        <AlertTriangle className="size-5 text-destructive" aria-hidden="true" />
        <h2 className="font-display text-sm font-bold text-destructive">
          {alerts.length} active alert{alerts.length > 1 ? "s" : ""}
        </h2>
      </div>
      <ul className="mt-3 flex flex-wrap gap-2">
        {alerts.map((alert, i) => (
          <li key={alert.id}>
            <button
              type="button"
              onClick={() =>
                void navigate({
                  to: "/endpoints/$mac",
                  params: { mac: alert.mac },
                })
              }
              data-ocid={`live_monitoring.alert.${i + 1}`}
              className="inline-flex items-center gap-2 rounded-lg border border-destructive/30 bg-card px-3 py-2 text-left text-sm text-foreground shadow-subtle transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                className="size-2 shrink-0 rounded-full bg-destructive"
                aria-hidden="true"
              />
              <span className="font-mono font-semibold text-destructive">
                {alert.hostname}
              </span>
              <span className="text-muted-foreground">
                {METRIC_LABEL[alert.metric]} {formatPercent(alert.value)} &gt;{" "}
                {formatPercent(alert.threshold)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function LiveMonitoring() {
  const navigate = useNavigate();
  const {
    endpoints,
    averages,
    onlineCount,
    top5,
    history60,
    trend24,
    onlineTrend,
    alerts,
    isRefreshing,
    lastRefreshed,
    refresh,
    error,
    retry,
  } = useLiveMetrics();

  const [sortKey, setSortKey] = useState<SortKey>("hostname");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const loading = endpoints.length === 0;

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...endpoints].sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      if (typeof av === "string" && typeof bv === "string") {
        return av.localeCompare(bv) * dir;
      }
      return ((av as number) - (bv as number)) * dir;
    });
  }, [endpoints, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const goToDetail = (mac: string) => {
    void navigate({ to: "/endpoints/$mac", params: { mac } });
  };

  const kpis = [
    {
      label: "Avg CPU",
      value: averages.cpu,
      unit: "%",
      icon: METRIC_ICON.cpu,
      trend: trend24.cpu,
      ocid: "live_monitoring.kpi.cpu",
    },
    {
      label: "Avg Memory",
      value: averages.memory,
      unit: "%",
      icon: METRIC_ICON.memory,
      trend: trend24.memory,
      ocid: "live_monitoring.kpi.memory",
    },
    {
      label: "Avg Disk",
      value: averages.disk,
      unit: "%",
      icon: METRIC_ICON.disk,
      trend: trend24.disk,
      ocid: "live_monitoring.kpi.disk",
    },
    {
      label: "Online Endpoints",
      value: onlineCount,
      icon: <Server className="size-5" aria-hidden="true" />,
      trend: onlineTrend,
      ocid: "live_monitoring.kpi.online",
    },
  ];

  const charts = [
    {
      title: "CPU Usage",
      metric: "cpu" as MetricKey,
      ocid: "live_monitoring.chart.cpu",
    },
    {
      title: "Memory Usage",
      metric: "memory" as MetricKey,
      ocid: "live_monitoring.chart.memory",
    },
    {
      title: "Disk Usage",
      metric: "disk" as MetricKey,
      ocid: "live_monitoring.chart.disk",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Refresh indicator */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground shadow-subtle"
          data-ocid="live_monitoring.refresh_indicator"
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
          <span className="sr-only">Auto-refreshes every 10 seconds</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={refresh}
          disabled={isRefreshing}
          data-ocid="live_monitoring.refresh_button"
        >
          <RefreshCw
            className={cn("size-4", isRefreshing && "animate-spin")}
            aria-hidden="true"
          />
          Refresh now
        </Button>
      </div>

      {/* Error state */}
      {error && (
        <section
          aria-label="Live monitoring error"
          data-ocid="live_monitoring.error"
          className="rounded-xl border border-destructive/40 bg-destructive/10 p-6"
        >
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-destructive/15 text-destructive">
                <AlertTriangle className="size-5" aria-hidden="true" />
              </span>
              <div>
                <h2 className="font-display text-base font-bold text-foreground">
                  Unable to load live metrics
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">{error}</p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={retry}
              disabled={isRefreshing}
              data-ocid="live_monitoring.retry_button"
            >
              <RefreshCw
                className={cn("size-4", isRefreshing && "animate-spin")}
                aria-hidden="true"
              />
              Retry
            </Button>
          </div>
        </section>
      )}

      {/* KPI cards */}
      <section aria-label="Live metrics summary">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {loading
            ? ["kpi-1", "kpi-2", "kpi-3", "kpi-4"].map((k) => (
                <KpiSkeleton key={k} />
              ))
            : kpis.map((kpi) => (
                <KpiCard
                  key={kpi.label}
                  label={kpi.label}
                  value={kpi.value}
                  unit={kpi.unit}
                  icon={kpi.icon}
                  trend={kpi.trend}
                  ocid={kpi.ocid}
                />
              ))}
        </div>
      </section>

      {/* Alert banner */}
      {!loading && <AlertBanner alerts={alerts} />}

      {/* Metrics charts */}
      <section aria-label="Real-time metrics charts">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {charts.map((chart) => (
            <Card
              key={chart.metric}
              data-ocid={chart.ocid}
              className="shadow-subtle"
            >
              <CardHeader className="px-5 pt-5">
                <CardTitle className="flex items-center gap-2 font-display text-base font-bold tracking-tight">
                  {METRIC_ICON[chart.metric]}
                  {chart.title}
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  Top 5 endpoints · last 60 minutes
                </p>
              </CardHeader>
              <CardContent className="px-5 pb-5">
                {loading ? (
                  <Skeleton className="h-64 w-full" />
                ) : (
                  <MetricsChart
                    title={chart.title}
                    data={history60[chart.metric]}
                    endpoints={top5[chart.metric]}
                  />
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Status table */}
      <section aria-label="Endpoint status table">
        <Card className="shadow-subtle">
          <CardHeader className="flex flex-row items-center justify-between gap-3 border-b border-border px-4 py-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <MonitorCheck
                className="size-4 text-primary"
                aria-hidden="true"
              />
              Endpoint Status
            </CardTitle>
            <span className="text-sm text-muted-foreground">
              {endpoints.length} endpoints
            </span>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    {SORT_COLUMNS.map((c) => (
                      <SortHeader
                        key={c.key}
                        column={c}
                        sortKey={sortKey}
                        sortDir={sortDir}
                        onSort={handleSort}
                      />
                    ))}
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Last Updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading
                    ? Array.from({ length: 6 }, (_, i) => `skeleton-${i}`).map(
                        (id) => (
                          <TableRow key={id}>
                            <TableCell colSpan={6}>
                              <Skeleton className="h-8 w-full" />
                            </TableCell>
                          </TableRow>
                        ),
                      )
                    : sorted.map((e, i) => {
                        const status = connectionStatus(e.last_seen);
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
                            data-ocid={`live_monitoring.row.${i + 1}`}
                          >
                            <TableCell>
                              <span className="font-mono text-sm font-semibold text-foreground">
                                {e.hostname}
                              </span>
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
                            <TableCell className="whitespace-nowrap text-right font-mono text-xs text-muted-foreground">
                              {timeAgo(e.last_seen)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </section>

      <p className="text-xs text-muted-foreground" aria-live="polite">
        {isRefreshing
          ? "Refreshing live metrics…"
          : `Last refreshed ${timeAgo(lastRefreshed)}`}
      </p>
    </div>
  );
}
