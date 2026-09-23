import {
  Sidebar,
  SidebarContent,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Outlet } from "@tanstack/react-router";
import { Sidebar as NavSidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

interface LayoutProps {
  title: string;
  subtitle?: string;
  isRefreshing?: boolean;
  onRefresh?: () => void;
}

export function Layout({
  title,
  subtitle,
  isRefreshing,
  onRefresh,
}: LayoutProps) {
  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarContent>
          <NavSidebar />
        </SidebarContent>
      </Sidebar>
      <SidebarInset className="bg-background">
        <Topbar
          title={title}
          subtitle={subtitle}
          isRefreshing={isRefreshing}
          onRefresh={onRefresh}
        />
        <main className="min-w-0 flex-1 p-4 md:p-6">
          <Outlet />
        </main>
        <footer className="border-t border-border bg-muted/40 px-4 py-4 md:px-6">
          <div className="flex flex-col items-start justify-between gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center">
            <p>
              © {new Date().getFullYear()}. Built with love using{" "}
              <a
                href={`https://caffeine.ai?utm_source=caffeine-footer&utm_medium=referral&utm_content=${encodeURIComponent(
                  typeof window !== "undefined" ? window.location.hostname : "",
                )}`}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-primary underline-offset-2 hover:underline"
              >
                caffeine.ai
              </a>
              .
            </p>
            <p className="font-mono text-muted-foreground/70">
              Sentinel Command · Endpoint Security
            </p>
          </div>
        </footer>
      </SidebarInset>
    </SidebarProvider>
  );
}
