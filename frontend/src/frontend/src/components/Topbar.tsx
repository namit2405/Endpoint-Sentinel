import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ACCOUNT_TYPE_LABELS } from "@/lib/auth";
import { useAuth } from "@/lib/useAuth";
import { cn } from "@/lib/utils";
import { Building2, LogOut, RefreshCw, User } from "lucide-react";

interface TopbarProps {
  title: string;
  subtitle?: string;
  isRefreshing?: boolean;
  onRefresh?: () => void;
}

export function Topbar({
  title,
  subtitle,
  isRefreshing = false,
  onRefresh,
}: TopbarProps) {
  const { user, accountType, logout } = useAuth();
  const AccountIcon = accountType === "company" ? Building2 : User;
  const accountName = user?.accountName ||
    (accountType ? ACCOUNT_TYPE_LABELS[accountType] : "");

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-card px-4 shadow-subtle md:px-6">
      <SidebarTrigger
        aria-label="Toggle navigation menu"
        data-ocid="topbar.menu_button"
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <h1 className="truncate font-display text-lg font-bold tracking-tight text-foreground md:text-xl">
          {title}
        </h1>
        {subtitle && (
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        )}
      </div>

      {onRefresh && (
        <Button
          variant="outline"
          size="sm"
          onClick={onRefresh}
          data-ocid="topbar.refresh_button"
          className="shrink-0"
        >
          <RefreshCw
            className={cn("size-4", isRefreshing && "animate-spin")}
            aria-hidden="true"
          />
          <span className="hidden sm:inline">Refresh</span>
        </Button>
      )}

      {accountType && (
        <div
          data-ocid="topbar.account_type"
          className="flex shrink-0 items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-1.5"
        >
          <AccountIcon className="size-4 text-primary" aria-hidden="true" />
          <span className="hidden text-sm font-medium text-foreground sm:inline">
            {accountName}
          </span>
        </div>
      )}

      <Button
        variant="ghost"
        size="sm"
        onClick={logout}
        data-ocid="topbar.sign_out_button"
        className="shrink-0 text-muted-foreground hover:text-foreground"
        aria-label="Sign out"
      >
        <LogOut className="size-4" aria-hidden="true" />
        <span className="hidden sm:inline">Sign out</span>
      </Button>
    </header>
  );
}
