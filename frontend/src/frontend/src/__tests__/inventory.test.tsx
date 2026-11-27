import { renderApp } from "@/test/renderApp";
import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

describe("Inventory page", () => {
  it("renders the catalog table with seeded endpoint details", async () => {
    const { navigateTo } = renderApp();
    await navigateTo("Inventory");

    // Wait for the simulated load to finish and the table to render.
    expect(await screen.findByText("srv-web-01")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Sort by Security Health/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("10.0.1.11")).toBeInTheDocument();
    expect(screen.getByText("00:1A:2B:3C:4D:01")).toBeInTheDocument();
    // CPU cores + model, RAM, updates, risk score columns.
    expect(screen.getAllByText("8 cores").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Intel Xeon E5-2680 v4").length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByText("32 GB").length).toBeGreaterThan(0);
  });

  it("colors scores above 70 green", async () => {
    const { navigateTo } = renderApp();
    await navigateTo("Inventory");
    await screen.findByText("srv-web-01");

    const scoreBadges = document.querySelectorAll(
      '[data-ocid^="inventory.row."][data-ocid$=".risk"]',
    );
    const scoresAbove70 = Array.from(scoreBadges).filter(
      (badge) => Number(badge.textContent) > 70,
    );

    expect(scoresAbove70.length).toBeGreaterThan(0);
    for (const badge of scoresAbove70) {
      expect(badge).toHaveClass("bg-success/15", "text-success");
    }
  });

  it("searches by hostname and narrows the result set", async () => {
    const { user, navigateTo } = renderApp();
    await navigateTo("Inventory");
    await screen.findByText("srv-web-01");

    const search = screen.getByRole("searchbox", {
      name: "Search endpoints by hostname, IP, or MAC",
    });
    await user.type(search, "ws-fin");

    expect(screen.getByText("ws-fin-01")).toBeInTheDocument();
    expect(screen.queryByText("srv-web-01")).not.toBeInTheDocument();
  });

  it("opens collapsible advanced filters and applies a firewall filter", async () => {
    const { user, navigateTo } = renderApp();
    await navigateTo("Inventory");
    await screen.findByText("srv-web-01");

    await user.click(screen.getByRole("button", { name: /Advanced filters/ }));

    // Firewall filter select appears once expanded. Radix Select opens on
    // pointer down, so dispatch pointer events before clicking the option.
    const firewallSelect = screen.getByRole("combobox", {
      name: /Firewall/,
    });
    fireEvent.pointerDown(firewallSelect);
    fireEvent.pointerUp(firewallSelect);
    fireEvent.click(firewallSelect);
    fireEvent.click(screen.getByRole("option", { name: "Disabled" }));

    // Only endpoints with firewall disabled remain (e.g. srv-backup-04).
    expect(screen.getByText("srv-backup-04")).toBeInTheDocument();
    expect(screen.queryByText("srv-web-01")).not.toBeInTheDocument();
  });

  it("exports the filtered view as CSV", async () => {
    const { user, navigateTo } = renderApp();
    await navigateTo("Inventory");
    await screen.findByText("srv-web-01");

    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:mock");
    const revokeObjectURL = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    await user.click(screen.getByRole("button", { name: /Export CSV/ }));

    expect(clickSpy).toHaveBeenCalled();
    expect(createObjectURL).toHaveBeenCalled();

    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
    clickSpy.mockRestore();
  }, 30000);
});
