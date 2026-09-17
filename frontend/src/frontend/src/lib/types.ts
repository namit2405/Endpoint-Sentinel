export type OS = "Windows" | "Linux" | "macOS";

export type HealthStatus = "healthy" | "warning" | "critical";

export type RiskLevel = "low" | "medium" | "high";

export type ConnectionStatus = "online" | "warning" | "offline";

export interface SecurityControls {
  firewall: boolean;
  encryption: boolean;
  antivirus: boolean;
  secureBoot: boolean;
  tpm: boolean;
  ssh: boolean;
  auditd: boolean;
  passwordlessSudo: boolean;
}

export interface RiskFinding {
  id: string;
  title: string;
  severity: "low" | "medium" | "high" | "critical";
  impact: number;
  description: string;
}

export interface EndpointAudit {
  hardware: {
    cpuCores: number;
    cpuModel: string;
    ramGb: number;
    architecture: string;
    diskPercent: number;
  };
  security: SecurityControls;
  pendingUpdates: number;
  lastPatchDate: string;
  passMaxDays: number;
  riskScore: number;
  riskLevel: RiskLevel;
  riskFindings: RiskFinding[];
  reportDate: string;
  reportId: number | null;
  s3ObjectKey: string;
  history: Array<{
    reportId: number;
    reportDate: string;
    s3ObjectKey: string;
  }>;
}

export interface EndpointStatus {
  hostname: string;
  mac_address: string;
  ip_address: string;
  os: OS;
  cpu_percent: number;
  memory_percent: number;
  disk_percent: number;
  uptime_seconds: number | null;
  health_score: number;
  health_status: HealthStatus;
  firewall_active: boolean;
  antivirus_active: boolean;
  last_seen: number;
  last_health_check: number;
  connection_uptime: number;
  audit: EndpointAudit;
}

export interface DashboardSummary {
  total: number;
  online: number;
  warning: number;
  offline: number;
  healthy: number;
  atRisk: number;
  critical: number;
  avgHealthScore: number;
  compliance: number;
}

export interface HealthTrendPoint {
  date: string;
  score: number;
}

export interface OSDistribution {
  os: OS;
  count: number;
}

export interface QuickAlert {
  id: string;
  hostname: string;
  title: string;
  severity: "critical" | "warning" | "healthy";
  timestamp: number;
}
