import { renderApp } from "@/test/renderApp";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("Live Status risk filter", () => {
  it("filters the table by risk level", async () => {
    const { navigateTo } = renderApp();
    await navigateTo("Live Status");

    // Radix Select opens on pointer down, so dispatch pointer events before
    // clicking the option.
    const trigger = screen.getByRole("combobox", {
      name: "Filter by risk level",
    });
    fireEvent.pointerDown(trigger);
    fireEvent.pointerUp(trigger);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: "High" }));

    // High-risk endpoints remain; low-risk endpoints are filtered out.
    expect(screen.getByText("srv-k8s-09")).toBeInTheDocument();
    expect(screen.queryByText("srv-web-01")).not.toBeInTheDocument();
  }, 30000);
});
