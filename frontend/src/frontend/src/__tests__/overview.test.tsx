import { renderApp } from "@/test/renderApp";
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("Overview page", () => {
  it("renders connection KPI cards driven by seeded endpoint data", async () => {
    renderApp();

    const connection = await screen.findByRole("region", {
      name: "Endpoint connection summary",
    });
    // Total = 20 seeded endpoints.
    expect(
      within(connection).getByText("Total Endpoints").parentElement,
    ).toHaveTextContent("20");
    expect(within(connection).getByText("Online")).toBeInTheDocument();
    expect(within(connection).getByText("Warning")).toBeInTheDocument();
    expect(within(connection).getByText("Offline")).toBeInTheDocument();
  });

  it("renders risk KPI cards for Healthy, Warning, and Critical", async () => {
    renderApp();

    const risk = await screen.findByRole("region", {
      name: "Risk posture summary",
    });
    expect(within(risk).getByText("Healthy")).toBeInTheDocument();
    expect(within(risk).getByText("Warning")).toBeInTheDocument();
    expect(within(risk).getByText("Critical")).toBeInTheDocument();
  });

  it("renders the three chart cards and the OS distribution legend", async () => {
    renderApp();

    expect(await screen.findByText("Health Trend")).toBeInTheDocument();
    expect(screen.getByText("OS Distribution")).toBeInTheDocument();
    expect(screen.getByText("Top Riskiest Endpoints")).toBeInTheDocument();

    // OS distribution legend lists each OS with its seeded count.
    const osList = screen.getByText("OS Distribution").closest("div");
    expect(osList).not.toBeNull();
    expect(screen.getByText("Windows")).toBeInTheDocument();
    expect(screen.getByText("Linux")).toBeInTheDocument();
    expect(screen.getByText("macOS")).toBeInTheDocument();
  });

  it("renders quick alerts from critical/high findings in the seeded data", async () => {
    renderApp();

    expect(await screen.findByText("Quick Alerts")).toBeInTheDocument();
    // Critical findings from the seeded fleet (multiple hosts share the title).
    expect(screen.getAllByText("Firewall disabled").length).toBeGreaterThan(0);
    // A high-severity finding.
    expect(screen.getByText("24 pending security updates")).toBeInTheDocument();
  });
});
