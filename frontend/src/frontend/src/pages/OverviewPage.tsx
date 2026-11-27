import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getDashboardSummary,
  getHealthTrend,
  getOSDistribution,
  getQuickAlerts,
} from "@/lib/endpoints";
import {
  connectionStatusBg,
  healthStatusBg,
  securityHealthScoreColor,
  timeAgo,
} from "@/lib/format";
import type {
  ConnectionStatus,
  HealthStatus,
  OS,
  QuickAlert,
} from "@/lib/types";
import { useEndpoints } from "@/lib/useEndpoints";
import { Link } from "@tanstack/react-router";
import {
  Activity,
  CheckCircle2,
  CircleOff,
  Monitor,
  Server,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  Pie,
  PieChart,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

const OS_COLORS: Record<OS, string> = {
  Windows: "oklch(var(--chart-1))",
  Linux: "oklch(var(--chart-2))",
  macOS: "oklch(var(--chart-3))",
};

const OS_ICONS: Record<OS, string> = {
  Windows: "Win",
  Linux: "Lin",
  macOS: "mac",
};

function KpiCard({
  label,
  value,
  icon,
  iconClass,
  valueClass,
  hint,
  ocid,
  to,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  iconClass: string;
  valueClass: string;
  hint: string;
  ocid: string;
  to: "/live" | "/inventory";
}) {
  return (
    <Link
      to={to}
      aria-label={`${label}: ${value}. ${hint}`}
      className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <Card
        data-ocid={ocid}
        className="gap-3 py-5 transition-colors hover:bg-accent/40"
      >
        <CardContent className="flex items-start justify-between gap-3 px-5">
          <div className="min-w-0">
            <p className="text-sm font-medium text-muted-foreground">{label}</p>
            <p
              className={`mt-1 font-display text-3xl font-bold tracking-tight ${valueClass}`}
            >
              {value}
            </p>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {hint}
            </p>
          </div>
          <div
            className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${iconClass}`}
            aria-hidden="true"
          >
            {icon}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function KpiSkeleton() {
  return (
    <Card className="gap-3 py-5">
      <CardContent className="flex items-start justify-between gap-3 px-5">
        <div className="w-full space-y-2">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-8 w-14" />
          <Skeleton className="h-3 w-24" />
        </div>
        <Skeleton className="size-11 shrink-0 rounded-xl" />
      </CardContent>
    </Card>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
  ocid,
  className,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  ocid: string;
  className?: string;
}) {
  return (
    <Card data-ocid={ocid} className={className}>
      <CardHeader className="px-5 pt-5">
        <CardTitle className="font-display text-base font-bold tracking-tight">
          {title}
        </CardTitle>
        {subtitle && (
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        )}
      </CardHeader>
      <CardContent className="px-5 pb-5">{children}</CardContent>
    </Card>
  );
}

export default function OverviewPage() {
  const { endpoints, summary, isRefreshing, lastRefreshed, hasLoaded } =
    useEndpoints();
  const [selectedAlert, setSelectedAlert] = useState<QuickAlert | null>(null);

  const healthTrend = useMemo(() => getHealthTrend(endpoints), [endpoints]);
  const osDistribution = useMemo(
    () => getOSDistribution(endpoints),
    [endpoints],
  );
  const quickAlerts = useMemo(() => getQuickAlerts(endpoints), [endpoints]);

  const topRisky = useMemo(
    () =>
      [...endpoints]
        .sort((a, b) => b.audit.riskScore - a.audit.riskScore)
        .slice(0, 5)
        .map((e) => ({
          hostname: e.hostname,
          riskScore: e.audit.riskScore,
        })),
    [endpoints],
  );

  const osTotal = osDistribution.reduce((sum, d) => sum + d.count, 0);

  const connectionKpis: {
    label: string;
    value: number;
    status: ConnectionStatus;
    icon: React.ReactNode;
    hint: string;
    ocid: string;
  }[] = [
    {
      label: "Total Endpoints",
      value: summary.total,
      status: "online",
      icon: <Server className="size-5" />,
      hint: "Monitored fleet",
      ocid: "overview.kpi.total",
    },
    {
      label: "Online",
      value: summary.online,
      status: "online",
      icon: <Activity className="size-5" />,
      hint: "Reporting normally",
      ocid: "overview.kpi.online",
    },
    {
      label: "Offline",
      value: summary.offline,
      status: "offline",
      icon: <CircleOff className="size-5" />,
      hint: "Need Attention",
      ocid: "overview.kpi.offline",
    },
  ];

  const riskKpis: {
    label: string;
    value: number;
    health: HealthStatus;
    icon: React.ReactNode;
    hint: string;
    ocid: string;
  }[] = [
    {
      label: "Healthy",
      value: summary.healthy,
      health: "healthy",
      icon: <ShieldCheck className="size-5" />,
      hint: "Low risk posture",
      ocid: "overview.risk.healthy",
    },
    {
      label: "Unhealthy",
      value: summary.atRisk,
      health: "warning",
      icon: <ShieldAlert className="size-5" />,
      hint: "Elevated risk",
      ocid: "overview.risk.warning",
    },
    {
      label: "Critical",
      value: summary.critical,
      health: "critical",
      icon: <ShieldX className="size-5" />,
      hint: "High risk posture",
      ocid: "overview.risk.critical",
    },
  ];

  const loading = !hasLoaded;

  return (
    <div className="space-y-6">
      {/* Connection KPI row */}
      <section aria-label="Endpoint connection summary">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {loading
            ? ["kpi-1", "kpi-2", "kpi-3"].map((k) => <KpiSkeleton key={k} />)
            : connectionKpis.map((kpi) => (
                <KpiCard
                  key={kpi.label}
                  label={kpi.label}
                  value={kpi.value}
                  icon={kpi.icon}
                  iconClass={connectionStatusBg(kpi.status)}
                  valueClass={connectionStatusBg(kpi.status).split(" ")[1]}
                  hint={kpi.hint}
                  ocid={kpi.ocid}
                  to="/live"
                />
              ))}
        </div>
      </section>

      {/* Risk KPI row */}
      <section aria-label="Risk posture summary">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {loading
            ? ["risk-1", "risk-2", "risk-3"].map((k) => <KpiSkeleton key={k} />)
            : riskKpis.map((kpi) => (
                <KpiCard
                  key={kpi.label}
                  label={kpi.label}
                  value={kpi.value}
                  icon={kpi.icon}
                  iconClass={healthStatusBg(kpi.health)}
                  valueClass={healthStatusBg(kpi.health).split(" ")[1]}
                  hint={kpi.hint}
                  ocid={kpi.ocid}
                  to="/inventory"
                />
              ))}
        </div>
      </section>

      {/* Charts row */}
      <section aria-label="Health and OS distribution charts">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <ChartCard
            title="Endpoint Health Analytics"
            subtitle="Average health score · last 7 days"
            ocid="overview.health_trend"
            className="lg:col-span-2"
          >
            {loading ? (
              <Skeleton className="h-64 w-full" />
            ) : (
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={healthTrend}
                    margin={{ top: 8, right: 8, left: -18, bottom: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="oklch(var(--border))"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="date"
                      tickLine={false}
                      axisLine={false}
                      tick={{
                        fill: "oklch(var(--muted-foreground))",
                        fontSize: 12,
                      }}
                      dy={6}
                    />
                    <YAxis
                      domain={[0, 100]}
                      tickLine={false}
                      axisLine={false}
                      tick={{
                        fill: "oklch(var(--muted-foreground))",
                        fontSize: 12,
                      }}
                    />
                    <RechartsTooltip
                      cursor={{ stroke: "oklch(var(--border))" }}
                      contentStyle={{
                        borderRadius: 12,
                        border: "1px solid oklch(var(--border))",
                        background: "oklch(var(--card))",
                        fontSize: 12,
                      }}
                      formatter={(value: number) => [
                        `${value} / 100`,
                        "Avg score",
                      ]}
                    />
                    <Line
                      type="monotone"
                      dataKey="score"
                      stroke="oklch(var(--primary))"
                      strokeWidth={2.5}
                      dot={{
                        r: 3,
                        fill: "oklch(var(--primary))",
                        strokeWidth: 0,
                      }}
                      activeDot={{ r: 5 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </ChartCard>

          <ChartCard
            title="OS Distribution"
            subtitle="Fleet by operating system"
            ocid="overview.os_distribution"
          >
            {loading ? (
              <Skeleton className="h-64 w-full" />
            ) : (
              <div className="flex h-64 flex-col items-center">
                <div className="relative h-40 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={osDistribution}
                        dataKey="count"
                        nameKey="os"
                        innerRadius={52}
                        outerRadius={72}
                        paddingAngle={3}
                        strokeWidth={0}
                      >
                        {osDistribution.map((entry) => (
                          <Cell key={entry.os} fill={OS_COLORS[entry.os]} />
                        ))}
                      </Pie>
                      <RechartsTooltip
                        contentStyle={{
                          borderRadius: 12,
                          border: "1px solid oklch(var(--border))",
                          background: "oklch(var(--card))",
                          fontSize: 12,
                        }}
                        formatter={(value: number, name: string) => [
                          `${value} endpoints`,
                          name,
                        ]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="font-display text-2xl font-bold text-foreground">
                      {osTotal}
                    </span>
                    <span className="text-xs text-muted-foreground">total</span>
                  </div>
                </div>
                <ul className="mt-3 w-full space-y-1.5">
                  {osDistribution.map((d) => (
                    <li
                      key={d.os}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className="inline-flex size-5 items-center justify-center rounded-md text-[10px] font-bold text-white"
                          style={{ background: OS_COLORS[d.os] }}
                          aria-hidden="true"
                        >
                          {OS_ICONS[d.os]}
                        </span>
                        <span className="text-foreground">{d.os}</span>
                      </span>
                      <span className="font-mono text-muted-foreground">
                        {d.count}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </ChartCard>
        </div>
      </section>

      {/* Top risky + alerts row */}
      <section aria-label="Risk and alerts">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <ChartCard
            title="Endpoint Security Posture"
            ocid="overview.top_risky"
            className="lg:col-span-2"
          >
            {loading ? (
              <Skeleton className="h-64 w-full" />
            ) : (
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={topRisky}
                    layout="vertical"
                    margin={{ top: 4, right: 36, left: 8, bottom: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="oklch(var(--border))"
                      horizontal={false}
                    />
                    <XAxis
                      type="number"
                      domain={[0, 100]}
                      tickLine={false}
                      axisLine={false}
                      tick={{
                        fill: "oklch(var(--muted-foreground))",
                        fontSize: 12,
                      }}
                    />
                    <YAxis
                      type="category"
                      dataKey="hostname"
                      width={110}
                      tickLine={false}
                      axisLine={false}
                      tick={{
                        fill: "oklch(var(--muted-foreground))",
                        fontSize: 12,
                        fontFamily: "var(--font-mono)",
                      }}
                    />
                    <RechartsTooltip
                      cursor={{ fill: "oklch(var(--muted) / 0.4)" }}
                      contentStyle={{
                        borderRadius: 12,
                        border: "1px solid oklch(var(--border))",
                        background: "oklch(var(--card))",
                        fontSize: 12,
                      }}
                      formatter={(value: number) => [
                        `${value} / 100`,
                        "Security Health",
                      ]}
                    />
                    <Bar dataKey="riskScore" radius={[0, 6, 6, 0]} barSize={18}>
                      {topRisky.map((entry) => (
                        <Cell
                          key={entry.hostname}
                          fill={securityHealthScoreColor(entry.riskScore)
                            .replace("text-", "oklch(var(--")
                            .concat("))")}
                        />
                      ))}
                      <LabelList
                        dataKey="riskScore"
                        position="right"
                        formatter={(v: number) => `${v}`}
                        style={{
                          fill: "oklch(var(--muted-foreground))",
                          fontSize: 12,
                          fontFamily: "var(--font-mono)",
                        }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </ChartCard>

          <ChartCard
            title="Quick Alerts"
            subtitle="Recent critical findings"
            ocid="overview.quick_alerts"
          >
            {loading ? (
              <div className="space-y-3">
                {["alert-1", "alert-2", "alert-3", "alert-4"].map((k) => (
                  <Skeleton key={k} className="h-14 w-full" />
                ))}
              </div>
            ) : quickAlerts.length === 0 ? (
              <div className="flex h-40 flex-col items-center justify-center gap-2 text-center">
                <CheckCircle2
                  className="size-8 text-success"
                  aria-hidden="true"
                />
                <p className="text-sm font-medium text-foreground">
                  No critical alerts
                </p>
                <p className="text-xs text-muted-foreground">
                  All endpoints are reporting within normal thresholds.
                </p>
              </div>
            ) : (
              <ul className="space-y-3">
                {quickAlerts.map((alert, i) => (
                  <li key={alert.id}>
                    <Button
                      type="button"
                      variant="ghost"
                      data-ocid={`overview.alert.${i + 1}`}
                      onClick={() => setSelectedAlert(alert)}
                      className="h-auto w-full items-start justify-start gap-3 rounded-lg border border-border bg-background/60 p-3 text-left whitespace-normal hover:bg-muted/50"
                    >
                      <span
                        className={`mt-0.5 size-2 shrink-0 rounded-full ${
                          alert.severity === "critical"
                            ? "bg-destructive"
                            : "bg-warning"
                        }`}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">
                          {alert.title}
                        </span>
                        <span className="block truncate font-mono text-xs text-muted-foreground">
                          {alert.hostname}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <Badge
                          variant={
                            alert.severity === "critical"
                              ? "destructive"
                              : "secondary"
                          }
                          className={
                            alert.severity === "critical"
                              ? "bg-destructive/15 text-destructive"
                              : "bg-warning/15 text-warning"
                          }
                        >
                          {alert.severity}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">
                          {timeAgo(alert.timestamp, lastRefreshed)}
                        </span>
                      </span>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </ChartCard>
        </div>
      </section>

      <Dialog
        open={selectedAlert !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedAlert(null);
        }}
      >
        {selectedAlert && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{selectedAlert.title}</DialogTitle>
              <DialogDescription>{selectedAlert.description}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 rounded-lg border border-border bg-muted/30 p-4 text-sm">
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">Endpoint</span>
                <span className="font-mono font-medium text-foreground">
                  {selectedAlert.hostname}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">Severity</span>
                <Badge
                  className={
                    selectedAlert.severity === "critical"
                      ? "bg-destructive/15 text-destructive"
                      : "bg-warning/15 text-warning"
                  }
                >
                  {selectedAlert.severity}
                </Badge>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">Detected</span>
                <span className="text-foreground">
                  {timeAgo(selectedAlert.timestamp, lastRefreshed)}
                </span>
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>

      <p className="text-xs text-muted-foreground" aria-live="polite">
        {isRefreshing
          ? "Refreshing fleet data…"
          : `Last refreshed ${timeAgo(lastRefreshed)}`}
      </p>
    </div>
  );
}
