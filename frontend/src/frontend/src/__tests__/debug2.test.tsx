import { renderApp } from "@/test/renderApp";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("Live Status OS filter dropdown", () => {
  it("opens the OS filter dropdown and lists all operating systems", async () => {
    const { navigateTo } = renderApp();
    await navigateTo("Live Status");

    // Radix Select opens on pointer down, so dispatch pointer events before
    // clicking the trigger.
    const trigger = screen.getByRole("combobox", {
      name: "Filter by operating system",
    });
    fireEvent.pointerDown(trigger);
    fireEvent.pointerUp(trigger);
    fireEvent.click(trigger);

    // All four OS options are listed.
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "All OS",
      "Windows",
      "Linux",
      "macOS",
    ]);
  }, 30000);
});
