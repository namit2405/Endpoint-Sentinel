import type { EndpointStatus } from "@/lib/types";
import { useEndpoints } from "@/lib/useEndpoints";
import { useMemo } from "react";

export type MetricKey = "cpu" | "memory" | "disk";

export interface HistoryPoint {
  time: string;
  [hostname: string]: string | number;
}

export interface TrendPoint {
  time: string;
  value: number;
}

export interface LiveAlert {
  id: string;
  hostname: string;
  mac: string;
  metric: MetricKey;
  value: number;
  threshold: number;
}

export interface UseLiveMetricsOptions {
  /** When true, the underlying mock data source reports a failure so the page can exercise its error + retry path. */
  simulateFailure?: boolean;
}

export interface LiveMetricsResult {
  endpoints: EndpointStatus[];
  averages: Record<MetricKey, number>;
  onlineCount: number;
  top5: Record<MetricKey, string[]>;
  history60: Record<MetricKey, HistoryPoint[]>;
  trend24: Record<MetricKey, TrendPoint[]>;
  onlineTrend: TrendPoint[];
  alerts: LiveAlert[];
  isRefreshing: boolean;
  lastRefreshed: number;
  refresh: () => void;
  error: string | null;
  retry: () => void;
}

const MIN = 60_000;
const METRICS: MetricKey[] = ["cpu", "memory", "disk"];
const THRESHOLDS: Record<MetricKey, number> = { cpu: 90, memory: 85, disk: 90 };

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return h;
}

function seededNoise(seed: number, i: number): number {
  const x = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function metricValue(e: EndpointStatus, metric: MetricKey): number {
  switch (metric) {
    case "cpu":
      return e.cpu_percent;
    case "memory":
      return e.memory_percent;
    case "disk":
      return e.disk_percent;
  }
}

/** Deterministic 0-100 series that drifts around `current` and ends exactly at it. */
function buildSeries(current: number, seed: number, points: number): number[] {
  const values: number[] = [];
  for (let i = 0; i < points; i++) {
    const t = i / (points - 1);
    const drift = (1 - t) * (seededNoise(seed, i) * 24 - 12);
    values.push(Math.max(0, Math.min(100, Math.round(current + drift))));
  }
  return values;
}

function timeLabels(points: number, intervalMin: number): string[] {
  const now = Date.now();
  const labels: string[] = [];
  for (let i = 0; i < points; i++) {
    const t = now - (points - 1 - i) * intervalMin * MIN;
    labels.push(
      new Date(t).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
    );
  }
  return labels;
}

/**
 * Consumes the existing endpoint data source (via useEndpoints, which
 * auto-refreshes every 10s) and synthesizes 60-minute history series
 * (5-min intervals), 24-hour trend series, computed averages, online count,
 * and derived threshold alerts. Series are regenerated from current values on
 * each refresh and are never persisted across reloads.
 */
export function useLiveMetrics(
  options: UseLiveMetricsOptions = {},
): LiveMetricsResult {
  const { endpoints, isRefreshing, lastRefreshed, refresh, error, retry } =
    useEndpoints(10_000, options);

  const derived = useMemo(() => {
    const averages = { cpu: 0, memory: 0, disk: 0 } as Record<
      MetricKey,
      number
    >;
    if (endpoints.length > 0) {
      for (const metric of METRICS) {
        averages[metric] = Math.round(
          endpoints.reduce((sum, e) => sum + metricValue(e, metric), 0) /
            endpoints.length,
        );
      }
    }

    const onlineCount = endpoints.filter(
      (e) =>
        e.health_status !== "critical" && e.last_seen > Date.now() - 2 * MIN,
    ).length;

    const top5 = {} as Record<MetricKey, string[]>;
    for (const metric of METRICS) {
      top5[metric] = [...endpoints]
        .sort((a, b) => metricValue(b, metric) - metricValue(a, metric))
        .slice(0, 5)
        .map((e) => e.hostname);
    }

    const histLabels = timeLabels(13, 5);
    const history60 = {} as Record<MetricKey, HistoryPoint[]>;
    for (const metric of METRICS) {
      history60[metric] = histLabels.map((time, i) => {
        const point: HistoryPoint = { time };
        for (const e of endpoints) {
          if (!top5[metric].includes(e.hostname)) continue;
          const seed = hash(`${e.hostname}-${metric}`);
          point[e.hostname] = buildSeries(metricValue(e, metric), seed, 13)[i];
        }
        return point;
      });
    }

    const trendLabels = timeLabels(24, 60);
    const trend24 = {} as Record<MetricKey, TrendPoint[]>;
    for (const metric of METRICS) {
      trend24[metric] = trendLabels.map((time, i) => ({
        time,
        value: buildSeries(averages[metric], hash(`avg-${metric}`), 24)[i],
      }));
    }

    const onlineTrend: TrendPoint[] = trendLabels.map((time, i) => ({
      time,
      value: buildSeries(onlineCount, hash("online"), 24)[i],
    }));

    const alerts: LiveAlert[] = [];
    for (const e of endpoints) {
      for (const metric of METRICS) {
        const value = metricValue(e, metric);
        const threshold = THRESHOLDS[metric];
        if (value > threshold) {
          const series = buildSeries(
            value,
            hash(`${e.hostname}-${metric}`),
            13,
          );
          const sustained = series.slice(-2).every((v) => v > threshold);
          if (sustained) {
            alerts.push({
              id: `${e.mac_address}-${metric}`,
              hostname: e.hostname,
              mac: e.mac_address,
              metric,
              value,
              threshold,
            });
          }
        }
      }
    }

    return {
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
      error,
    };
  }, [endpoints, isRefreshing, lastRefreshed, error]);

  return { ...derived, refresh, retry };
}
