import App from "@/App";
import { clear, login, mockIdentity, setAuthState } from "@/test/authMock";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

/**
 * Covers the authentication gate added by this change: unauthenticated
 * visitors land on the sign-in screen, signing in via Internet Identity with
 * either account type grants dashboard access, the account type persists
 * across refresh, sign-out returns to sign-in and blocks dashboard routes,
 * and the /signin <-> dashboard redirects hold.
 *
 * `useInternetIdentity` is mocked (see src/test/authMock.ts); the real
 * @caffeineai/core-infrastructure package does not resolve in jsdom.
 */
describe("Authentication gate", () => {
  it("shows the sign-in screen with both account options to an unauthenticated visitor", async () => {
    setAuthState({ isAuthenticated: false, identity: null });
    render(<App />);

    expect(
      await screen.findByRole("heading", {
        name: "Sign in to Sentinel Command",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Individual Account")).toBeInTheDocument();
    expect(screen.getByText("Company Account")).toBeInTheDocument();
    // The dashboard must not render for an unauthenticated visitor.
    expect(
      screen.queryByRole("heading", { name: "Overview" }),
    ).not.toBeInTheDocument();
  });

  it("signs in with the Individual account and reaches the dashboard with the badge", async () => {
    setAuthState({ isAuthenticated: false, identity: null });
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("heading", {
      name: "Sign in to Sentinel Command",
    });
    await user.click(screen.getByText("Individual Account"));
    await user.click(
      screen.getByRole("button", { name: /Continue with Internet Identity/ }),
    );

    expect(login).toHaveBeenCalled();

    // Simulate Internet Identity completing authentication.
    act(() => {
      setAuthState({ isAuthenticated: true, identity: mockIdentity() });
    });

    expect(
      await screen.findByRole("heading", { name: "Overview" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Individual Account")).toBeInTheDocument();
  });

  it("signs in with the Company account and reaches the dashboard with the badge", async () => {
    setAuthState({ isAuthenticated: false, identity: null });
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("heading", {
      name: "Sign in to Sentinel Command",
    });
    await user.click(screen.getByText("Company Account"));
    await user.click(
      screen.getByRole("button", { name: /Continue with Internet Identity/ }),
    );

    expect(login).toHaveBeenCalled();

    act(() => {
      setAuthState({ isAuthenticated: true, identity: mockIdentity() });
    });

    expect(
      await screen.findByRole("heading", { name: "Overview" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Company Account")).toBeInTheDocument();
  });

  it("persists the signed-in account type across a page refresh", async () => {
    // Simulate a prior sign-in that stored the account type under the principal.
    window.localStorage.setItem(
      "sentinel.accountType.test-principal-aaaaa",
      "company",
    );
    setAuthState({ isAuthenticated: true, identity: mockIdentity() });
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Overview" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Company Account")).toBeInTheDocument();
  });

  it("signs out, returns to the sign-in screen, and blocks dashboard routes", async () => {
    setAuthState({ isAuthenticated: true, identity: mockIdentity() });
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("heading", { name: "Overview" });
    await user.click(screen.getByRole("button", { name: "Sign out" }));

    expect(clear).toHaveBeenCalled();

    act(() => {
      setAuthState({ isAuthenticated: false, identity: null });
    });

    expect(
      await screen.findByRole("heading", {
        name: "Sign in to Sentinel Command",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Overview" }),
    ).not.toBeInTheDocument();
  });

  it("redirects a signed-in user on /signin to the dashboard", async () => {
    setAuthState({ isAuthenticated: true, identity: mockIdentity() });
    window.history.pushState({}, "", "/signin");
    window.dispatchEvent(new PopStateEvent("popstate"));
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Overview" }),
    ).toBeInTheDocument();
  });

  it("redirects a signed-out user on a dashboard route to the sign-in screen", async () => {
    setAuthState({ isAuthenticated: false, identity: null });
    window.history.pushState({}, "", "/live");
    window.dispatchEvent(new PopStateEvent("popstate"));
    render(<App />);

    expect(
      await screen.findByRole("heading", {
        name: "Sign in to Sentinel Command",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Live Status" }),
    ).not.toBeInTheDocument();
  });
});
