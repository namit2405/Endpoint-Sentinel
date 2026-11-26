import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatPercent,
  formatUptime,
  riskScoreBg,
  timeAgo,
  utilizationBarColor,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  EndpointStatus,
  OS,
  RiskFinding,
  SecurityControls,
  SecurityProduct,
  DiskDetail,
  ServiceInfo,
  PortInfo,
  SoftwareInfo,
  UserInfo,
  TaskInfo,
  PatchInfo,
  ProcessInfo,
} from "@/lib/types";
import { useEndpoints } from "@/lib/useEndpoints";
import { apiClient } from "@/lib/api-client";
import { useParams } from "@tanstack/react-router";
import {
  Cpu,
  ChevronDown,
  ChevronUp,
  Download,
  FileText,
  HardDrive,
  MonitorCog,
  Network,
  RefreshCw,
  Server,
  ShieldCheck,
  ShieldX,
  Wrench,
  Users,
  Package,
  Clock,
  Activity,
} from "lucide-react";

const OS_BADGE: Record<string, string> = {
  Windows: "bg-primary/15 text-primary",
  Linux: "bg-success/15 text-success",
  macOS: "bg-accent/15 text-accent",
};

const SEVERITY_BADGE: Record<RiskFinding["severity"], string> = {
  low: "bg-success/15 text-success",
  medium: "bg-warning/15 text-warning",
  high: "bg-destructive/15 text-destructive",
  critical: "bg-destructive/20 text-destructive",
};

const SEVERITY_LABEL: Record<RiskFinding["severity"], string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

interface ControlDef {
  key: keyof SecurityControls;
  label: string;
  description: string;
  applicableOs?: OS[];
}

const CONTROL_DEFS: ControlDef[] = [
  {
    key: "firewall",
    label: "Firewall",
    description: "Host firewall active",
    applicableOs: ["Windows", "Linux", "macOS"],
  },
  {
    key: "encryption",
    label: "Encryption",
    description: "Disk encryption enabled",
    applicableOs: ["Windows", "Linux", "macOS"],
  },
  {
    key: "antivirus",
    label: "Antivirus",
    description: "Endpoint protection running",
    applicableOs: ["Windows", "Linux", "macOS"],
  },
  {
    key: "secureBoot",
    label: "Secure Boot",
    description: "UEFI secure boot enforced",
    applicableOs: ["Windows", "Linux", "macOS"],
  },
  {
    key: "tpm",
    label: "TPM",
    description: "Trusted platform module present",
    applicableOs: ["Windows", "Linux", "macOS"],
  },
  {
    key: "ssh",
    label: "SSH enabled",
    description: "Remote shell access",
    applicableOs: ["Linux", "macOS"],
  },
  {
    key: "auditd",
    label: "Auditd",
    description: "Audit daemon logging",
    applicableOs: ["Linux"],
  },
  {
    key: "passwordlessSudo",
    label: "Passwordless sudo",
    description: "Sudo without password",
    applicableOs: ["Linux", "macOS"],
  },
  {
    key: "sip",
    label: "SIP",
    description: "System Integrity Protection",
    applicableOs: ["macOS"],
  },
  {
    key: "gatekeeper",
    label: "Gatekeeper",
    description: "App execution protection",
    applicableOs: ["macOS"],
  },
];

