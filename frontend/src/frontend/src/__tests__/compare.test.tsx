import { renderApp } from "@/test/renderApp";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("Compare page", () => {
  it("shows an empty state before any endpoints are selected", async () => {
    const { navigateTo } = renderApp();
    await navigateTo("Compare");

    expect(
      screen.getByText("Select at least two endpoints"),
    ).toBeInTheDocument();
  });

  it("compares two endpoints side-by-side with differences highlighted", async () => {
    const { user, navigateTo } = renderApp();
    await navigateTo("Compare");

    // Open the "Add endpoint" popover and select two endpoints via checkboxes.
    await user.click(
      screen.getByRole("button", { name: "Add endpoints to compare" }),
    );
    await user.click(
      screen.getByRole("checkbox", { name: "Compare srv-web-01" }),
    );
    await user.click(
      screen.getByRole("checkbox", { name: "Compare srv-backup-04" }),
    );

    // The comparison table shows both hostnames and the attribute rows. The
    // hostname appears in both the column header and the Hostname row, so use
    // getAllByText for those.
    expect(screen.getAllByText("srv-web-01").length).toBeGreaterThan(0);
    expect(screen.getAllByText("srv-backup-04").length).toBeGreaterThan(0);
    expect(screen.getByText("Hostname")).toBeInTheDocument();
    expect(screen.getByText("OS")).toBeInTheDocument();
    expect(screen.getByText("Firewall")).toBeInTheDocument();
    expect(screen.getByText("Risk Score")).toBeInTheDocument();

    // srv-backup-04 has a disabled firewall, shown as a difference.
    expect(screen.getByText("Disabled")).toBeInTheDocument();
    expect(screen.getByText("Enabled")).toBeInTheDocument();
  }, 30000);

  it("navigates to an endpoint detail page when a cell is clicked", async () => {
    const { user, navigateTo } = renderApp();
    await navigateTo("Compare");

    // Select two endpoints so the comparison table renders.
    await user.click(
      screen.getByRole("button", { name: "Add endpoints to compare" }),
    );
    await user.click(
      screen.getByRole("checkbox", { name: "Compare srv-web-01" }),
    );
    await user.click(
      screen.getByRole("checkbox", { name: "Compare srv-backup-04" }),
    );

    // Click a cell for srv-web-01 to open its detail page. The "View details"
    // button appears in the column header and in every row cell, so pick the
    // first match.
    await user.click(
      screen.getAllByRole("button", { name: "View srv-web-01 details" })[0],
    );

    expect(
      screen.getByRole("heading", { name: "srv-web-01" }),
    ).toBeInTheDocument();
  }, 30000);
});
