import { renderApp } from "@/test/renderApp";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("Inventory sort by security health", () => {
  it("sorts the catalog by score when the Security Health header is clicked", async () => {
    const { navigateTo } = renderApp();
    await navigateTo("Inventory");
    await screen.findByText("srv-web-01");

    // Default sort is risk descending; the highest-risk host is first.
    const rowsBefore = screen.getAllByRole("row");
    expect(rowsBefore[1]).toHaveTextContent("ws-legacy-03");

    // Click the Security Health header to sort ascending; the lowest score is first.
    fireEvent.click(
      screen.getByRole("button", { name: /Sort by Security Health/ }),
    );
    const rowsAfter = screen.getAllByRole("row");
    expect(rowsAfter[1]).toHaveTextContent("srv-staging-11");
  }, 30000);
});
