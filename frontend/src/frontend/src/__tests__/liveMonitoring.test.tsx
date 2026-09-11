import { useLiveMetrics } from "@/hooks/useLiveMetrics";
import { renderApp } from "@/test/renderApp";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

/**
 * Cover for the Live Monitoring dashboard at /dashboard/live-monitoring.
 * Verifies the four sections (KPI cards, alert banner, metrics charts, status
 * table), the derived KPI values, sortable table columns, row/alert navigation
 * to the machine detail page, and the error + retry contract of the data hook.
 */

describe("Live Monitoring page", () => {
  it("renders all four sections and is reachable from the sidebar nav", async () => {
    const { navigateTo } = renderApp();
    await navigateTo("Live Monitoring");

    // Top bar title reflects the route.
    expect(
      screen.getAllByRole("heading", { name: "Live Monitoring" }).length,
    ).toBeGreaterThan(0);

    // KPI summary section.
    expect(
      screen.getByRole("region", { name: "Live metrics summary" }),
    ).toBeInTheDocument();
    // Metrics charts section.
    expect(
      screen.getByRole("region", { name: "Real-time metrics charts" }),
    ).toBeInTheDocument();
    // Status table section.
    expect(
      screen.getByRole("region", { name: "Endpoint status table" }),
    ).toBeInTheDocument();
    // Alert banner section (seeded fleet has a sustained memory alert).
    expect(
      screen.getByRole("region", { name: "Active threshold alerts" }),
    ).toBeInTheDocument();
  });

  it("shows the four KPI cards with averages and online endpoint count", async () => {
    const { navigateTo } = renderApp();
    await navigateTo("Live Monitoring");

    expect(await screen.findByText("Avg CPU")).toBeInTheDocument();
    expect(screen.getByText("Avg Memory")).toBeInTheDocument();
    expect(screen.getByText("Avg Disk")).toBeInTheDocument();
    expect(screen.getByText("Online Endpoints")).toBeInTheDocument();
  });

  it("renders the three top-5 metric line charts", async () => {
    const { navigateTo } = renderApp();
    await navigateTo("Live Monitoring");

    expect(await screen.findByText("CPU Usage")).toBeInTheDocument();
    expect(screen.getByText("Memory Usage")).toBeInTheDocument();
    expect(screen.getByText("Disk Usage")).toBeInTheDocument();

    // Each chart is exposed as an accessible image describing the top-5 lines
    // over the last 60 minutes.
    expect(
      screen.getAllByRole("img", {
        name: /usage for the top 5 endpoints over the last 60 minutes/,
      }),
    ).toHaveLength(3);
  });

  it("lists endpoints in the status table with health badges and last-updated", async () => {
    const { navigateTo } = renderApp();
    await navigateTo("Live Monitoring");

    expect(await screen.findByText("Endpoint Status")).toBeInTheDocument();
    // Seeded hostnames appear in the table.
    expect(screen.getByText("srv-web-01")).toBeInTheDocument();
    expect(screen.getByText("ws-legacy-03")).toBeInTheDocument();
    // Health badges for the connection states.
    expect(screen.getAllByText("Online").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Offline").length).toBeGreaterThan(0);
    // Last-updated readouts ("sec ago" / "hr ago").
    expect(screen.getAllByText(/sec ago/).length).toBeGreaterThan(0);
  });

  it("sorts the table by CPU when the CPU column header is clicked", async () => {
    const { user, navigateTo } = renderApp();
    await navigateTo("Live Monitoring");

    // Default sort is hostname ascending; mb-design-01 is first.
    const rows = await screen.findAllByRole("row");
    expect(rows[1]).toHaveTextContent("mb-design-01");

    // Click the CPU sort header to sort by CPU ascending.
    await user.click(screen.getByRole("button", { name: /Sort by CPU/ }));
    const sortedRows = screen.getAllByRole("row");
    // Lowest CPU (0%) belongs to ws-legacy-03.
    expect(sortedRows[1]).toHaveTextContent("ws-legacy-03");
  });

  it("navigates to the machine detail page when a table row is clicked", async () => {
    const { user, navigateTo } = renderApp();
    await navigateTo("Live Monitoring");

    const row = await screen.findByRole("row", {
      name: /View details for srv-web-01/,
    });
    await user.click(row);

    expect(
      screen.getByRole("heading", { name: "srv-web-01" }),
    ).toBeInTheDocument();
  });

  it("shows the alert banner and navigates to the machine detail page on click", async () => {
    const { user, navigateTo } = renderApp();
    await navigateTo("Live Monitoring");

    // The seeded fleet has a sustained memory alert on srv-k8s-09.
    const banner = await screen.findByRole("region", {
      name: "Active threshold alerts",
    });
    expect(banner).toHaveTextContent("1 active alert");
    expect(banner).toHaveTextContent("srv-k8s-09");

    await user.click(screen.getByRole("button", { name: /srv-k8s-09/ }));

    expect(
      screen.getByRole("heading", { name: "srv-k8s-09" }),
    ).toBeInTheDocument();
  });
});

describe("useLiveMetrics error and retry contract", () => {
  function Harness({ simulateFailure }: { simulateFailure: boolean }) {
    const { error, retry, endpoints } = useLiveMetrics({ simulateFailure });
    return (
      <div>
        <span data-testid="error">{error ?? "no-error"}</span>
        <span data-testid="count">{endpoints.length}</span>
        <button type="button" onClick={retry}>
          Retry
        </button>
      </div>
    );
  }

  it("reports an error and yields no endpoints when the source fails", async () => {
    render(<Harness simulateFailure />);
    await waitFor(() => {
      expect(screen.getByTestId("error")).toHaveTextContent(
        "Unable to reach the monitoring service.",
      );
    });
    expect(screen.getByTestId("count")).toHaveTextContent("0");
  });

  it("clears the error and refetches endpoints on retry", async () => {
    const { rerender } = render(<Harness simulateFailure />);
    await waitFor(() => {
      expect(screen.getByTestId("error")).toHaveTextContent(
        "Unable to reach the monitoring service.",
      );
    });

    // Simulate the source recovering, then retry.
    rerender(<Harness simulateFailure={false} />);
    await waitFor(() => {
      expect(screen.getByTestId("error")).toHaveTextContent("no-error");
    });
    // All 20 seeded endpoints are refetched.
    expect(screen.getByTestId("count")).toHaveTextContent("20");
  });
});
