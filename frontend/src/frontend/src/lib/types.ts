export type OS = "Windows" | "Linux" | "macOS";

export interface ServiceInfo {
  name: string;
  display?: string;
  status: string;
}

export interface PortInfo {
  address: string;
  port: string | number;
  process: string;
}

export interface SoftwareInfo {
  name: string;
  version?: string;
  publisher?: string;
}

export interface UserInfo {
  name: string;
  enabled?: boolean;
  pwd_never_expires?: boolean;
}

export interface TaskInfo {
  name: string;
  path?: string;
  state?: string;
}

export interface PatchInfo {
  id: string;
  description?: string;
  installed_on?: string;
}

export interface RawData {
  // Windows
  running_services?: ServiceInfo[] | string[];
  open_ports?: PortInfo[];
  installed_software?: SoftwareInfo[];
  browser_extensions?: Array<{ browser: string; id: string }>;
  admin_accounts?: string[];
  all_users?: UserInfo[];
  scheduled_tasks?: TaskInfo[];
  installed_patches?: PatchInfo[];
  // Linux
  world_writable_dirs?: number;
  network_shares?: string[];
  network_listeners?: string[];
  installed_packages_count?: number;
}

export type HealthStatus = "healthy" | "warning" | "critical";

export interface ProcessInfo {
  name: string;
  display_name?: string;
  pid: number;
  cpu_percent: number;
  memory_mb: number;
}

export type RiskLevel = "low" | "medium" | "high";

export type ConnectionStatus = "online" | "warning" | "offline";

export type DeviceType = "physical" | "vm" | "container";

export interface SecurityProduct {
  name: string;
  enabled: boolean;
  up_to_date: boolean;
}

export interface DiskDetail {
  drive: string;
  total_gb: number;
  used_gb: number;
  free_gb: number;
  percent: number;
}

export interface SecurityControls {
  firewall: boolean | null;
  encryption: boolean | null;
  antivirus: boolean | null;
  secureBoot: boolean | null;
  tpm: boolean | null;
  ssh: boolean | null;
  auditd: boolean | null;
  passwordlessSudo: boolean | null;
  sip: boolean | null;
  gatekeeper: boolean | null;
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
  raw_data?: RawData;
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
  wol_enabled: boolean | null;
  device_type: DeviceType;
  firewall_active: boolean;
  antivirus_active: boolean;
  firewall_products: SecurityProduct[];
  antivirus_products: SecurityProduct[];
  disk_details: DiskDetail[];
  running_apps: ProcessInfo[];
  installed_apps: SoftwareInfo[];
  process_count: number | null;
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
  description: string;
  severity: "critical" | "warning" | "healthy";
  timestamp: number;
}

export interface WatchGuardDevice {
  id: string;
  hostname: string;
  device_type: "desktop" | "laptop" | "server";
  os: string;
  ip_address: string;
  mac_address: string;
  last_seen: string;
  user: string;
  protection_status: "protected" | "error" | "isolated" | "unknown";
  encryption: "none" | "BitLocker" | "BitLocker+TPM";
  site: string;
  agent_version: string;
  policy: string;
  domain: string;
  group_path: string;
  ad_path: string;
  reboot_requested: boolean;
  reinstall_protection: boolean;
  reinstall_agent: boolean;
  isolation_state: number;
  platform_id: number;
}

export interface WatchGuardDevicesResponse {
  devices: WatchGuardDevice[];
  total: number;
  assigned_licenses?: number;
  unassigned_licenses?: number;
  timestamp: string;
  error?: string;
}
