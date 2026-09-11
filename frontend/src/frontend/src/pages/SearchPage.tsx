import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { healthStatusBg, riskScoreBg, timeAgo } from "@/lib/format";
import type { EndpointStatus, OS, RiskLevel } from "@/lib/types";
import { useEndpoints } from "@/lib/useEndpoints";
import { cn } from "@/lib/utils";
import { Link } from "@tanstack/react-router";
import { Search, Server, ShieldAlert, X } from "lucide-react";
import { useMemo, useState } from "react";

const QUICK_LINKS = [
  { label: "firewall disabled", hint: "Endpoints with firewall off" },
  { label: "updates>20", hint: "More than 20 pending updates" },
  { label: "Windows systems", hint: "All Windows endpoints" },
];

const OS_OPTIONS: Array<OS | "all"> = ["all", "Windows", "Linux", "macOS"];
const RISK_OPTIONS: Array<RiskLevel | "all"> = ["all", "low", "medium", "high"];
const LAST_SEEN_OPTIONS = [
  { value: "all", label: "Any time" },
  { value: "hour", label: "Last hour" },
  { value: "day", label: "Last 24 hours" },
  { value: "week", label: "Last 7 days" },
];

interface Match {
  endpoint: EndpointStatus;
  score: number;
  matchedField: string;
}

/** Parse a query into structured predicates plus a general text fragment. */
function parseQuery(raw: string): {
  firewallDisabled: boolean;
  minUpdates: number | null;
  os: OS | null;
  risk: RiskLevel | null;
  text: string;
} {
  const q = raw.trim().toLowerCase();
  let firewallDisabled = false;
  let minUpdates: number | null = null;
  let os: OS | null = null;
  let risk: RiskLevel | null = null;

  // "firewall disabled" / "firewall off" / "firewall"
  if (/\bfirewall\b/.test(q) && /disabled|off|inactive|down/.test(q)) {
    firewallDisabled = true;
  }

  // "updates>20" or "updates > 20"
  const updatesMatch = q.match(/updates?\s*>\s*(\d+)/);
  if (updatesMatch) {
    minUpdates = Number(updatesMatch[1]);
  }

  // OS names
  if (/\bwindows\b/.test(q)) os = "Windows";
  else if (/\blinux\b/.test(q)) os = "Linux";
  else if (/\bmac\b|\bmacos\b/.test(q)) os = "macOS";

  // Risk levels
  if (/\bhigh\s*risk\b|\brisk\s*:\s*high\b/.test(q)) risk = "high";
  else if (/\bmedium\s*risk\b|\brisk\s*:\s*medium\b/.test(q)) risk = "medium";
  else if (/\blow\s*risk\b|\brisk\s*:\s*low\b/.test(q)) risk = "low";

  return { firewallDisabled, minUpdates, os, risk, text: q };
}

/** Score an endpoint against a parsed query. Returns null when it does not match. */
function scoreEndpoint(
  endpoint: EndpointStatus,
  parsed: ReturnType<typeof parseQuery>,
): Match | null {
  const { firewallDisabled, minUpdates, os, risk, text } = parsed;
  const audit = endpoint.audit;

  // Structured predicates always win when present.
  if (firewallDisabled) {
    const disabled = !endpoint.firewall_active || !audit.security.firewall;
    if (!disabled) return null;
    return { endpoint, score: 1000, matchedField: "Firewall disabled" };
  }
  if (minUpdates !== null) {
    if (audit.pendingUpdates <= minUpdates) return null;
    return {
      endpoint,
      score: 900 + Math.min(audit.pendingUpdates, 100),
      matchedField: `${audit.pendingUpdates} pending updates`,
    };
  }
  if (os) {
    if (endpoint.os !== os) return null;
    return { endpoint, score: 800, matchedField: `${os} system` };
  }
  if (risk) {
    if (audit.riskLevel !== risk) return null;
    return { endpoint, score: 700, matchedField: `${risk} risk` };
  }

  // General text search with relevance scoring.
  if (!text) return null;
  const terms = text.split(/\s+/).filter(Boolean);
  let score = 0;
  let matchedField = "";
  for (const term of terms) {
    if (endpoint.hostname.toLowerCase().includes(term)) {
      score += 100;
      matchedField = "Hostname";
    }
    if (endpoint.ip_address.toLowerCase().includes(term)) {
      score += 90;
      matchedField = "IP address";
    }
    if (endpoint.mac_address.toLowerCase().includes(term)) {
      score += 90;
      matchedField = "MAC address";
    }
    if (audit.hardware.cpuModel.toLowerCase().includes(term)) {
      score += 60;
      matchedField = "CPU model";
    }
    if (endpoint.os.toLowerCase().includes(term)) {
      score += 50;
      matchedField = "OS";
    }
    if (audit.riskLevel.toLowerCase().includes(term)) {
      score += 40;
      matchedField = "Risk level";
    }
  }
  if (score === 0) return null;
  return { endpoint, score, matchedField };
}

