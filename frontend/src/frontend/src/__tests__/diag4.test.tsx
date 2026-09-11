import { renderApp } from "@/test/renderApp";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("Compare remove endpoint", () => {
  it("removes a selected endpoint from the comparison", async () => {
    const { user, navigateTo } = renderApp();
    await navigateTo("Compare");

    await user.click(
      screen.getByRole("button", { name: "Add endpoints to compare" }),
    );
    await user.click(
      screen.getByRole("checkbox", { name: "Compare srv-web-01" }),
    );
    await user.click(
      screen.getByRole("checkbox", { name: "Compare srv-backup-04" }),
    );

    // Removing one endpoint leaves fewer than two, so the empty state returns.
    await user.click(
      screen.getByRole("button", {
        name: "Remove srv-web-01 from comparison",
      }),
    );
    expect(
      screen.getByText("Select at least two endpoints"),
    ).toBeInTheDocument();
  }, 30000);
});
