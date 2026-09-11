import { renderApp } from "@/test/renderApp";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("App shell and navigation", () => {
  it("renders the Overview page on the default route without a blank screen", async () => {
    renderApp();
    // Topbar title reflects the default route.
    expect(
      await screen.findByRole("heading", { name: "Overview" }),
    ).toBeInTheDocument();
    // Overview KPI cards are present.
    expect(screen.getByText("Total Endpoints")).toBeInTheDocument();
    expect(screen.getByText("Online")).toBeInTheDocument();
    expect(screen.getByText("Offline")).toBeInTheDocument();
  });

  it("navigates between all primary pages via the sidebar", async () => {
    const { navigateTo } = renderApp();

    await navigateTo("Live Status");
    expect(
      screen.getAllByRole("heading", { name: "Live Status" }).length,
    ).toBeGreaterThan(0);

    await navigateTo("Inventory");
    expect(
      screen.getAllByRole("heading", { name: "Machine Inventory" }).length,
    ).toBeGreaterThan(0);

    await navigateTo("Compare");
    expect(
      screen.getAllByRole("heading", { name: "Compare" }).length,
    ).toBeGreaterThan(0);

    await navigateTo("Search");
    expect(
      screen.getAllByRole("heading", { name: "Global Search" }).length,
    ).toBeGreaterThan(0);

    await navigateTo("Overview");
    expect(
      screen.getAllByRole("heading", { name: "Overview" }).length,
    ).toBeGreaterThan(0);
  });
});
