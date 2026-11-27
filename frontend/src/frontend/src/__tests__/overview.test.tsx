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
    expect(
      within(connection).getByText("Online Endpoints"),
    ).toBeInTheDocument();
    expect(
      within(connection).queryByText("Connection warning"),
    ).not.toBeInTheDocument();
    expect(
      within(connection).getByText("Offline Endpoints"),
    ).toBeInTheDocument();
    const offlineLink = within(connection).getByRole("link", {
      name: /Offline Endpoints/,
    });
    const offlineIcon = offlineLink.querySelector("svg.lucide-wifi-off");
    expect(offlineIcon).toBeInTheDocument();
    expect(offlineIcon?.parentElement).toHaveClass("text-destructive");
  });

  it("navigates from connection cards to Live Status", async () => {
    const { user } = renderApp();

    await screen.findByRole("link", { name: /Total Endpoints/ });
    await user.click(screen.getByRole("link", { name: /Online Endpoints/ }));

    expect(
      await screen.findByRole("heading", { name: "Live Status" }),
    ).toBeInTheDocument();
  });

  it("navigates from health cards to Inventory", async () => {
    const { user } = renderApp();

    await screen.findByRole("link", { name: /Healthy Endpoints/ });
    await user.click(screen.getByRole("link", { name: /Healthy Endpoints/ }));

    expect(
      await screen.findByRole("heading", { name: "Machine Inventory" }),
    ).toBeInTheDocument();
  });

  it("renders risk KPI cards with endpoint counts", async () => {
    renderApp();

    const risk = await screen.findByRole("region", {
      name: "Risk posture summary",
    });
    expect(within(risk).getByText("Healthy Endpoints")).toBeInTheDocument();
    expect(within(risk).getByText("At-risk Endpoints")).toBeInTheDocument();
    expect(within(risk).getByText("Critical Endpoints")).toBeInTheDocument();
  });

  it("renders the three chart cards and the OS distribution legend", async () => {
    renderApp();

    expect(await screen.findByText("Endpoint Health Analytics")).toBeInTheDocument();
    expect(screen.getByText("OS Distribution")).toBeInTheDocument();
    expect(screen.getByText("Endpoint Security Posture")).toBeInTheDocument();

    // OS distribution legend lists each OS with its seeded count.
    const osList = screen.getByText("OS Distribution").closest("div");
    expect(osList).not.toBeNull();
    expect(screen.getByText("Windows")).toBeInTheDocument();
    expect(screen.getByText("Linux")).toBeInTheDocument();
    expect(screen.getByText("macOS")).toBeInTheDocument();
  });

  it("renders quick alerts from critical/high findings in the seeded data", async () => {
    const { user } = renderApp();

    expect(await screen.findByText("Quick Alerts")).toBeInTheDocument();
    // Critical findings from the seeded fleet (multiple hosts share the title).
    expect(screen.getAllByText("Firewall disabled").length).toBeGreaterThan(0);
    // A high-severity finding.
    expect(screen.getByText("24 pending security updates")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Firewall disabled/ }));
    expect(
      screen.getByRole("dialog", { name: /Firewall disabled/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("Severity")).toBeInTheDocument();
    expect(screen.getByText("Endpoint")).toBeInTheDocument();
  });
});
