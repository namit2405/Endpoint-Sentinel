import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatPercent, riskScoreBg, utilizationBarColor } from "@/lib/format";
import type { EndpointStatus } from "@/lib/types";
import { useEndpoints } from "@/lib/useEndpoints";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { useMemo, useState } from "react";

const MAX_COMPARE = 3;

type RowValue = {
  raw: string | number | boolean;
  display: React.ReactNode;
};

interface CompareRow {
  label: string;
  getValue: (e: EndpointStatus) => RowValue;
  align?: "left" | "right";
}

const ROWS: CompareRow[] = [
  {
    label: "Hostname",
    getValue: (e) => ({
      raw: e.hostname,
      display: (
        <span className="font-mono text-sm font-medium text-foreground">
          {e.hostname}
        </span>
      ),
    }),
  },
  {
    label: "OS",
    getValue: (e) => ({ raw: e.os, display: <span>{e.os}</span> }),
  },
  {
    label: "CPU",
    getValue: (e) => ({
      raw: e.cpu_percent,
      display: (
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-primary/20">
            <div
              className={`h-full rounded-full ${utilizationBarColor(e.cpu_percent)}`}
              style={{ width: `${e.cpu_percent}%` }}
            />
          </div>
          <span className="font-mono text-sm">
            {formatPercent(e.cpu_percent)}
          </span>
        </div>
      ),
    }),
  },
  {
    label: "RAM",
    getValue: (e) => ({
      raw: e.memory_percent,
      display: (
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-primary/20">
            <div
              className={`h-full rounded-full ${utilizationBarColor(e.memory_percent)}`}
              style={{ width: `${e.memory_percent}%` }}
            />
          </div>
          <span className="font-mono text-sm">
            {formatPercent(e.memory_percent)}
          </span>
        </div>
      ),
    }),
  },
  {
    label: "Firewall",
    getValue: (e) => ({
      raw: e.firewall_active,
      display: e.firewall_active ? (
        <Badge variant="secondary" className="bg-success/15 text-success">
          Enabled
        </Badge>
      ) : (
        <Badge
          variant="secondary"
          className="bg-destructive/15 text-destructive"
        >
          Disabled
        </Badge>
      ),
    }),
  },
  {
    label: "Antivirus",
    getValue: (e) => ({
      raw: e.antivirus_active,
      display: e.antivirus_active ? (
        <Badge variant="secondary" className="bg-success/15 text-success">
          Active
        </Badge>
      ) : (
        <Badge
          variant="secondary"
          className="bg-destructive/15 text-destructive"
        >
          Inactive
        </Badge>
      ),
    }),
  },
  {
    label: "Updates",
    getValue: (e) => ({
      raw: e.audit.pendingUpdates,
      display: (
        <span className="font-mono text-sm">
          {e.audit.pendingUpdates} pending
        </span>
      ),
    }),
  },
  {
    label: "Risk Score",
    getValue: (e) => ({
      raw: e.audit.riskScore,
      display: (
        <Badge variant="secondary" className={riskScoreBg(e.audit.riskScore)}>
          {e.audit.riskScore}
        </Badge>
      ),
    }),
  },
];

