import { renderApp } from "@/test/renderApp";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("Sidebar collapse behavior", () => {
  it("renders the sidebar expanded with the primary navigation", async () => {
    const { container } = renderApp();
    const nav = await screen.findByRole("navigation", { name: "Primary" });
    const sidebar = container.querySelector('[data-slot="sidebar"]');
    expect(sidebar).not.toBeNull();
    expect(sidebar).toHaveAttribute("data-state", "expanded");
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Overview" })).toBeInTheDocument();
  });

  it("collapses the sidebar when the trigger is clicked", async () => {
    const { container, user } = renderApp();
    const sidebar = container.querySelector('[data-slot="sidebar"]');
    expect(sidebar).toHaveAttribute("data-state", "expanded");

    await user.click(
      screen.getByRole("button", { name: "Toggle navigation menu" }),
    );

    expect(sidebar).toHaveAttribute("data-state", "collapsed");
  });

  it("re-expands the sidebar when the trigger is clicked again", async () => {
    const { container, user } = renderApp();
    const sidebar = container.querySelector('[data-slot="sidebar"]');
    const trigger = screen.getByRole("button", {
      name: "Toggle navigation menu",
    });

    await user.click(trigger);
    expect(sidebar).toHaveAttribute("data-state", "collapsed");

    await user.click(trigger);
    expect(sidebar).toHaveAttribute("data-state", "expanded");
  });

  it("lays the main content out beside the sidebar instead of overlaying it", async () => {
    const { container, user } = renderApp();
    // With collapsible="icon" the sidebar reserves a width beside the main
    // content via the sidebar-gap element (full width when expanded, icon
    // width when collapsed) rather than collapsing to w-0 as offcanvas does.
    const sidebar = container.querySelector('[data-slot="sidebar"]');
    const gap = container.querySelector('[data-slot="sidebar-gap"]');
    expect(gap).not.toBeNull();
    // The shadcn sidebar-gap reserves the sidebar's width beside the content
    // (Tailwind v3 arbitrary-value syntax) rather than collapsing to w-0 as
    // the offcanvas variant does.
    expect(gap).toHaveClass("w-[var(--sidebar-width)]");

    // Collapse the sidebar: the active collapsible mode is exposed via
    // data-collapsible, which must be "icon" (not "offcanvas") so the gap
    // keeps reserving icon width beside the content instead of going to w-0.
    await user.click(
      screen.getByRole("button", { name: "Toggle navigation menu" }),
    );
    expect(sidebar).toHaveAttribute("data-collapsible", "icon");
  });

  it("keeps the collapse trigger available on desktop", async () => {
    const { container, user } = renderApp();
    // The trigger is no longer hidden on desktop (md:hidden was removed), so
    // it stays interactive and can collapse the sidebar from a desktop layout.
    const trigger = screen.getByRole("button", {
      name: "Toggle navigation menu",
    });
    expect(trigger).not.toHaveClass("md:hidden");

    const sidebar = container.querySelector('[data-slot="sidebar"]');
    await user.click(trigger);
    expect(sidebar).toHaveAttribute("data-state", "collapsed");
  });
});
