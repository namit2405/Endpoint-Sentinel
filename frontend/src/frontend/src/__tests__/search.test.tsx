import { renderApp } from "@/test/renderApp";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("Search page", () => {
  it("shows an initial discovery state before any search", async () => {
    const { navigateTo } = renderApp();
    await navigateTo("Search");

    expect(
      screen.getByText("Discover endpoints across your fleet"),
    ).toBeInTheDocument();
  });

  it("shows autocomplete suggestions as the user types", async () => {
    const { user, navigateTo } = renderApp();
    await navigateTo("Search");

    const input = screen.getByRole("textbox", { name: "Search endpoints" });
    await user.type(input, "srv-web");

    // Suggestions list appears with matching hostnames.
    expect(await screen.findByText("srv-web-01")).toBeInTheDocument();
  });

  it("returns firewall-disabled endpoints for the 'firewall disabled' quick link", async () => {
    const { user, navigateTo } = renderApp();
    await navigateTo("Search");

    await user.click(screen.getByRole("button", { name: "firewall disabled" }));

    // Endpoints with firewall disabled appear.
    expect(await screen.findByText("srv-backup-04")).toBeInTheDocument();
    expect(screen.getByText("ws-fin-02")).toBeInTheDocument();
    expect(screen.getByText("ws-legacy-03")).toBeInTheDocument();
    // A firewall-enabled endpoint is excluded.
    expect(screen.queryByText("srv-web-01")).not.toBeInTheDocument();
  });

  it("returns endpoints with more than 20 pending updates for 'updates>20'", async () => {
    const { user, navigateTo } = renderApp();
    await navigateTo("Search");

    await user.click(screen.getByRole("button", { name: "updates>20" }));

    // Endpoints with >20 pending updates.
    expect(await screen.findByText("srv-db-02")).toBeInTheDocument();
    expect(screen.getByText("srv-backup-04")).toBeInTheDocument();
    expect(screen.getByText("ws-legacy-03")).toBeInTheDocument();
    // srv-web-01 has only 3 pending updates, so it is excluded.
    expect(screen.queryByText("srv-web-01")).not.toBeInTheDocument();
  });
});
