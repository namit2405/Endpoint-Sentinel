import { renderApp } from "@/test/renderApp";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("Live Status page", () => {
  it("renders the endpoint table with seeded hostnames and status badges", async () => {
    const { navigateTo } = renderApp();
    await navigateTo("Live Status");

    // Seeded hostnames appear in the table.
    expect(screen.getByText("srv-web-01")).toBeInTheDocument();
    expect(screen.getByText("ws-legacy-03")).toBeInTheDocument();

    // Status badges for the three connection states.
    expect(screen.getAllByText("Online").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Warning").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Offline").length).toBeGreaterThan(0);
  });

  it("renders metric progress bars and human-readable last-seen", async () => {
    const { navigateTo } = renderApp();
    await navigateTo("Live Status");

    // Progress bars for CPU/Memory/Disk utilization.
    const progressbars = screen.getAllByRole("progressbar");
    expect(progressbars.length).toBeGreaterThan(0);

    // Human-readable last-seen timestamps ("sec ago" / "min ago").
    expect(screen.getAllByText(/sec ago/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/min ago/).length).toBeGreaterThan(0);
  });

  it("shows the auto-refresh indicator and a manual refresh button", async () => {
    const { navigateTo } = renderApp();
    await navigateTo("Live Status");

    expect(
      screen.getByText(/Auto-refreshes every 10 seconds/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Refresh now" }),
    ).toBeInTheDocument();
  });

  it("filters the table by operating system", async () => {
    const { navigateTo } = renderApp();
    await navigateTo("Live Status");

    // Open the OS filter and choose Windows. Radix Select opens on pointer
    // down, so dispatch pointer events before clicking the option.
    const trigger = screen.getByRole("combobox", {
      name: "Filter by operating system",
    });
    fireEvent.pointerDown(trigger);
    fireEvent.pointerUp(trigger);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: "Windows" }));

    // Only Windows hostnames remain; Linux hostnames are filtered out.
    expect(screen.getByText("ws-fin-01")).toBeInTheDocument();
    expect(screen.queryByText("srv-web-01")).not.toBeInTheDocument();
  });

  it("sorts by risk score when the Risk column header is clicked", async () => {
    const { user, navigateTo } = renderApp();
    await navigateTo("Live Status");

    // Default sort is by hostname ascending; mb-design-01 is first.
    const rows = screen.getAllByRole("row");
    expect(rows[1]).toHaveTextContent("mb-design-01");

    // Click the Risk sort header to sort by risk ascending.
    await user.click(screen.getByRole("button", { name: /Sort by Risk/ }));
    const sortedRows = screen.getAllByRole("row");
    // Lowest risk score (4) belongs to srv-staging-11.
    expect(sortedRows[1]).toHaveTextContent("srv-staging-11");
  }, 30000);
});
