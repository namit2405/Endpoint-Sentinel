/**
 * API Client for Django Backend
 * Handles all communication with the Endpoint Sentinel backend.
 */

import { getStoredAccountType } from "./auth";
import type {
  DashboardSummary,
  EndpointStatus,
  HealthTrendPoint,
  OSDistribution,
  QuickAlert,
} from "./types";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:8001";

interface ApiResponse<T> {
  data: T;
  error?: string;
  timestamp?: string;
}

class APIClient {
  private baseUrl: string;
  private token: string | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
    // Try to load token from storage
    try {
      this.token = window.localStorage.getItem("sentinel.auth.token");
    } catch {
      // Storage not available
    }
  }

  setToken(token: string | null) {
    this.token = token;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.token) {
      headers["Authorization"] = `Token ${this.token}`;
    }
    const accountType = getStoredAccountType();
    if (accountType) {
      headers["X-Account-Type"] = accountType;
    }
    return headers;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        ...this.getHeaders(),
        ...options.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.statusText}`);
    }

    return response.json();
  }

  async downloadAuditReport(reportId: number): Promise<Blob> {
    const response = await fetch(
      `${this.baseUrl}/api/dashboard/machine/${reportId}/download/`,
      { headers: this.getHeaders() },
    );
    if (!response.ok) {
      throw new Error(`API Error: ${response.statusText}`);
    }
    return response.blob();
  }

  // ── Dashboard Overview ──────────────────────────────────────────────
  async getDashboardOverview(): Promise<{
    summary: {
      total: number;
      windows: number;
      linux: number;
      macos: number;
    };
    risk: {
      healthy: number;
      warning: number;
      critical: number;
      compliance_pct: number;
      avg_score: number;
    };
    security_controls: {
      firewall: { enabled: number; disabled: number; unknown: number };
      antivirus: { enabled: number; disabled: number; unknown: number };
      encryption: { enabled: number; disabled: number; unknown: number };
      secure_boot: { enabled: number; disabled: number; unknown: number };
    };
    updates: {
      "0_to_5": number;
      "6_to_20": number;
      "20_plus": number;
      unknown: number;
    };
    remote_access: {
      anydesk: number;
      teamviewer: number;
      chrome_remote_desktop: number;
      rdp: number;
    };
    critical_machines: Array<{
      id: number;
      hostname: string;
      risk_score: number;
      risk_level: string;
    }>;
    heartbeat: {
      total: number;
      online: number;
      warning: number;
      offline: number;
    };
  }> {
    return this.request("/api/dashboard/overview/");
  }

  // ── Inventory ────────────────────────────────────────────────────────
  async getInventory(filters?: {
    os?: string;
    risk?: string;
    firewall?: string;
    antivirus?: string;
    encryption?: string;
    q?: string;
  }): Promise<{
    machines: Array<any>;
    total: number;
    filters: Record<string, string>;
  }> {
    const params = new URLSearchParams();
    if (filters?.os) params.append("os", filters.os);
    if (filters?.risk) params.append("risk", filters.risk);
    if (filters?.firewall) params.append("firewall", filters.firewall);
    if (filters?.antivirus) params.append("antivirus", filters.antivirus);
    if (filters?.encryption) params.append("encryption", filters.encryption);
    if (filters?.q) params.append("q", filters.q);

    const query = params.toString();
    return this.request(`/api/dashboard/inventory/${query ? "?" + query : ""}`);
  }

  // ── Machine Detail ──────────────────────────────────────────────────
  async getMachineDetail(id: number): Promise<{
    report: any;
    history: Array<any>;
    score_history: Array<any>;
    findings: Array<any>;
    endpoint_status: any;
  }> {
    return this.request(`/api/dashboard/machine/${id}/`);
  }

  // ── Compare Endpoints ───────────────────────────────────────────────
  async compareEndpoints(
    idA: number,
    idB: number,
  ): Promise<{
    all_machines: Array<{ id: number; hostname: string }>;
    report_a: any | null;
    report_b: any | null;
    id_a: string;
    id_b: string;
    rows: Array<{
      label: string;
      val_a: unknown;
      val_b: unknown;
      differ: boolean;
    }>;
  }> {
    const params = new URLSearchParams({
      a: idA.toString(),
      b: idB.toString(),
    });
    return this.request(`/api/dashboard/compare/?${params}`);
  }

  // ── Search ──────────────────────────────────────────────────────────
  async searchEndpoints(query: string): Promise<{
    q: string;
    results: Array<any>;
    count: number | null;
  }> {
    const params = new URLSearchParams({ q: query });
    return this.request(`/api/dashboard/search/?${params}`);
  }

  // ── Current Metrics (Real-time) ─────────────────────────────────────
  async getCurrentMetrics(): Promise<{
    endpoints: Array<{
      id: number;
      hostname: string;
      mac_address: string;
      presence: string;
      cpu_percent: number | null;
      memory_percent: number | null;
      disk_percent: number | null;
      firewall_active: boolean | null;
      antivirus_active: boolean | null;
      health_status: string;
      health_score: number;
      last_health_check: string | null;
      last_seen: string | null;
    }>;
    timestamp: string;
    count: number;
  }> {
    return this.request("/api/endpoints/current/");
  }

  // ── Historical Metrics ──────────────────────────────────────────────
  async getMetricsHistory(
    hostname: string,
    options?: {
      limit?: number;
      hours?: number;
      interval?: number;
    },
  ): Promise<{
    hostname: string;
    mac_address: string;
    history: Array<{
      timestamp: string;
      cpu_percent: number;
      memory_percent: number;
      disk_percent: number;
      health_status: string;
      health_score: number;
      firewall_active: boolean | null;
      antivirus_active: boolean | null;
    }>;
    count: number;
    timestamp: string;
  }> {
    const params = new URLSearchParams();
    if (options?.limit) params.append("limit", options.limit.toString());
    if (options?.hours) params.append("hours", options.hours.toString());
    if (options?.interval) params.append("interval", options.interval.toString());

    const query = params.toString();
    return this.request(
      `/api/endpoints/${hostname}/history/${query ? "?" + query : ""}`,
    );
  }

  // ── Health History (Fleet-wide) ─────────────────────────────────────
  async getHealthHistory(options?: {
    limit?: number;
    hours?: number;
    mac_address?: string;
    health?: string;
  }): Promise<{
    endpoints: Array<{
      hostname: string;
      mac_address: string;
      presence: string;
      health_status: string;
      health_score: number;
      history: Array<{
        timestamp: string;
        cpu_percent: number;
        memory_percent: number;
        disk_percent: number;
        health_status: string;
        health_score: number;
        firewall_active: boolean | null;
        antivirus_active: boolean | null;
      }>;
      history_count: number;
    }>;
    timestamp: string;
    count: number;
  }> {
    const params = new URLSearchParams();
    if (options?.limit) params.append("limit", options.limit.toString());
    if (options?.hours) params.append("hours", options.hours.toString());
    if (options?.mac_address) params.append("mac_address", options.mac_address);
    if (options?.health) params.append("health", options.health);

    const query = params.toString();
    return this.request(
      `/api/endpoints/health-history/${query ? "?" + query : ""}`,
    );
  }

  // ── Endpoint Status (Live) ──────────────────────────────────────────
  async getEndpointStatus(): Promise<{
    endpoints: Array<{
      id: number;
      hostname: string;
      mac_address: string;
      os: string;
      ip_address: string;
      presence: string;
      health_status: string;
      health_score: number;
      cpu_percent: number | null;
      memory_percent: number | null;
      disk_percent: number | null;
      last_seen: string;
      last_health_check: string | null;
    }>;
    timestamp: string;
    count: number;
  }> {
    return this.request("/api/endpoints/status/");
  }

  async fetchLatestReports(): Promise<{ status: string; message: string }> {
    return this.request("/api/dashboard/fetch-latest/", { method: "POST" });
  }
}

export const apiClient = new APIClient(API_BASE_URL);
