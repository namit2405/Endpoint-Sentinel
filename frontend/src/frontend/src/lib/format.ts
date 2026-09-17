import type { ConnectionStatus, HealthStatus, RiskLevel } from "./types";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Human-readable "time ago" string, e.g. "3 sec ago", "2 min ago", "5 hr ago". */
export function timeAgo(timestamp: number, now = Date.now()): string {
  const diff = Math.max(0, now - timestamp);
  if (diff < MIN) {
    const sec = Math.max(1, Math.floor(diff / 1000));
    return `${sec} sec ago`;
  }
  if (diff < HOUR) {
    const min = Math.floor(diff / MIN);
    return `${min} min ago`;
  }
  if (diff < DAY) {
    const hr = Math.floor(diff / HOUR);
    return `${hr} hr ago`;
  }
  const days = Math.floor(diff / DAY);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** Format a 0-100 value as a percentage string. */
export function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

/** Format a duration in milliseconds as a human-readable uptime string. */
export function formatUptime(ms: number): string {
  if (ms <= 0) return "—";
  const days = Math.floor(ms / DAY);
  const hours = Math.floor((ms % DAY) / HOUR);
  if (days > 0) return `${days}d ${hours}h`;
  const mins = Math.floor((ms % HOUR) / MIN);
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m`;
  return `${Math.max(1, Math.floor(ms / 1000))}s`;
}

/** Map a health status to a semantic color token. */
export function healthStatusColor(status: HealthStatus): string {
  switch (status) {
    case "healthy":
      return "text-success";
    case "warning":
      return "text-warning";
    case "critical":
      return "text-destructive";
  }
}

/** Map a connection status to a semantic color token. */
export function connectionStatusColor(status: ConnectionStatus): string {
  switch (status) {
    case "online":
      return "text-success";
    case "warning":
      return "text-warning";
    case "offline":
      return "text-destructive";
  }
}

/** Map a risk level to a semantic color token. */
export function riskLevelColor(level: RiskLevel): string {
  switch (level) {
    case "low":
      return "text-success";
    case "medium":
      return "text-warning";
    case "high":
      return "text-destructive";
  }
}

/** Map a risk score (0-100) to a semantic color token: green 0-30, yellow 31-70, red 71-100. */
export function riskScoreColor(score: number): string {
  if (score <= 30) return "text-success";
  if (score <= 70) return "text-warning";
  return "text-destructive";
}

/** Map a risk score (0-100) to a semantic background token for badges. */
export function riskScoreBg(score: number): string {
  if (score <= 30) return "bg-success/15 text-success";
  if (score <= 70) return "bg-warning/15 text-warning";
  return "bg-destructive/15 text-destructive";
}

/** Map a health status to a semantic background token for pill badges. */
export function healthStatusBg(status: HealthStatus): string {
  switch (status) {
    case "healthy":
      return "bg-success/15 text-success";
    case "warning":
      return "bg-warning/15 text-warning";
    case "critical":
      return "bg-destructive/15 text-destructive";
  }
}

/** Map a connection status to a semantic background token for pill badges. */
export function connectionStatusBg(status: ConnectionStatus): string {
  switch (status) {
    case "online":
      return "bg-success/15 text-success";
    case "warning":
      return "bg-warning/15 text-warning";
    case "offline":
      return "bg-destructive/15 text-destructive";
  }
}

/** Map a risk score to a progress-bar color token. */
export function riskBarColor(score: number): string {
  if (score <= 30) return "bg-success";
  if (score <= 70) return "bg-warning";
  return "bg-destructive";
}

/** Map a utilization percentage to a progress-bar color token. */
export function utilizationBarColor(value: number): string {
  if (value <= 70) return "bg-primary";
  if (value <= 85) return "bg-warning";
  return "bg-destructive";
}
