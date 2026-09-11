import { renderApp } from "@/test/renderApp";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("Inventory search by IP", () => {
  it("narrows the catalog by IP address", async () => {
    const { user, navigateTo } = renderApp();
    await navigateTo("Inventory");
    await screen.findByText("srv-web-01");

    const search = screen.getByRole("searchbox", {
      name: "Search endpoints by hostname, IP, or MAC",
    });
    await user.type(search, "10.0.1.11");

    expect(screen.getByText("srv-web-01")).toBeInTheDocument();
    expect(screen.queryByText("srv-db-02")).not.toBeInTheDocument();
  }, 30000);
});
