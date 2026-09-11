import { renderApp } from "@/test/renderApp";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("Live Status pagination", () => {
  it("renders pagination controls and the endpoint count", async () => {
    const { navigateTo } = renderApp();
    await navigateTo("Live Status");

    // All 20 seeded endpoints fit on one page at the default page size.
    expect(screen.getByText(/of 20 endpoints/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Previous" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeInTheDocument();
  });

  it("changes the rows-per-page selector", async () => {
    const { user, navigateTo } = renderApp();
    await navigateTo("Live Status");

    await user.click(screen.getByRole("combobox", { name: "Rows per page" }));
    await user.click(await screen.findByRole("option", { name: "50" }));

    // The page-size selector reflects the new value.
    expect(
      screen.getByRole("combobox", { name: "Rows per page" }),
    ).toHaveTextContent("50");
  }, 30000);
});
