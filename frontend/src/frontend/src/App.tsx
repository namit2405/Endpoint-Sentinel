import { Layout } from "@/components/Layout";
import { AuthProvider, useAuth } from "@/lib/useAuth";
import ComparePage from "@/pages/ComparePage";
import EndpointDetailPage from "@/pages/EndpointDetailPage";
import InventoryPage from "@/pages/InventoryPage";
import LiveMonitoring from "@/pages/LiveMonitoring";
import LiveStatusPage from "@/pages/LiveStatusPage";
import OverviewPage from "@/pages/OverviewPage";
import SearchPage from "@/pages/SearchPage";
import SignInPage from "@/pages/SignInPage";
import {
  Navigate,
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
  useRouterState,
} from "@tanstack/react-router";
import { Loader2 } from "lucide-react";

const TITLES: Record<string, { title: string; subtitle: string }> = {
  "/": {
    title: "Overview",
    subtitle: "Executive summary of fleet health and risk",
  },
  "/live": {
    title: "Live Status",
    subtitle: "Real-time endpoint health and connectivity",
  },
  "/dashboard/live-monitoring": {
    title: "Live Monitoring",
    subtitle: "Real-time metrics, alerts, and endpoint status",
  },
  "/inventory": {
    title: "Machine Inventory",
    subtitle: "Catalog of all endpoints and audit details",
  },
  "/compare": {
    title: "Compare",
    subtitle: "Side-by-side endpoint comparison",
  },
  "/search": {
    title: "Global Search",
    subtitle: "Search across hostname, IP, MAC, and risk",
  },
};

function FullScreenLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Loader2
        className="size-6 animate-spin text-primary"
        aria-hidden="true"
      />
      <span className="sr-only">Loading Sentinel Command</span>
    </div>
  );
}

/**
 * Root gate. Renders the full-screen sign-in page on `/signin`, otherwise
 * gates the dashboard behind authentication: unauthenticated visitors are
 * redirected to sign-in, signed-in users stay on the dashboard across
 * refreshes, and signed-in users on `/signin` are sent to the dashboard.
 */
function RootGate() {
  const { isAuthenticated, isInitializing } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  if (pathname === "/signin") {
    if (isInitializing) return <FullScreenLoader />;
    if (isAuthenticated) return <Navigate to="/" />;
    return <SignInPage />;
  }

  if (isInitializing) {
    return <FullScreenLoader />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/signin" />;
  }

  const meta = TITLES[pathname] ?? {
    title: "Sentinel Command",
    subtitle: "Endpoint Security Dashboard",
  };
  return <Layout title={meta.title} subtitle={meta.subtitle} />;
}

const rootRoute = createRootRoute({
  component: RootGate,
});

const signinRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/signin",
  component: SignInPage,
});

const overviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: OverviewPage,
});

const liveRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/live",
  component: LiveStatusPage,
});

const inventoryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/inventory",
  component: InventoryPage,
});

const liveMonitoringRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/dashboard/live-monitoring",
  component: LiveMonitoring,
});

const endpointDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/endpoints/$mac",
  component: EndpointDetailPage,
});

const compareRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/compare",
  component: ComparePage,
  validateSearch: (search: Record<string, unknown>) => {
    const raw = search.mac;
    const macs = Array.isArray(raw)
      ? raw.filter((m): m is string => typeof m === "string")
      : typeof raw === "string"
        ? [raw]
        : [];
    return { mac: macs };
  },
});

const searchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/search",
  component: SearchPage,
});

const routeTree = rootRoute.addChildren([
  signinRoute,
  overviewRoute,
  liveRoute,
  inventoryRoute,
  liveMonitoringRoute,
  endpointDetailRoute,
  compareRoute,
  searchRoute,
]);

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export default function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}
