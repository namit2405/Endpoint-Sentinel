import { renderApp } from "@/test/renderApp";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("Inventory sort by risk", () => {
  it("sorts the catalog by risk score when the Risk header is clicked", async () => {
    const { navigateTo } = renderApp();
    await navigateTo("Inventory");
    await screen.findByText("srv-web-01");

    // Default sort is risk descending; the highest-risk host is first.
    const rowsBefore = screen.getAllByRole("row");
    expect(rowsBefore[1]).toHaveTextContent("ws-legacy-03");

    // Click the Risk header to sort ascending; the lowest-risk host is first.
    fireEvent.click(screen.getByRole("button", { name: /Sort by Risk/ }));
    const rowsAfter = screen.getAllByRole("row");
    expect(rowsAfter[1]).toHaveTextContent("srv-staging-11");
  }, 30000);
});
