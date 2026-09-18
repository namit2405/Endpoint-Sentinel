import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  formatPercent,
  formatUptime,
  riskScoreBg,
  timeAgo,
  utilizationBarColor,
} from "@/lib/format";
import type {
  EndpointStatus,
  RiskFinding,
  SecurityControls,
} from "@/lib/types";
import { useEndpoints } from "@/lib/useEndpoints";
import { apiClient } from "@/lib/api-client";
import { useParams } from "@tanstack/react-router";
import {
  Cpu,
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
}

const CONTROLS_ROW_1: ControlDef[] = [
  { key: "firewall", label: "Firewall", description: "Host firewall active" },
  {
    key: "encryption",
    label: "Encryption",
    description: "Disk encryption enabled",
  },
  {
    key: "antivirus",
    label: "Antivirus",
    description: "Endpoint protection running",
  },
  {
    key: "secureBoot",
    label: "Secure Boot",
    description: "UEFI secure boot enforced",
  },
];

const CONTROLS_ROW_2: ControlDef[] = [
  { key: "tpm", label: "TPM", description: "Trusted platform module present" },
  { key: "ssh", label: "SSH enabled", description: "Remote shell access" },
  { key: "auditd", label: "Auditd", description: "Audit daemon logging" },
  {
    key: "passwordlessSudo",
    label: "Passwordless sudo",
    description: "Sudo without password",
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
}: {
  label: string;
  description: string;
  enabled: boolean | null;
}) {
  const isUnknown = enabled === null;
  const isEnabled = enabled === true;

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background/60 p-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">{label}</p>
        <p className="truncate text-xs text-muted-foreground">{description}</p>
      </div>
      <TooltipProvider delayDuration={100}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <Switch
                checked={isEnabled}
                disabled
                aria-label={`${label} ${isUnknown ? "unknown" : isEnabled ? "enabled" : "disabled"}`}
                className={
                  isEnabled
                    ? "border-border/80 disabled:opacity-100 data-[state=checked]:bg-success"
                    : isUnknown
                      ? "border-border/80 disabled:opacity-100 data-[state=unchecked]:bg-muted"
                      : "border-border/80 disabled:opacity-100 data-[state=unchecked]:bg-destructive/45 data-[state=checked]:bg-destructive"
                }
              />
            </span>
          </TooltipTrigger>
          <TooltipContent>{isUnknown ? "Unknown" : isEnabled ? "Enabled" : "Disabled"}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
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

      <div className="grid gap-6 lg:grid-cols-2">
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
            <div className="mb-1.5 flex items-center justify-between text-sm">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <HardDrive className="size-4" aria-hidden="true" />
                Disk usage
              </span>
              <span className="font-mono font-medium text-foreground">
                {formatPercent(audit.hardware.diskPercent)}
              </span>
            </div>
            <Progress
              value={audit.hardware.diskPercent}
              indicatorClassName={utilizationBarColor(audit.hardware.diskPercent)}
              aria-label={`Disk usage ${formatPercent(audit.hardware.diskPercent)}`}
            />
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
          </dl>
        </SectionCard>
      </div>

      {/* Security Controls */}
      <SectionCard
        icon={<ShieldCheck className="size-4" aria-hidden="true" />}
        title="Security Controls"
        description="Read-only status of hardening controls"
        data-ocid="endpoint_detail.security"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {CONTROLS_ROW_1.map((c) => (
            <ControlToggle
              key={c.key}
              label={c.label}
              description={c.description}
              enabled={audit.security[c.key]}
            />
          ))}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {CONTROLS_ROW_2.map((c) => (
            <ControlToggle
              key={c.key}
              label={c.label}
              description={c.description}
              enabled={audit.security[c.key]}
            />
          ))}
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
            const ageDays = Math.max(
              0,
              Math.floor((Date.now() - reportTime) / (24 * 60 * 60 * 1000)),
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