function parseReportDate(value: string): Date | null {
  const date = new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value,
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(iso: string): string {
  const date = parseReportDate(iso);
  if (!date) return iso;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

async function downloadReport(endpoint: EndpointStatus) {
  if (!endpoint.audit.reportId) return;

  const blob = await apiClient.downloadAuditReport(endpoint.audit.reportId);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${endpoint.hostname}-audit-report.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function StatRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd
        className={`text-sm font-medium text-foreground ${
          mono ? "font-mono" : ""
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function SectionCard({
  icon,
  title,
  description,
  children,
  className,
  ...props
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
  className?: string;
} & React.ComponentProps<typeof Card>) {
  return (
    <Card className={className} {...props}>
      <CardHeader>
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            {icon}
          </span>
          <div>
            <CardTitle className="font-display text-base font-bold">
              {title}
            </CardTitle>
            <CardDescription className="text-xs">{description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function ControlToggle({
  label,
  description,
  enabled,
  applicable,
}: {
  label: string;
  description: string;
  enabled: boolean | null;
  applicable: boolean;
}) {
  const isNotApplicable = !applicable;
  const isUnknown = enabled === null && !isNotApplicable;
  const isEnabled = enabled === true;
  const statusLabel = isNotApplicable
    ? "N/A"
    : isUnknown
      ? "Unknown"
      : isEnabled
        ? "Enabled"
        : "Disabled";
  const statusClass = isEnabled
    ? "bg-success/15 text-success"
    : isUnknown || isNotApplicable
      ? "bg-muted text-muted-foreground"
      : "bg-destructive/15 text-destructive";

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background/60 p-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">{label}</p>
        <p className="truncate text-xs text-muted-foreground">{description}</p>
      </div>
      <Badge
        role="status"
        aria-label={`${label} ${statusLabel.toLowerCase()}`}
        className={statusClass}
      >
        {statusLabel}
      </Badge>
    </div>
  );
}

function ProductBadgeList({
  products,
  fallbackEnabled,
  fallbackLabel,
}: {
  products: SecurityProduct[];
  fallbackEnabled: boolean;
  fallbackLabel: string;
}) {
  if (products && products.length > 0) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {products.map((p) => (
          <Badge
            key={p.name}
            className={cn(
              "rounded-full text-xs",
              p.enabled
                ? "bg-green-500/15 text-green-600"
                : "bg-red-500/15 text-red-500",
            )}
          >
            {p.name} {p.enabled ? "\u2713" : "\u2717"}
          </Badge>
        ))}
      </div>
    );
  }
  return (
    <Badge
      className={cn(
        "rounded-full text-xs",
        fallbackEnabled
          ? "bg-success/15 text-success"
          : "bg-destructive/15 text-destructive",
      )}
    >
      {fallbackLabel}: {fallbackEnabled ? "Enabled" : "Disabled"}
    </Badge>
  );
}

function FindingRow({ finding }: { finding: RiskFinding }) {
  return (
    <li className="flex items-start gap-3 rounded-lg border border-border bg-background/60 p-3">
      <span
        className={`mt-0.5 inline-flex min-w-14 items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold ${SEVERITY_BADGE[finding.severity]}`}
      >
        {finding.severity === "critical" || finding.severity === "high" ? (
          <ShieldX className="mr-1 size-3" aria-hidden="true" />
        ) : (
          <ShieldCheck className="mr-1 size-3" aria-hidden="true" />
        )}
        {SEVERITY_LABEL[finding.severity]}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{finding.title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {finding.description}
        </p>
      </div>
      <span
        className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 font-mono text-xs font-semibold ${riskScoreBg(finding.impact)}`}
        title={`Impact score ${finding.impact}/100`}
      >
        {finding.impact}
      </span>
    </li>
  );
}

export default function EndpointDetailPage() {
  const { mac } = useParams({ from: "/endpoints/$mac" });
  const { endpoints } = useEndpoints();
  const [diskExpanded, setDiskExpanded] = useState(false);
  const [servicesExpanded, setServicesExpanded] = useState(false);
  const [tasksExpanded, setTasksExpanded] = useState(false);
  const [patchesExpanded, setPatchesExpanded] = useState(false);
  const [softwareExpanded, setSoftwareExpanded] = useState(false);
  const [softwareSearch, setSoftwareSearch] = useState("");
  const [usersExpanded, setUsersExpanded] = useState(false);
  const [appsSearch, setAppsSearch] = useState("");
  const [appsSortKey, setAppsSortKey] = useState<keyof ProcessInfo>("cpu_percent");
  const [appsSortAsc, setAppsSortAsc] = useState(false);

  const endpoint = endpoints.find(
    (e) => e.mac_address.toLowerCase() === mac.toLowerCase(),
  );

  if (!endpoint) {
    return (
      <div className="space-y-6">
        <div
          data-ocid="endpoint_detail.empty_state"
          className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 py-16 text-center shadow-subtle"
        >
          <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Server className="size-6" aria-hidden="true" />
          </span>
          <h2 className="mt-4 font-display text-xl font-bold text-foreground">
            Endpoint not found
          </h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            No endpoint matches the identifier{" "}
            <span className="font-mono text-foreground">{mac}</span>. It may
            have been removed from the fleet.
          </p>
          <Button
            asChild
            variant="outline"
            className="mt-6"
            data-ocid="endpoint_detail.back_button"
          >
            <a href="/inventory">Back to inventory</a>
          </Button>
        </div>
      </div>
    );
  }

  const { audit } = endpoint;
  const history = audit.history.map((report, index) => ({
    date: report.reportDate,
    key: (report.s3ObjectKey || `Report #${report.reportId}`).split("?")[0],
    current: index === 0,
  }));

  const rawData = audit.raw_data ?? {};
  const isWindows = endpoint.os === "Windows";
  const isLinux = endpoint.os === "Linux";

  const RISKY_PORTS = new Set([21, 23, 445, 3389]);
  const STANDARD_ADMIN_ACCOUNTS = new Set(["Administrator", "abhishek"]);
  const SYSTEM_TASK_PREFIX = /^\\Microsoft\\/i;

  // Software search/filter
  const allSoftware = (rawData.installed_software ?? []) as SoftwareInfo[];
  const filteredSoftware = softwareSearch.trim()
    ? allSoftware.filter(
        (s) =>
          s.name?.toLowerCase().includes(softwareSearch.toLowerCase()) ||
          s.publisher?.toLowerCase().includes(softwareSearch.toLowerCase()),
      )
    : allSoftware;
  const visibleSoftware = softwareExpanded ? filteredSoftware : filteredSoftware.slice(0, 10);

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card data-ocid="endpoint_detail.header">
        <CardContent className="flex flex-col gap-5 p-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-mono text-2xl font-bold tracking-tight text-foreground">
                {endpoint.hostname}
              </h2>
              <Badge
                className={`${OS_BADGE[endpoint.os]} rounded-full`}
                data-ocid="endpoint_detail.os_badge"
              >
                {endpoint.os}
              </Badge>
              {endpoint.device_type === "vm" && (
                <Badge
                  className="rounded-full border-transparent bg-purple-500/15 text-purple-600 dark:text-purple-400"
                  data-ocid="endpoint_detail.vm_badge"
                >
                  Virtual Machine
                </Badge>
              )}
              <Badge
                variant="outline"
                className={`rounded-full ${
                  audit.riskLevel === "high"
                    ? "bg-destructive/15 text-destructive"
                    : audit.riskLevel === "medium"
                      ? "bg-warning/15 text-warning"
                      : "bg-success/15 text-success"
                }`}
                data-ocid="endpoint_detail.risk_badge"
              >
                Score {audit.riskScore}
              </Badge>
            </div>
            <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <div className="flex items-center gap-1.5">
                <dt className="text-muted-foreground">IP</dt>
                <dd className="font-mono font-medium text-foreground">
                  {endpoint.ip_address}
                </dd>
              </div>
              <div className="flex items-center gap-1.5">
                <dt className="text-muted-foreground">MAC</dt>
                <dd className="font-mono font-medium text-foreground">
                  {endpoint.mac_address}
                </dd>
              </div>
              <div className="flex items-center gap-1.5">
                <dt className="text-muted-foreground">Last audit</dt>
                <dd className="font-medium text-foreground">
                  {formatDate(audit.reportDate)}
                </dd>
              </div>
            </dl>
          </div>
          <Button
            onClick={() => downloadReport(endpoint)}
            data-ocid="endpoint_detail.download_button"
            className="shrink-0"
          >
            <Download className="mr-2 size-4" aria-hidden="true" />
            Audit report download
          </Button>
        </CardContent>
      </Card>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        {/* Hardware */}
        <SectionCard
          icon={<Cpu className="size-4" aria-hidden="true" />}
          title="Hardware"
          description="Processor, memory, and storage profile"
          data-ocid="endpoint_detail.hardware"
        >
          <dl className="divide-y divide-border">
            <StatRow
              label="CPU cores"
              value={String(audit.hardware.cpuCores)}
            />
            <StatRow label="CPU model" value={audit.hardware.cpuModel} />
            <StatRow label="RAM" value={`${audit.hardware.ramGb} GB`} />
            <StatRow
              label="Architecture"
              value={audit.hardware.architecture}
              mono
            />
          </dl>
          <div className="mt-4">
            <button
              type="button"
              className="mb-1.5 flex w-full items-center justify-between text-sm"
              onClick={() => setDiskExpanded((v) => !v)}
              aria-expanded={diskExpanded}
            >
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <HardDrive className="size-4" aria-hidden="true" />
                Disk usage
              </span>
              <span className="flex items-center gap-2">
                <span className="font-mono font-medium text-foreground">
                  {formatPercent(audit.hardware.diskPercent)}
                </span>
                {endpoint.disk_details && endpoint.disk_details.length > 0 && (
                  diskExpanded
                    ? <ChevronUp className="size-3.5 text-muted-foreground" />
                    : <ChevronDown className="size-3.5 text-muted-foreground" />
                )}
              </span>
            </button>
            <Progress
              value={audit.hardware.diskPercent}
              indicatorClassName={utilizationBarColor(audit.hardware.diskPercent)}
              aria-label={`Disk usage ${formatPercent(audit.hardware.diskPercent)}`}
            />
            {diskExpanded && endpoint.disk_details && endpoint.disk_details.length > 0 && (
              <div className="mt-3 space-y-2" data-ocid="endpoint_detail.disk_breakdown">
                {endpoint.disk_details.map((d: DiskDetail) => (
                  <div key={d.drive} className="rounded-md border border-border bg-background/60 p-3">
                    <div className="mb-1.5 flex items-center justify-between text-xs">
                      <span className="font-mono font-semibold text-foreground">{d.drive}</span>
                      <span className="text-muted-foreground">
                        {d.used_gb} GB / {d.total_gb} GB
                        <span className="ml-1.5 font-mono font-medium text-foreground">
                          ({d.percent}%)
                        </span>
                      </span>
                    </div>
                    <Progress
                      value={d.percent}
                      indicatorClassName={utilizationBarColor(d.percent)}
                      aria-label={`${d.drive} disk usage ${d.percent}%`}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </SectionCard>

        {/* Network */}
        <SectionCard
          icon={<Network className="size-4" aria-hidden="true" />}
          title="Network"
          description="Addressing and connectivity"
          data-ocid="endpoint_detail.network"
        >
          <dl className="divide-y divide-border">
            <StatRow label="IP address" value={endpoint.ip_address} mono />
            <StatRow label="MAC address" value={endpoint.mac_address} mono />
            <StatRow label="Last seen" value={timeAgo(endpoint.last_seen)} />
            <StatRow
              label="Device uptime"
              value={endpoint.uptime_seconds == null ? "Unavailable" : formatUptime(endpoint.uptime_seconds * 1000)}
            />
            <StatRow
              label="Connection uptime"
              value={formatUptime(endpoint.connection_uptime)}
            />
            {endpoint.device_type === "vm" && (
              <div className="flex items-center justify-between gap-4 py-2.5">
                <dt className="text-sm text-muted-foreground">Wake-on-LAN</dt>
                <dd className="text-sm font-medium text-muted-foreground italic">
                  Not applicable (VM)
                </dd>
              </div>
            )}
          </dl>
        </SectionCard>
      </div>

      {/* Running Applications */}
      {(() => {
        const apps = endpoint.running_apps ?? [];
        const updatedAgo = endpoint.last_health_check
          ? Math.round((Date.now() - endpoint.last_health_check) / 1000)
          : null;
        const filteredApps = appsSearch.trim()
          ? apps.filter((p) => p.name.toLowerCase().includes(appsSearch.toLowerCase()))
          : apps;
        const sortedApps = [...filteredApps].sort((a, b) => {
          const av = a[appsSortKey] as number | string;
          const bv = b[appsSortKey] as number | string;
          if (av < bv) return appsSortAsc ? -1 : 1;
          if (av > bv) return appsSortAsc ? 1 : -1;
          return 0;
        });
        const toggleSort = (key: keyof ProcessInfo) => {
          if (appsSortKey === key) {
            setAppsSortAsc((v) => !v);
          } else {
            setAppsSortKey(key);
            setAppsSortAsc(key === "name");
          }
        };
        const SortIcon = ({ col }: { col: keyof ProcessInfo }) =>
          appsSortKey === col ? (
            appsSortAsc ? (
              <ChevronUp className="inline size-3" />
            ) : (
              <ChevronDown className="inline size-3" />
            )
          ) : null;
        return (
          <SectionCard
            icon={<MonitorCog className="size-4" aria-hidden="true" />}
            title={`Running Applications · ${endpoint.process_count ?? apps.length} processes`}
            description={
              updatedAgo !== null
                ? `Updated ${updatedAgo} sec ago`
                : "Live process data from health monitor"
            }
            data-ocid="endpoint_detail.running_apps"
          >
            {apps.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-background/60 px-4 py-10 text-center">
                <Activity className="size-8 text-muted-foreground" aria-hidden="true" />
                <p className="mt-2 text-sm font-medium text-foreground">
                  No process data available
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Health monitor update pending
                </p>
              </div>
            ) : (
              <>
                <div className="mb-3">
                  <input
                    type="search"
                    placeholder="Filter by process name…"
                    value={appsSearch}
                    onChange={(e) => setAppsSearch(e.target.value)}
                    className="w-full rounded-md border border-border bg-background/60 px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th
                          className="cursor-pointer pb-2 text-left font-medium text-muted-foreground hover:text-foreground"
                          onClick={() => toggleSort("name")}
                        >
                          Process Name <SortIcon col="name" />
                        </th>
                        <th
                          className="cursor-pointer pb-2 text-left font-medium text-muted-foreground hover:text-foreground"
                          onClick={() => toggleSort("pid")}
                        >
                          PID <SortIcon col="pid" />
                        </th>
                        <th
                          className="cursor-pointer pb-2 text-left font-medium text-muted-foreground hover:text-foreground"
                          onClick={() => toggleSort("cpu_percent")}
                        >
                          CPU % <SortIcon col="cpu_percent" />
                        </th>
                        <th
                          className="cursor-pointer pb-2 text-left font-medium text-muted-foreground hover:text-foreground"
                          onClick={() => toggleSort("memory_mb")}
                        >
                          Memory (MB) <SortIcon col="memory_mb" />
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedApps.map((proc) => (
                        <tr
                          key={proc.pid}
                          className="border-b border-border/50 last:border-0"
                        >
                          <td className="py-2 font-mono text-xs text-foreground">
                            {proc.name}
                          </td>
                          <td className="py-2 font-mono text-xs text-muted-foreground">
                            {proc.pid}
                          </td>
                          <td className="py-2 text-xs text-foreground">
                            {proc.cpu_percent}%
                          </td>
                          <td className="py-2 text-xs text-foreground">
                            {proc.memory_mb} MB
                          </td>
                        </tr>
                      ))}
                      {sortedApps.length === 0 && (
                        <tr>
                          <td
                            colSpan={4}
                            className="py-6 text-center text-xs text-muted-foreground"
                          >
                            No results for "{appsSearch}"
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </SectionCard>
        );
      })()}

      {/* Security Controls */}
      <SectionCard
        icon={<ShieldCheck className="size-4" aria-hidden="true" />}
        title="Security Controls"
        description="Read-only status of hardening controls"
        data-ocid="endpoint_detail.security"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {CONTROL_DEFS.filter(
            (c) => !c.applicableOs || c.applicableOs.includes(endpoint.os),
          ).map((c) => (
            <ControlToggle
              key={c.key}
              label={c.label}
              description={c.description}
              enabled={audit.security[c.key]}
              applicable={!c.applicableOs || c.applicableOs.includes(endpoint.os)}
            />
          ))}
        </div>
        <div className="mt-4 space-y-3 border-t border-border pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Live Security Products
            </p>
            <div className="flex flex-col gap-3">
              {/* Firewall */}
              <div>
                <p className="mb-1.5 text-xs text-muted-foreground">Firewall</p>
                {(endpoint.firewall_products && endpoint.firewall_products.length > 0) ? (
                  <div className="flex flex-col gap-1.5">
                    {endpoint.firewall_products.map((p) => (
                      <div key={p.name} className="flex items-center justify-between rounded-md border border-border bg-background/60 px-3 py-2">
                        <span className="text-sm font-medium text-foreground">{p.name}</span>
                        <div className="flex items-center gap-2">
                          <Badge className={cn("rounded-full text-xs", p.enabled ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive")}>
                            {p.enabled ? "Enabled" : "Disabled"}
                          </Badge>
                          <Badge className={cn("rounded-full text-xs", p.up_to_date ? "bg-success/15 text-success" : "bg-warning/15 text-warning")}>
                            {p.up_to_date ? "Up to date" : "Outdated"}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Badge className={cn("rounded-full text-xs", endpoint.firewall_active ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive")}>
                    {endpoint.firewall_active ? "Enabled" : "Disabled"}
                  </Badge>
                )}
              </div>
              {/* Antivirus */}
              <div>
                <p className="mb-1.5 text-xs text-muted-foreground">Antivirus</p>
                {(endpoint.antivirus_products && endpoint.antivirus_products.length > 0) ? (
                  <div className="flex flex-col gap-1.5">
                    {endpoint.antivirus_products.map((p) => (
                      <div key={p.name} className="flex items-center justify-between rounded-md border border-border bg-background/60 px-3 py-2">
                        <span className="text-sm font-medium text-foreground">{p.name}</span>
                        <div className="flex items-center gap-2">
                          <Badge className={cn("rounded-full text-xs", p.enabled ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive")}>
                            {p.enabled ? "Enabled" : "Disabled"}
                          </Badge>
                          <Badge className={cn("rounded-full text-xs", p.up_to_date ? "bg-success/15 text-success" : "bg-warning/15 text-warning")}>
                            {p.up_to_date ? "Up to date" : "Outdated"}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Badge className={cn("rounded-full text-xs", endpoint.antivirus_active ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive")}>
                    {endpoint.antivirus_active ? "Enabled" : "Disabled"}
                  </Badge>
                )}
              </div>
            </div>
          </div>
      </SectionCard>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Compliance Findings */}
        <SectionCard
          icon={<FileText className="size-4" aria-hidden="true" />}
          title="Compliance Findings"
          description="Detected risks with impact scores"
          data-ocid="endpoint_detail.findings"
        >
          {audit.riskFindings.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-background/60 px-4 py-10 text-center">
              <ShieldCheck className="size-8 text-success" aria-hidden="true" />
              <p className="mt-2 text-sm font-medium text-foreground">
                No findings
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                This endpoint passed all compliance checks.
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {audit.riskFindings.map((finding) => (
                <FindingRow key={finding.id} finding={finding} />
              ))}
            </ul>
          )}
        </SectionCard>

        {/* Updates */}
        <SectionCard
          icon={<Wrench className="size-4" aria-hidden="true" />}
          title="Updates"
          description="Patch and password policy status"
          data-ocid="endpoint_detail.updates"
        >
          <dl className="divide-y divide-border">
            <StatRow
              label="Pending updates"
              value={String(audit.pendingUpdates)}
            />
            <StatRow
              label="Last patch date"
              value={formatDate(audit.lastPatchDate)}
            />
            <StatRow
              label="Password policy (pass max days)"
              value={`${audit.passMaxDays} days`}
            />
          </dl>
          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between text-sm">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <RefreshCw className="size-4" aria-hidden="true" />
                Patch freshness
              </span>
              <span className="font-mono font-medium text-foreground">
                {audit.pendingUpdates === 0
                  ? "Up to date"
                  : `${audit.pendingUpdates} pending`}
              </span>
            </div>
            <Progress
              value={Math.min(100, audit.pendingUpdates * 2)}
              indicatorClassName={utilizationBarColor(audit.pendingUpdates * 2)}
              aria-label={`${audit.pendingUpdates} pending updates`}
            />
          </div>
        </SectionCard>
      </div>

      {/* ── Section A: Administrator Accounts (Windows) ── */}
      {isWindows && (rawData.admin_accounts?.length ?? 0) > 0 && (
        <SectionCard
          icon={<Users className="size-4" aria-hidden="true" />}
          title="Administrator Accounts"
          description="Local accounts with elevated privileges"
          data-ocid="endpoint_detail.admin_accounts"
        >
          <div className="flex flex-wrap gap-2">
            {(rawData.admin_accounts ?? []).map((user) => (
              <Badge
                key={user}
                className={cn(
                  "rounded-full text-sm",
                  STANDARD_ADMIN_ACCOUNTS.has(user)
                    ? "bg-muted text-muted-foreground"
                    : "bg-amber-500/15 text-amber-600 dark:text-amber-400",
                )}
              >
                {user}
              </Badge>
            ))}
          </div>
        </SectionCard>
      )}

      {/* ── Section B: Open Ports (Windows) ── */}
      {isWindows && (rawData.open_ports?.length ?? 0) > 0 && (
        <SectionCard
          icon={<Network className="size-4" aria-hidden="true" />}
          title="Open Listening Ports"
          description="Network ports accepting connections"
          data-ocid="endpoint_detail.open_ports"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="pb-2 text-left font-medium text-muted-foreground">Address</th>
                  <th className="pb-2 text-left font-medium text-muted-foreground">Port</th>
                  <th className="pb-2 text-left font-medium text-muted-foreground">Process</th>
                </tr>
              </thead>
              <tbody>
                {(rawData.open_ports ?? []).map((p, i) => {
                  const portNum = Number(p.port);
                  const isRisky = RISKY_PORTS.has(portNum);
                  return (
                    <tr key={i} className="border-b border-border/50 last:border-0">
                      <td className="py-2 font-mono text-xs text-foreground">{p.address}</td>
                      <td className="py-2">
                        <Badge
                          className={cn(
                            "rounded-full font-mono text-xs",
                            isRisky
                              ? "bg-destructive/15 text-destructive"
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          {p.port}
                        </Badge>
                      </td>
                      <td className="py-2 font-mono text-xs text-foreground">{p.process}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {/* ── Section C: Running Services (Windows + Linux) ── */}
      {(rawData.running_services?.length ?? 0) > 0 && (
        <SectionCard
          icon={<Activity className="size-4" aria-hidden="true" />}
          title="Running Services"
          description="Active system services"
          data-ocid="endpoint_detail.running_services"
        >
          {isWindows ? (
            (() => {
              const services = (rawData.running_services ?? []) as ServiceInfo[];
              const threshold = 20;
              const visible = servicesExpanded ? services : services.slice(0, threshold);
              return (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="pb-2 text-left font-medium text-muted-foreground">Name</th>
                          <th className="pb-2 text-left font-medium text-muted-foreground">Display Name</th>
                          <th className="pb-2 text-left font-medium text-muted-foreground">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visible.map((svc, i) => (
                          <tr key={i} className="border-b border-border/50 last:border-0">
                            <td className="py-2 font-mono text-xs text-foreground">{svc.name}</td>
                            <td className="py-2 text-xs text-foreground">{svc.display ?? ""}</td>
                            <td className="py-2">
                              <Badge
                                className={cn(
                                  "rounded-full text-xs",
                                  svc.status?.toLowerCase() === "running"
                                    ? "bg-success/15 text-success"
                                    : "bg-muted text-muted-foreground",
                                )}
                              >
                                {svc.status}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {services.length > threshold && (
                    <button
                      type="button"
                      onClick={() => setServicesExpanded((v) => !v)}
                      className="mt-3 flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      {servicesExpanded ? (
                        <><ChevronUp className="size-3" />Show less</>
                      ) : (
                        <><ChevronDown className="size-3" />Show all {services.length} services</>
                      )}
                    </button>
                  )}
                </>
              );
            })()
          ) : (
            (() => {
              const services = (rawData.running_services ?? []) as string[];
              const threshold = 15;
              const visible = servicesExpanded ? services : services.slice(0, threshold);
              return (
                <>
                  <ul className="space-y-1">
                    {visible.map((svc, i) => (
                      <li key={i} className="rounded-md border border-border/50 bg-background/60 px-3 py-1.5 font-mono text-xs text-foreground">
                        {svc}
                      </li>
                    ))}
                  </ul>
                  {services.length > threshold && (
                    <button
                      type="button"
                      onClick={() => setServicesExpanded((v) => !v)}
                      className="mt-3 flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      {servicesExpanded ? (
                        <><ChevronUp className="size-3" />Show less</>
                      ) : (
                        <><ChevronDown className="size-3" />Show all {services.length} services</>
                      )}
                    </button>
                  )}
                </>
              );
            })()
          )}
        </SectionCard>
      )}

      {/* ── Section E: Scheduled Tasks (Windows) ── */}
      {isWindows && (rawData.scheduled_tasks?.length ?? 0) > 0 && (
        <SectionCard
          icon={<Clock className="size-4" aria-hidden="true" />}
          title="Scheduled Tasks"
          description="Registered scheduled tasks"
          data-ocid="endpoint_detail.scheduled_tasks"
        >
          {(() => {
            const tasks = (rawData.scheduled_tasks ?? []) as TaskInfo[];
            const threshold = 15;
            const visible = tasksExpanded ? tasks : tasks.slice(0, threshold);
            return (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="pb-2 text-left font-medium text-muted-foreground">Name</th>
                        <th className="pb-2 text-left font-medium text-muted-foreground">Path</th>
                        <th className="pb-2 text-left font-medium text-muted-foreground">State</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((task, i) => {
                        const isNonStandard = task.path
                          ? !SYSTEM_TASK_PREFIX.test(task.path)
                          : true;
                        return (
                          <tr key={i} className="border-b border-border/50 last:border-0">
                            <td className={cn("py-2 font-mono text-xs", isNonStandard ? "text-amber-600 dark:text-amber-400" : "text-foreground")}>
                              {task.name}
                            </td>
                            <td className="py-2 font-mono text-xs text-muted-foreground">{task.path ?? ""}</td>
                            <td className="py-2 text-xs text-foreground">{task.state ?? ""}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {tasks.length > threshold && (
                  <button
                    type="button"
                    onClick={() => setTasksExpanded((v) => !v)}
                    className="mt-3 flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    {tasksExpanded ? (
                      <><ChevronUp className="size-3" />Show less</>
                    ) : (
                      <><ChevronDown className="size-3" />Show all {tasks.length} tasks</>
                    )}
                  </button>
                )}
              </>
            );
          })()}
        </SectionCard>
      )}

      {/* ── Section F: Installed Patches (Windows) ── */}
      {isWindows && (rawData.installed_patches?.length ?? 0) > 0 && (
        <SectionCard
          icon={<ShieldCheck className="size-4" aria-hidden="true" />}
          title="Installed Patches"
          description="Windows update history"
          data-ocid="endpoint_detail.installed_patches"
        >
          {(() => {
            const patches = (rawData.installed_patches ?? []) as PatchInfo[];
            const threshold = 10;
            const visible = patchesExpanded ? patches : patches.slice(0, threshold);
            return (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="pb-2 text-left font-medium text-muted-foreground">HotFix ID</th>
                        <th className="pb-2 text-left font-medium text-muted-foreground">Description</th>
                        <th className="pb-2 text-left font-medium text-muted-foreground">Installed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((patch, i) => (
                        <tr key={i} className="border-b border-border/50 last:border-0">
                          <td className="py-2 font-mono text-xs font-semibold text-foreground">{patch.id}</td>
                          <td className="py-2 text-xs text-foreground">{patch.description ?? ""}</td>
                          <td className="py-2 text-xs text-muted-foreground">{patch.installed_on ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {patches.length > threshold && (
                  <button
                    type="button"
                    onClick={() => setPatchesExpanded((v) => !v)}
                    className="mt-3 flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    {patchesExpanded ? (
                      <><ChevronUp className="size-3" />Show less</>
                    ) : (
                      <><ChevronDown className="size-3" />Show all {patches.length} patches</>
                    )}
                  </button>
                )}
              </>
            );
          })()}
        </SectionCard>
      )}

      {/* ── Section D: Installed Software (Windows) ── */}
      {isWindows && allSoftware.length > 0 && (
        <SectionCard
          icon={<Package className="size-4" aria-hidden="true" />}
          title="Installed Software"
          description="Software inventory from last audit"
          data-ocid="endpoint_detail.installed_software"
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <input
              type="search"
              placeholder="Search by name or publisher…"
              value={softwareSearch}
              onChange={(e) => { setSoftwareSearch(e.target.value); setSoftwareExpanded(false); }}
              className="flex-1 rounded-md border border-border bg-background/60 px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <Badge className="shrink-0 rounded-full bg-muted text-muted-foreground">
              {allSoftware.length} applications
            </Badge>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="pb-2 text-left font-medium text-muted-foreground">Name</th>
                  <th className="pb-2 text-left font-medium text-muted-foreground">Version</th>
                  <th className="pb-2 text-left font-medium text-muted-foreground">Publisher</th>
                </tr>
              </thead>
              <tbody>
                {visibleSoftware.map((sw, i) => (
                  <tr key={i} className="border-b border-border/50 last:border-0">
                    <td className="py-2 text-xs text-foreground">{sw.name}</td>
                    <td className="py-2 font-mono text-xs text-muted-foreground">{sw.version ?? ""}</td>
                    <td className="py-2 text-xs text-muted-foreground">{sw.publisher ?? ""}</td>
                  </tr>
                ))}
                {filteredSoftware.length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-6 text-center text-xs text-muted-foreground">
                      No results for "{softwareSearch}"
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {filteredSoftware.length > 10 && (
            <button
              type="button"
              onClick={() => setSoftwareExpanded((v) => !v)}
              className="mt-3 flex items-center gap-1 text-xs text-primary hover:underline"
            >
              {softwareExpanded ? (
                <><ChevronUp className="size-3" />Show less</>
              ) : (
                <><ChevronDown className="size-3" />Show all {filteredSoftware.length} results</>
              )}
            </button>
          )}
        </SectionCard>
      )}

      {/* ── Section H: Local User Accounts (Windows) ── */}
      {isWindows && (rawData.all_users?.length ?? 0) > 0 && (
        <SectionCard
          icon={<Users className="size-4" aria-hidden="true" />}
          title="Local User Accounts"
          description="All local user accounts"
          data-ocid="endpoint_detail.all_users"
        >
          {(() => {
            const users = (rawData.all_users ?? []) as UserInfo[];
            const threshold = 10;
            const visible = usersExpanded ? users : users.slice(0, threshold);
            return (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="pb-2 text-left font-medium text-muted-foreground">Username</th>
                        <th className="pb-2 text-left font-medium text-muted-foreground">Enabled</th>
                        <th className="pb-2 text-left font-medium text-muted-foreground">Password Never Expires</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((user, i) => (
                        <tr key={i} className="border-b border-border/50 last:border-0">
                          <td className="py-2 font-mono text-xs text-foreground">{user.name}</td>
                          <td className="py-2">
                            <Badge
                              className={cn(
                                "rounded-full text-xs",
                                user.enabled
                                  ? "bg-success/15 text-success"
                                  : "bg-muted text-muted-foreground",
                              )}
                            >
                              {user.enabled ? "Yes" : "No"}
                            </Badge>
                          </td>
                          <td className="py-2">
                            <Badge
                              className={cn(
                                "rounded-full text-xs",
                                user.pwd_never_expires
                                  ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                                  : "bg-muted text-muted-foreground",
                              )}
                            >
                              {user.pwd_never_expires ? "Yes" : "No"}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {users.length > threshold && (
                  <button
                    type="button"
                    onClick={() => setUsersExpanded((v) => !v)}
                    className="mt-3 flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    {usersExpanded ? (
                      <><ChevronUp className="size-3" />Show less</>
                    ) : (
                      <><ChevronDown className="size-3" />Show all {users.length} users</>
                    )}
                  </button>
                )}
              </>
            );
          })()}
        </SectionCard>
      )}

      {/* ── Section G: Linux-specific ── */}
      {isLinux && (
        (rawData.world_writable_dirs !== undefined && rawData.world_writable_dirs !== null) ||
        (rawData.network_shares?.length ?? 0) > 0 ||
        (rawData.network_listeners?.length ?? 0) > 0 ||
        rawData.installed_packages_count !== undefined
      ) && (
        <SectionCard
          icon={<Server className="size-4" aria-hidden="true" />}
          title="Linux System Details"
          description="Linux-specific security and inventory data"
          data-ocid="endpoint_detail.linux_details"
        >
          <div className="space-y-5">
            {/* World-writable dirs */}
            {rawData.world_writable_dirs !== undefined && rawData.world_writable_dirs !== null && (
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  World-Writable Directories
                </p>
                <Badge
                  className={cn(
                    "rounded-full text-sm",
                    rawData.world_writable_dirs > 0
                      ? "bg-warning/15 text-warning"
                      : "bg-success/15 text-success",
                  )}
                >
                  {rawData.world_writable_dirs} {rawData.world_writable_dirs === 1 ? "directory" : "directories"}
                </Badge>
              </div>
            )}

            {/* Installed packages count */}
            {rawData.installed_packages_count !== undefined && (
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Installed Packages
                </p>
                <Badge className="rounded-full bg-muted text-muted-foreground text-sm">
                  {rawData.installed_packages_count} packages
                </Badge>
              </div>
            )}

            {/* Network shares */}
            {(rawData.network_shares?.length ?? 0) > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Network Shares
                </p>
                <ul className="space-y-1">
                  {(rawData.network_shares ?? []).map((share, i) => (
                    <li key={i} className="rounded-md border border-border/50 bg-background/60 px-3 py-1.5 font-mono text-xs text-foreground">
                      {share}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Network listeners */}
            {(rawData.network_listeners?.length ?? 0) > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Network Listeners
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <tbody>
                      {(rawData.network_listeners ?? []).map((listener, i) => (
                        <tr key={i} className="border-b border-border/50 last:border-0">
                          <td className="py-1.5 font-mono text-xs text-foreground">{listener}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </SectionCard>
      )}

      {/* Related reports */}
      <SectionCard
        icon={<MonitorCog className="size-4" aria-hidden="true" />}
        title="Related Reports"
        description="Recent audit history for this endpoint"
        data-ocid="endpoint_detail.history"
      >
        <ol className="relative space-y-4 border-l border-border pl-5">
          {history.map((h, i) => {
            const reportTime = parseReportDate(h.date)?.getTime() ?? Date.now();
            const reportDate = new Date(reportTime);
            const todayLocal = new Date();
            const reportLocal = new Date(
              reportDate.getFullYear(),
              reportDate.getMonth(),
              reportDate.getDate(),
            );
            const todayMidnight = new Date(
              todayLocal.getFullYear(),
              todayLocal.getMonth(),
              todayLocal.getDate(),
            );
            const ageDays = Math.max(
              0,
              Math.round((todayMidnight.getTime() - reportLocal.getTime()) / (24 * 60 * 60 * 1000)),
            );
            const ageLabel =
              ageDays === 0
                ? "Today"
                : ageDays === 1
                  ? "1 day ago"
                  : `${ageDays} days ago`;
            return (
              <li key={`${h.date}-${i}`} className="relative">
                <span
                  className={`absolute -left-[1.45rem] top-1.5 size-3 rounded-full border-2 border-card ${
                    h.current ? "bg-primary" : "bg-muted"
                  }`}
                  aria-hidden="true"
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {h.current ? "Latest audit report" : "Previous audit"}
                    </p>
                    <p className="truncate font-mono text-xs text-muted-foreground">
                      {h.key}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {formatDate(h.date)}
                    </span>
                    <Badge
                      variant={h.current ? "default" : "outline"}
                      className="rounded-full"
                      data-ocid={`endpoint_detail.history.item.${i}`}
                    >
                      {ageLabel}
                    </Badge>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </SectionCard>
    </div>
  );
}