/** Build autocomplete suggestions from the fleet for a raw query. */
function buildSuggestions(endpoints: EndpointStatus[], raw: string): string[] {
  const q = raw.trim().toLowerCase();
  if (!q) return [];
  const suggestions = new Set<string>();
  for (const e of endpoints) {
    if (e.hostname.toLowerCase().includes(q)) suggestions.add(e.hostname);
    if (e.ip_address.toLowerCase().includes(q)) suggestions.add(e.ip_address);
    if (e.mac_address.toLowerCase().includes(q)) suggestions.add(e.mac_address);
    if (e.os.toLowerCase().includes(q)) suggestions.add(e.os);
    if (e.audit.riskLevel.toLowerCase().includes(q))
      suggestions.add(`${e.audit.riskLevel} risk`);
  }
  return Array.from(suggestions).slice(0, 6);
}

function matchesLastSeen(
  endpoint: EndpointStatus,
  window: string,
  now: number,
): boolean {
  if (window === "all") return true;
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;
  const limit = window === "hour" ? HOUR : window === "day" ? DAY : 7 * DAY;
  return now - endpoint.last_seen <= limit;
}

export default function SearchPage() {
  const { endpoints } = useEndpoints();
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [osFilter, setOsFilter] = useState<OS | "all">("all");
  const [riskFilter, setRiskFilter] = useState<RiskLevel | "all">("all");
  const [lastSeenFilter, setLastSeenFilter] = useState("all");
  const [focused, setFocused] = useState(false);

  const now = Date.now();
  const suggestions = useMemo(
    () => buildSuggestions(endpoints, query),
    [endpoints, query],
  );

  const results = useMemo(() => {
    if (!activeQuery.trim()) return [];
    const parsed = parseQuery(activeQuery);
    return endpoints
      .map((e) => scoreEndpoint(e, parsed))
      .filter((m): m is Match => m !== null)
      .filter((m) => {
        if (osFilter !== "all" && m.endpoint.os !== osFilter) return false;
        if (riskFilter !== "all" && m.endpoint.audit.riskLevel !== riskFilter)
          return false;
        if (!matchesLastSeen(m.endpoint, lastSeenFilter, now)) return false;
        return true;
      })
      .sort((a, b) => b.score - a.score);
  }, [endpoints, activeQuery, osFilter, riskFilter, lastSeenFilter, now]);

  const runSearch = (value: string) => {
    setQuery(value);
    setActiveQuery(value);
    setFocused(false);
  };

  const clearSearch = () => {
    setQuery("");
    setActiveQuery("");
  };

  const hasActiveSearch = activeQuery.trim().length > 0;
  const hasFilters =
    osFilter !== "all" || riskFilter !== "all" || lastSeenFilter !== "all";

  return (
    <div className="space-y-6">
      {/* Search box */}
      <section
        aria-label="Search endpoints"
        className="rounded-xl border border-border bg-card p-5 shadow-subtle md:p-6"
      >
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter") runSearch(query);
            }}
            placeholder="Search hostname, IP, MAC, CPU, OS, risk…"
            aria-label="Search endpoints"
            data-ocid="search.input"
            className="h-12 pl-11 pr-10 text-base"
          />
          {query && (
            <button
              type="button"
              onClick={clearSearch}
              aria-label="Clear search"
              data-ocid="search.clear_button"
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Autocomplete suggestions */}
        {focused && query && suggestions.length > 0 && (
          <ul
            data-ocid="search.suggestions"
            className="mt-2 overflow-hidden rounded-lg border border-border bg-popover shadow-subtle"
          >
            {suggestions.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    runSearch(s);
                  }}
                  className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                >
                  <Search
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span className="font-mono">{s}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Quick links */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Try
          </span>
          {QUICK_LINKS.map((link) => (
            <button
              key={link.label}
              type="button"
              onClick={() => runSearch(link.label)}
              title={link.hint}
              data-ocid={`search.quick_link.${link.label.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`}
              className="rounded-full border border-border bg-muted/40 px-3 py-1.5 font-mono text-xs text-foreground transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {link.label}
            </button>
          ))}
        </div>
      </section>

      {/* Filters + results */}
      {hasActiveSearch && (
        <section aria-label="Search results" className="space-y-4">
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-subtle md:flex-row md:items-center md:justify-between">
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">
                {results.length}
              </span>{" "}
              result{results.length === 1 ? "" : "s"} for{" "}
              <span className="font-mono text-foreground">“{activeQuery}”</span>
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={osFilter}
                onValueChange={(v) => setOsFilter(v as OS | "all")}
              >
                <SelectTrigger
                  className="h-9 w-[150px]"
                  aria-label="Filter by OS"
                  data-ocid="search.filter.os"
                >
                  <SelectValue placeholder="OS" />
                </SelectTrigger>
                <SelectContent>
                  {OS_OPTIONS.map((o) => (
                    <SelectItem key={o} value={o}>
                      {o === "all" ? "All OS" : o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={riskFilter}
                onValueChange={(v) => setRiskFilter(v as RiskLevel | "all")}
              >
                <SelectTrigger
                  className="h-9 w-[150px]"
                  aria-label="Filter by risk"
                  data-ocid="search.filter.risk"
                >
                  <SelectValue placeholder="Risk" />
                </SelectTrigger>
                <SelectContent>
                  {RISK_OPTIONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r === "all"
                        ? "All risk"
                        : `${r[0].toUpperCase()}${r.slice(1)} risk`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={lastSeenFilter} onValueChange={setLastSeenFilter}>
                <SelectTrigger
                  className="h-9 w-[150px]"
                  aria-label="Filter by last seen"
                  data-ocid="search.filter.last_seen"
                >
                  <SelectValue placeholder="Last seen" />
                </SelectTrigger>
                <SelectContent>
                  {LAST_SEEN_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {hasFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setOsFilter("all");
                    setRiskFilter("all");
                    setLastSeenFilter("all");
                  }}
                  data-ocid="search.clear_filters_button"
                >
                  Clear filters
                </Button>
              )}
            </div>
          </div>

          {/* Results list */}
          {results.length === 0 ? (
            <div
              data-ocid="search.empty_state"
              className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 py-16 text-center shadow-subtle"
            >
              <div className="flex size-12 items-center justify-center rounded-full bg-muted">
                <ShieldAlert
                  className="size-6 text-muted-foreground"
                  aria-hidden="true"
                />
              </div>
              <h3 className="mt-4 font-display text-lg font-bold text-foreground">
                No endpoints found
              </h3>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                No endpoints match “{activeQuery}” with the current filters. Try
                a different search term or clear the filters.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => {
                  setOsFilter("all");
                  setRiskFilter("all");
                  setLastSeenFilter("all");
                }}
                data-ocid="search.empty_reset_button"
              >
                Clear filters
              </Button>
            </div>
          ) : (
            <ul className="space-y-3" data-ocid="search.results">
              {results.map(({ endpoint, matchedField }, index) => (
                <li key={endpoint.mac_address}>
                  <Link
                    to="/endpoints/$mac"
                    params={{ mac: endpoint.mac_address }}
                    data-ocid={`search.result.${index + 1}`}
                    className="group block rounded-xl border border-border bg-card p-4 shadow-subtle transition-colors hover:border-primary/40 hover:bg-accent/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:p-5"
                  >
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <Server className="size-5" aria-hidden="true" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="truncate font-mono text-base font-semibold text-foreground">
                              {endpoint.hostname}
                            </h3>
                            <Badge
                              variant="secondary"
                              className="font-mono text-[11px]"
                            >
                              {endpoint.os}
                            </Badge>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            <span className="font-mono">
                              {endpoint.ip_address}
                            </span>
                            <span className="font-mono">
                              {endpoint.mac_address}
                            </span>
                            <span className="truncate">
                              {endpoint.audit.hardware.cpuModel}
                            </span>
                          </div>
                          <p className="mt-1.5 text-xs text-muted-foreground">
                            Matched on{" "}
                            <span className="font-medium text-foreground">
                              {matchedField}
                            </span>
                          </p>
                        </div>
                      </div>

                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
                            riskScoreBg(endpoint.audit.riskScore),
                          )}
                        >
                          {endpoint.audit.riskScore} risk
                        </span>
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize",
                            healthStatusBg(endpoint.health_status),
                          )}
                        >
                          {endpoint.health_status}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {timeAgo(endpoint.last_seen, now)}
                        </span>
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Initial state */}
      {!hasActiveSearch && (
        <div
          data-ocid="search.initial_state"
          className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 py-16 text-center shadow-subtle"
        >
          <div className="flex size-12 items-center justify-center rounded-full bg-primary/10">
            <Search className="size-6 text-primary" aria-hidden="true" />
          </div>
          <h3 className="mt-4 font-display text-lg font-bold text-foreground">
            Discover endpoints across your fleet
          </h3>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            Search by hostname, IP address, MAC address, CPU model, operating
            system, or risk level. Use the example searches above to get
            started.
          </p>
        </div>
      )}
    </div>
  );
}
