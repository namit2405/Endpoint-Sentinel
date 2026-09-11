import { cn } from "@/lib/utils";
import { Link } from "@tanstack/react-router";
import {
  Activity,
  Gauge,
  LayoutDashboard,
  type LucideIcon,
  MonitorCheck,
  Search,
  Server,
  ShieldCheck,
} from "lucide-react";

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Overview", to: "/", icon: LayoutDashboard },
  { label: "Live Status", to: "/live", icon: Activity },
  {
    label: "Live Monitoring",
    to: "/dashboard/live-monitoring",
    icon: Gauge,
  },
  { label: "Inventory", to: "/inventory", icon: Server },
  { label: "Compare", to: "/compare", icon: MonitorCheck },
  { label: "Search", to: "/search", icon: Search },
];

export function Sidebar() {
  return (
    <div className="flex h-full w-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="flex size-9 items-center justify-center rounded-lg gradient-primary text-primary-foreground shadow-subtle">
          <ShieldCheck className="size-5" aria-hidden="true" />
        </div>
        <div className="flex flex-col leading-tight group-data-[collapsible=icon]:hidden">
          <span className="font-display text-base font-bold tracking-tight text-sidebar-foreground">
            Sentinel
          </span>
          <span className="text-[11px] font-medium uppercase tracking-widest text-sidebar-foreground/60">
            Command
          </span>
        </div>
      </div>

      <div className="px-3 pb-2">
        <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-widest text-sidebar-foreground/50 group-data-[collapsible=icon]:hidden">
          Monitor
        </p>
        <nav aria-label="Primary" className="flex flex-col gap-1">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              data-ocid={`nav.${item.label.toLowerCase().replace(/\s+/g, "_")}`}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground/80 transition-colors",
                "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                "[&.active]:bg-sidebar-primary [&.active]:text-sidebar-primary-foreground",
              )}
              activeProps={{ className: "active" }}
            >
              <item.icon className="size-4 shrink-0" aria-hidden="true" />
              <span className="group-data-[collapsible=icon]:hidden">
                {item.label}
              </span>
            </Link>
          ))}
        </nav>
      </div>

      <div className="mt-auto px-3 pb-4">
        <div className="rounded-lg border border-sidebar-border bg-sidebar-accent/40 p-3 group-data-[collapsible=icon]:hidden">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-sidebar-foreground/60">
            Fleet Health
          </p>
          <p className="mt-1 text-xs leading-relaxed text-sidebar-foreground/70">
            Endpoint security monitoring across Linux, Windows &amp; macOS.
          </p>
        </div>
      </div>
    </div>
  );
}
