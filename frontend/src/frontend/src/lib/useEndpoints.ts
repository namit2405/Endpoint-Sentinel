import { useEffect, useMemo, useState } from "react";
import {
  fetchEndpoints,
  getDashboardSummary,
  getQuickAlerts,
  getHealthTrend,
  getOSDistribution,
} from "./endpoints";
import type { DashboardSummary, EndpointStatus, QuickAlert } from "./types";

export interface UseEndpointsOptions {
  /** When true, simulate a data fetch failure for testing error handling. */
  simulateFailure?: boolean;
}

export interface UseEndpointsResult {
  endpoints: EndpointStatus[];
  summary: DashboardSummary;
  lastRefreshed: number;
  isRefreshing: boolean;
  hasLoaded: boolean;
  refresh: () => void;
  error: string | null;
  retry: () => void;
}

/**
 * Provides the endpoint fleet from the Django backend, derived dashboard summary,
 * and auto-refresh. Fetches real data from the backend instead of using mock data.
 */
export function useEndpoints(
  refreshIntervalMs = 10_000,
  options: UseEndpointsOptions = {},
): UseEndpointsResult {
  const { simulateFailure = false } = options;
  const [endpoints, setEndpoints] = useState<EndpointStatus[]>([]);
  const [lastRefreshed, setLastRefreshed] = useState(() => Date.now());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch endpoints from backend
  const loadEndpoints = async () => {
    if (simulateFailure) {
      setError("Unable to reach the monitoring service.");
      setEndpoints([]);
      return;
    }

    try {
      setIsRefreshing(true);
      setError(null);
      const data = await fetchEndpoints();
      setEndpoints(data);
      setLastRefreshed(Date.now());
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to fetch endpoints from backend",
      );
      setEndpoints([]);
    } finally {
      setHasLoaded(true);
      setIsRefreshing(false);
    }
  };

  // Initial load and auto-refresh
  useEffect(() => {
    loadEndpoints();
    const id = window.setInterval(loadEndpoints, refreshIntervalMs);
    return () => window.clearInterval(id);
  }, [refreshIntervalMs, simulateFailure]);

  const summary = useMemo<DashboardSummary>(
    () => getDashboardSummary(endpoints),
    [endpoints],
  );

  const refresh = () => {
    loadEndpoints();
  };

  const retry = () => {
    setError(null);
    loadEndpoints();
  };

  return {
    endpoints,
    summary,
    lastRefreshed,
    isRefreshing,
    hasLoaded,
    refresh,
    error,
    retry,
  };
}
