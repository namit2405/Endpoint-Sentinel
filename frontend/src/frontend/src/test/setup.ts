import "@testing-library/jest-dom/vitest";
import { beforeEach, vi } from "vitest";
import {
  mockIdentity,
  resetAuthState,
  setAuthState,
  useInternetIdentityMock,
} from "./authMock";

// The real @caffeineai/core-infrastructure package fails to resolve in the
// jsdom test environment (its dist/index.js imports a ./config module that is
// not present), and App.tsx's auth gate depends on useInternetIdentity. Mock
// the package so tests can drive authentication state through setAuthState.
vi.mock("@caffeineai/core-infrastructure", () => ({
  InternetIdentityProvider: ({
    children,
  }: {
    children: React.ReactNode;
  }) => children,
  useInternetIdentity: useInternetIdentityMock,
}));

// Default to an authenticated session so the existing dashboard tests keep
// rendering the dashboard. Auth-flow tests override this explicitly.
beforeEach(() => {
  resetAuthState();
  setAuthState({ identity: mockIdentity(), isAuthenticated: true });
  window.localStorage.clear();
});

// jsdom does not implement ResizeObserver, which the shadcn Sidebar and
// Recharts ResponsiveContainer rely on. Provide a minimal no-op stub so the
// layout and charts render without throwing.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver =
    ResizeObserverStub as unknown as typeof ResizeObserver;
}

// jsdom does not implement pointer capture, which Radix Select relies on when
// opening its dropdown. Stub the methods so opening a Select does not throw.
if (typeof Element.prototype.hasPointerCapture !== "function") {
  Element.prototype.hasPointerCapture = () => false;
}
if (typeof Element.prototype.setPointerCapture !== "function") {
  Element.prototype.setPointerCapture = () => {};
}
if (typeof Element.prototype.releasePointerCapture !== "function") {
  Element.prototype.releasePointerCapture = () => {};
}

// jsdom does not implement scrollIntoView, which Radix Select calls on the
// selected option when the dropdown opens.
if (typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = () => {};
}

// jsdom does not implement URL.createObjectURL / revokeObjectURL, which the
// CSV export and report download rely on. Provide no-op stubs so the export
// path can be exercised (and spied on) in tests.
if (typeof URL.createObjectURL !== "function") {
  URL.createObjectURL = () => "blob:mock";
}
if (typeof URL.revokeObjectURL !== "function") {
  URL.revokeObjectURL = () => {};
}
