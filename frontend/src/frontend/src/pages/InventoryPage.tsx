import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatPercent,
  riskScoreBg,
  riskScoreColor,
  timeAgo,
} from "@/lib/format";
import type { EndpointStatus, OS, RiskLevel } from "@/lib/types";
import { useEndpoints } from "@/lib/useEndpoints";
import { Link } from "@tanstack/react-router";
import {
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Download,
  Filter,
  Search,
  Server,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type SortKey = "risk" | "lastSeen" | "cpu" | "memory";
type SortDir = "asc" | "desc";

interface Filters {
  os: OS | "all";
  risk: RiskLevel | "all";
  firewall: "all" | "on" | "off";
  antivirus: "all" | "on" | "off";
  cpuModel: string;
  ramMin: number;
  ramMax: number;
  diskMin: number;
  diskMax: number;
}

const DEFAULT_FILTERS: Filters = {
  os: "all",
  risk: "all",
  firewall: "all",
  antivirus: "all",
  cpuModel: "",
  ramMin: 0,
  ramMax: 256,
  diskMin: 0,
  diskMax: 100,
};

const OS_OPTIONS: OS[] = ["Windows", "Linux", "macOS"];
const RISK_OPTIONS: RiskLevel[] = ["low", "medium", "high"];

function riskLabel(level: RiskLevel): string {
  switch (level) {
    case "low":
      return "Low";
    case "medium":
      return "Medium";
    case "high":
      return "High";
  }
}

function matchesFilters(e: EndpointStatus, f: Filters): boolean {
  if (f.os !== "all" && e.os !== f.os) return false;
  if (f.risk !== "all" && e.audit.riskLevel !== f.risk) return false;
  if (f.firewall === "on" && !e.firewall_active) return false;
  if (f.firewall === "off" && e.firewall_active) return false;
  if (f.antivirus === "on" && !e.antivirus_active) return false;
  if (f.antivirus === "off" && e.antivirus_active) return false;
  if (
    f.cpuModel &&
    !e.audit.hardware.cpuModel.toLowerCase().includes(f.cpuModel.toLowerCase())
  )
    return false;
  const ram = e.audit.hardware.ramGb;
  if (ram < f.ramMin || ram > f.ramMax) return false;
  const disk = e.audit.hardware.diskPercent;
  if (disk < f.diskMin || disk > f.diskMax) return false;
  return true;
}

function sortValue(e: EndpointStatus, key: SortKey): number {
  switch (key) {
    case "risk":
      return e.audit.riskScore;
    case "lastSeen":
      return e.last_seen;
    case "cpu":
      return e.cpu_percent;
    case "memory":
      return e.memory_percent;
  }
}

function toCsv(endpoints: EndpointStatus[]): string {
  const header = [
    "Hostname",
    "OS",
    "IP",
    "MAC",
    "CPU Cores",
    "CPU Model",
    "RAM (GB)",
    "Updates Pending",
    "Risk Score",
    "Risk Level",
    "Last Audit",
  ];
  const rows = endpoints.map((e) => [
    e.hostname,
    e.os,
    e.ip_address,
    e.mac_address,
    String(e.audit.hardware.cpuCores),
    e.audit.hardware.cpuModel,
    String(e.audit.hardware.ramGb),
    String(e.audit.pendingUpdates),
    String(e.audit.riskScore),
    riskLabel(e.audit.riskLevel),
    e.audit.reportDate,
  ]);
  const csvEscape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return [header, ...rows].map((r) => r.map(csvEscape).join(",")).join("\n");
}

export default function InventoryPage() {
  const { endpoints, isRefreshing } = useEndpoints();
  const [search, setSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [sortKey, setSortKey] = useState<SortKey>("risk");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [loading, setLoading] = useState(true);

  // Simulate a brief initial load so skeleton states are visible.
  useEffect(() => {
    const t = window.setTimeout(() => setLoading(false), 600);
    return () => window.clearTimeout(t);
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = endpoints.filter((e) => {
      if (
        q &&
        !e.hostname.toLowerCase().includes(q) &&
        !e.ip_address.toLowerCase().includes(q) &&
        !e.mac_address.toLowerCase().includes(q)
      )
        return false;
      return matchesFilters(e, filters);
    });
    const dir = sortDir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      return (va - vb) * dir;
    });
  }, [endpoints, search, filters, sortKey, sortDir]);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filters.os !== "all") n++;
    if (filters.risk !== "all") n++;
    if (filters.firewall !== "all") n++;
    if (filters.antivirus !== "all") n++;
    if (filters.cpuModel) n++;
    if (filters.ramMin > 0 || filters.ramMax < 256) n++;
    if (filters.diskMin > 0 || filters.diskMax < 100) n++;
    return n;
  }, [filters]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const resetFilters = () => {
    setFilters(DEFAULT_FILTERS);
    setSearch("");
  };

  const handleExport = () => {
    const blob = new Blob([toCsv(filtered)], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "machine-inventory.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const SortHeader = ({
    label,
    sortableKey,
    className,
  }: {
    label: string;
    sortableKey?: SortKey;
    className?: string;
  }) => {
    if (!sortableKey) {
      return <TableHead className={className}>{label}</TableHead>;
    }
    const active = sortKey === sortableKey;
    const Icon = active
      ? sortDir === "asc"
        ? ChevronUp
        : ChevronDown
      : ChevronsUpDown;
    return (
      <TableHead className={className}>
        <button
          type="button"
          onClick={() => toggleSort(sortableKey)}
          aria-label={`Sort by ${label} ${
            active && sortDir === "asc" ? "descending" : "ascending"
          }`}
          className="inline-flex items-center gap-1 rounded font-medium text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        >
          {label}
          <Icon
            className={`size-3.5 ${
              active ? "text-primary" : "text-muted-foreground"
            }`}
          />
        </button>
      </TableHead>
    );
  };

  return (
    <div className="space-y-6">
      {/* Toolbar: search + export */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            data-ocid="inventory.search_input"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by hostname, IP, or MAC…"
            aria-label="Search endpoints by hostname, IP, or MAC"
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button
            data-ocid="inventory.export_button"
            variant="outline"
            onClick={handleExport}
            disabled={filtered.length === 0}
          >
            <Download className="size-4" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Advanced filters */}
      <Collapsible
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        className="rounded-xl border border-border bg-card shadow-subtle"
      >
        <CollapsibleTrigger asChild>
          <button
            data-ocid="inventory.filters_toggle"
            type="button"
            className="flex w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex items-center gap-2 text-sm font-medium text-foreground">
              <SlidersHorizontal className="size-4 text-primary" />
              Advanced filters
              {activeFilterCount > 0 && (
                <Badge className="bg-primary text-primary-foreground">
                  {activeFilterCount}
                </Badge>
              )}
            </span>
            <ChevronDown
              className={`size-4 text-muted-foreground transition-transform ${
                filtersOpen ? "rotate-180" : ""
              }`}
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t border-border px-4 py-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="filter-os"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Operating system
                </label>
                <Select
                  value={filters.os}
                  onValueChange={(v) =>
                    setFilters((f) => ({ ...f, os: v as Filters["os"] }))
                  }
                >
                  <SelectTrigger
                    id="filter-os"
                    data-ocid="inventory.filter.os"
                    className="w-full"
                  >
                    <SelectValue placeholder="All OS" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All OS</SelectItem>
                    {OS_OPTIONS.map((os) => (
                      <SelectItem key={os} value={os}>
                        {os}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="filter-risk"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Risk level
                </label>
                <Select
                  value={filters.risk}
                  onValueChange={(v) =>
                    setFilters((f) => ({ ...f, risk: v as Filters["risk"] }))
                  }
                >
                  <SelectTrigger
                    id="filter-risk"
                    data-ocid="inventory.filter.risk"
                    className="w-full"
                  >
                    <SelectValue placeholder="All risk" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All risk levels</SelectItem>
                    {RISK_OPTIONS.map((r) => (
                      <SelectItem key={r} value={r}>
                        {riskLabel(r)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="filter-firewall"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Firewall
                </label>
                <Select
                  value={filters.firewall}
                  onValueChange={(v) =>
                    setFilters((f) => ({
                      ...f,
                      firewall: v as Filters["firewall"],
                    }))
                  }
                >
                  <SelectTrigger
                    id="filter-firewall"
                    data-ocid="inventory.filter.firewall"
                    className="w-full"
                  >
                    <SelectValue placeholder="Any" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Any</SelectItem>
                    <SelectItem value="on">Active</SelectItem>
                    <SelectItem value="off">Disabled</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="filter-antivirus"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Antivirus
                </label>
                <Select
                  value={filters.antivirus}
                  onValueChange={(v) =>
                    setFilters((f) => ({
                      ...f,
                      antivirus: v as Filters["antivirus"],
                    }))
                  }
                >
                  <SelectTrigger
                    id="filter-antivirus"
                    data-ocid="inventory.filter.antivirus"
                    className="w-full"
                  >
                    <SelectValue placeholder="Any" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Any</SelectItem>
                    <SelectItem value="on">Active</SelectItem>
                    <SelectItem value="off">Disabled</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="filter-cpu"
                  className="text-xs font-medium text-muted-foreground"
                >
                  CPU model
                </label>
                <Input
                  id="filter-cpu"
                  data-ocid="inventory.filter.cpu"
                  value={filters.cpuModel}
                  onChange={(e) =>
                    setFilters((f) => ({ ...f, cpuModel: e.target.value }))
                  }
                  placeholder="e.g. Xeon, EPYC, M2"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="filter-ram-min"
                  className="text-xs font-medium text-muted-foreground"
                >
                  RAM range (GB)
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    id="filter-ram-min"
                    data-ocid="inventory.filter.ram_min"
                    type="number"
                    min={0}
                    value={filters.ramMin}
                    onChange={(e) =>
                      setFilters((f) => ({
                        ...f,
                        ramMin: Number(e.target.value) || 0,
                      }))
                    }
                    aria-label="Minimum RAM in GB"
                  />
                  <span className="text-muted-foreground">–</span>
                  <Input
                    data-ocid="inventory.filter.ram_max"
                    type="number"
                    min={0}
                    value={filters.ramMax}
                    onChange={(e) =>
                      setFilters((f) => ({
                        ...f,
                        ramMax: Number(e.target.value) || 0,
                      }))
                    }
                    aria-label="Maximum RAM in GB"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="filter-disk-min"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Disk usage (%)
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    id="filter-disk-min"
                    data-ocid="inventory.filter.disk_min"
                    type="number"
                    min={0}
                    max={100}
                    value={filters.diskMin}
                    onChange={(e) =>
                      setFilters((f) => ({
                        ...f,
                        diskMin: Number(e.target.value) || 0,
                      }))
                    }
                    aria-label="Minimum disk usage percent"
                  />
                  <span className="text-muted-foreground">–</span>
                  <Input
                    data-ocid="inventory.filter.disk_max"
                    type="number"
                    min={0}
                    max={100}
                    value={filters.diskMax}
                    onChange={(e) =>
                      setFilters((f) => ({
                        ...f,
                        diskMax: Number(e.target.value) || 0,
                      }))
                    }
                    aria-label="Maximum disk usage percent"
                  />
                </div>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <Button
                data-ocid="inventory.filters_reset"
                variant="ghost"
                size="sm"
                onClick={resetFilters}
              >
                <X className="size-4" />
                Reset
              </Button>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Result count */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <p data-ocid="inventory.result_count">
          {loading
            ? "Loading endpoints…"
            : `${filtered.length} of ${endpoints.length} endpoints`}
        </p>
        {isRefreshing && (
          <span className="flex items-center gap-1.5 text-xs">
            <span className="size-2 animate-pulse rounded-full bg-primary" />
            Refreshing
          </span>
        )}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-subtle">
        {loading ? (
          <div className="space-y-3 p-4" data-ocid="inventory.loading_state">
            {["row-1", "row-2", "row-3", "row-4", "row-5", "row-6"].map((k) => (
              <div key={k} className="flex items-center gap-4">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-12" />
                <Skeleton className="h-6 w-14 rounded-full" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div
            data-ocid="inventory.empty_state"
            className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center"
          >
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <Server className="size-6 text-muted-foreground" />
            </div>
            <h3 className="font-display text-lg font-semibold text-foreground">
              No endpoints match
            </h3>
            <p className="max-w-sm text-sm text-muted-foreground">
              No endpoints match your current search or filter criteria. Try
              adjusting the filters or clearing your search.
            </p>
            <Button
              data-ocid="inventory.empty_clear_button"
              variant="outline"
              size="sm"
              onClick={resetFilters}
            >
              <Filter className="size-4" />
              Clear filters
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead>Hostname</TableHead>
                <TableHead>OS</TableHead>
                <TableHead>IP</TableHead>
                <TableHead>MAC</TableHead>
                <TableHead>CPU</TableHead>
                <TableHead>RAM</TableHead>
                <TableHead>Updates</TableHead>
                <SortHeader
                  label="Risk"
                  sortableKey="risk"
                  className="text-right"
                />
                <SortHeader
                  label="Last seen"
                  sortableKey="lastSeen"
                  className="text-right"
                />
                <SortHeader
                  label="CPU %"
                  sortableKey="cpu"
                  className="text-right"
                />
                <SortHeader
                  label="Mem %"
                  sortableKey="memory"
                  className="text-right"
                />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((e, i) => (
                <TableRow key={e.mac_address}>
                  <TableCell>
                    <Link
                      to="/endpoints/$mac"
                      params={{ mac: e.mac_address }}
                      data-ocid={`inventory.row.${i + 1}.link`}
                      className="font-mono text-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                    >
                      {e.hostname}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="font-medium">
                      {e.os}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-muted-foreground">
                    {e.ip_address}
                  </TableCell>
                  <TableCell className="font-mono text-muted-foreground">
                    {e.mac_address}
                  </TableCell>
                  <TableCell>
                    <span className="text-foreground">
                      {e.audit.hardware.cpuCores} cores
                    </span>
                    <span className="block max-w-[10rem] truncate text-xs text-muted-foreground">
                      {e.audit.hardware.cpuModel}
                    </span>
                  </TableCell>
                  <TableCell className="text-foreground">
                    {e.audit.hardware.ramGb} GB
                  </TableCell>
                  <TableCell>
                    <span
                      className={
                        e.audit.pendingUpdates > 0
                          ? "font-medium text-warning"
                          : "text-muted-foreground"
                      }
                    >
                      {e.audit.pendingUpdates}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <span
                      data-ocid={`inventory.row.${i + 1}.risk`}
                      className={`inline-flex min-w-[2.5rem] items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold ${riskScoreBg(
                        e.audit.riskScore,
                      )}`}
                    >
                      {e.audit.riskScore}
                    </span>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {timeAgo(e.last_seen)}
                  </TableCell>
                  <TableCell
                    className={`text-right font-mono ${riskScoreColor(
                      e.cpu_percent,
                    )}`}
                  >
                    {formatPercent(e.cpu_percent)}
                  </TableCell>
                  <TableCell
                    className={`text-right font-mono ${riskScoreColor(
                      e.memory_percent,
                    )}`}
                  >
                    {formatPercent(e.memory_percent)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