/** Indices of cells in a row whose value differs from the most common value. */
function differingIndices(values: RowValue[]): Set<number> {
  const counts = new Map<string, number>();
  for (const v of values) {
    const key = String(v.raw);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let modeKey = "";
  let modeCount = -1;
  for (const [key, count] of counts) {
    if (count > modeCount) {
      modeKey = key;
      modeCount = count;
    }
  }
  const result = new Set<number>();
  values.forEach((v, i) => {
    if (String(v.raw) !== modeKey) result.add(i);
  });
  return result;
}

export default function ComparePage() {
  const { endpoints, isRefreshing } = useEndpoints();
  const navigate = useNavigate();
  const search = useSearch({ from: "/compare" });
  const [selectedMacs, setSelectedMacs] = useState<string[]>(() =>
    search.mac.slice(0, MAX_COMPARE),
  );
  const [open, setOpen] = useState(false);

  const selected = useMemo(
    () =>
      selectedMacs
        .map((mac) => endpoints.find((e) => e.mac_address === mac))
        .filter((e): e is EndpointStatus => Boolean(e)),
    [selectedMacs, endpoints],
  );

  const toggleEndpoint = (mac: string) => {
    setSelectedMacs((current) => {
      if (current.includes(mac)) {
        return current.filter((m) => m !== mac);
      }
      if (current.length >= MAX_COMPARE) return current;
      return [...current, mac];
    });
  };

  const goToEndpoint = (mac: string) => {
    void navigate({ to: "/endpoints/$mac", params: { mac } });
  };

  const renderCell = (row: CompareRow, endpoint: EndpointStatus) => {
    const value = row.getValue(endpoint);
    return (
      <button
        type="button"
        onClick={() => goToEndpoint(endpoint.mac_address)}
        className="group flex w-full items-center justify-start gap-1.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`View ${endpoint.hostname} details`}
      >
        {value.display}
      </button>
    );
  };

  const renderTable = () => {
    if (isRefreshing && selected.length === 0) {
      return (
        <div className="space-y-3" data-ocid="compare.loading_state">
          {["a", "b", "c", "d", "e", "f", "g", "h"].map((k) => (
            <Skeleton key={k} className="h-10 w-full" />
          ))}
        </div>
      );
    }

    return (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="w-40 px-3 py-3 text-left align-bottom text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Attribute
              </th>
              {selected.map((e) => (
                <th
                  key={e.mac_address}
                  className="px-3 py-3 text-left align-bottom"
                >
                  <button
                    type="button"
                    onClick={() => goToEndpoint(e.mac_address)}
                    className="group flex items-center gap-1.5 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`View ${e.hostname} details`}
                  >
                    <span className="font-mono text-sm font-semibold text-foreground">
                      {e.hostname}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {e.ip_address}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => {
              const values = selected.map((e) => row.getValue(e));
              const diff = differingIndices(values);
              return (
                <tr
                  key={row.label}
                  className="border-b border-border last:border-0"
                >
                  <th
                    scope="row"
                    className="px-3 py-3 text-left align-middle text-sm font-medium text-muted-foreground"
                  >
                    {row.label}
                  </th>
                  {selected.map((e, i) => {
                    const isDiff = diff.has(i);
                    return (
                      <td
                        key={e.mac_address}
                        className={`px-3 py-2 align-middle ${
                          isDiff ? "bg-warning/15" : ""
                        }`}
                      >
                        {isDiff ? (
                          <TooltipProvider delayDuration={100}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="rounded-md">
                                  {renderCell(row, e)}
                                </div>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="max-w-xs text-xs">
                                  Value differs from the other selected
                                  endpoints
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : (
                          renderCell(row, e)
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
          Compare
        </h2>
        <p className="text-sm text-muted-foreground">
          Side-by-side comparison of 2–3 selected endpoints.
        </p>
      </div>

      {/* Selector */}
      <div className="rounded-xl border border-border bg-card p-4 shadow-subtle">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-foreground">
                Endpoints to compare
              </span>
              <Badge
                variant="secondary"
                className="bg-muted text-muted-foreground"
              >
                {selected.length}/{MAX_COMPARE}
              </Badge>
            </div>
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  data-ocid="compare.select"
                  disabled={selected.length >= MAX_COMPARE}
                  aria-label="Add endpoints to compare"
                >
                  <ChevronsUpDown className="mr-2 h-4 w-4" />
                  Add endpoint
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className="w-72 p-0"
                align="end"
                data-ocid="compare.select_popover"
              >
                <div className="border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
                  Select up to {MAX_COMPARE} endpoints
                </div>
                <div className="max-h-72 overflow-y-auto p-1">
                  {endpoints.map((e) => {
                    const checked = selectedMacs.includes(e.mac_address);
                    const disabled =
                      !checked && selectedMacs.length >= MAX_COMPARE;
                    return (
                      <label
                        key={e.mac_address}
                        htmlFor={`compare-${e.mac_address}`}
                        className={`flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-accent/60 ${
                          disabled ? "cursor-not-allowed opacity-50" : ""
                        }`}
                      >
                        <Checkbox
                          id={`compare-${e.mac_address}`}
                          checked={checked}
                          disabled={disabled}
                          onCheckedChange={() => toggleEndpoint(e.mac_address)}
                          aria-label={`Compare ${e.hostname}`}
                        />
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate font-mono text-sm font-medium text-foreground">
                            {e.hostname}
                          </span>
                          <span className="truncate font-mono text-xs text-muted-foreground">
                            {e.ip_address}
                          </span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>
          </div>

          {selected.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {selected.map((e) => (
                <Badge
                  key={e.mac_address}
                  variant="secondary"
                  className="gap-1.5 bg-muted py-1 pl-2 pr-1 text-foreground"
                >
                  <span className="font-mono text-xs">{e.hostname}</span>
                  <button
                    type="button"
                    onClick={() => toggleEndpoint(e.mac_address)}
                    className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`Remove ${e.hostname} from comparison`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Comparison table */}
      <div className="rounded-xl border border-border bg-card shadow-subtle">
        {selected.length < 2 ? (
          <div
            data-ocid="compare.empty_state"
            className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Check className="h-6 w-6 text-muted-foreground" />
            </div>
            <div>
              <h3 className="font-display text-base font-semibold text-foreground">
                Select at least two endpoints
              </h3>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                Choose 2–3 endpoints from the list above to see a side-by-side
                comparison of their security posture and risk.
              </p>
            </div>
          </div>
        ) : (
          renderTable()
        )}
      </div>

      {selected.length >= 2 && (
        <p className="text-xs text-muted-foreground">
          Cells highlighted in yellow differ from the other selected endpoints.
          Click any cell to open that endpoint&apos;s detail page.
        </p>
      )}
    </div>
  );
}
