import { renderApp } from "@/test/renderApp";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

/**
 * Characterizes the dashboard shell (top bar title/subtitle per route and the
 * endpoint-detail route reachable through navigation). The authentication
 * change must preserve this navigation hierarchy and per-route chrome.
 */
describe("Dashboard shell chrome", () => {
  it("renders the correct top bar title and subtitle for each dashboard route", async () => {
    const { navigateTo } = renderApp();

    // Default route.
    expect(
      await screen.findByRole("heading", { name: "Overview" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Executive summary of fleet health and risk"),
    ).toBeInTheDocument();

    await navigateTo("Live Status");
    expect(
      screen.getAllByRole("heading", { name: "Live Status" }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText("Real-time endpoint health and connectivity"),
    ).toBeInTheDocument();

    await navigateTo("Inventory");
    expect(
      screen.getAllByRole("heading", { name: "Machine Inventory" }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText("Catalog of all endpoints and audit details"),
    ).toBeInTheDocument();

    await navigateTo("Compare");
    expect(
      screen.getAllByRole("heading", { name: "Compare" }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText("Side-by-side endpoint comparison"),
    ).toBeInTheDocument();

    await navigateTo("Search");
    expect(
      screen.getAllByRole("heading", { name: "Global Search" }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText("Search across hostname, IP, MAC, and risk"),
    ).toBeInTheDocument();
  });

  it("reaches the endpoint detail route through navigation and renders its heading", async () => {
    const { user, navigateTo } = renderApp();
    await navigateTo("Inventory");
    await screen.findByText("srv-web-01");
    await user.click(screen.getByRole("link", { name: "srv-web-01" }));

    expect(
      screen.getByRole("heading", { name: "srv-web-01" }),
    ).toBeInTheDocument();
  });
});
