import { useSyncExternalStore } from "react";
import { vi } from "vitest";

/**
 * Controllable mock for `@caffeineai/core-infrastructure`'s
 * `useInternetIdentity` hook and `InternetIdentityProvider`.
 *
 * The real package fails to resolve in the jsdom test environment (its
 * dist/index.js imports a ./config module that is not present), and App.tsx's
 * auth gate depends on useInternetIdentity. Tests drive authentication state
 * through `setAuthState`, which notifies subscribers via `useSyncExternalStore`
 * so components re-render automatically when the mock state changes.
 *
 * `setup.ts` registers the `vi.mock` and resets the store to an authenticated
 * default before each test so the existing dashboard tests keep rendering the
 * dashboard.
 */

export interface MockPrincipal {
  toString(): string;
}

export interface MockIdentity {
  getPrincipal(): MockPrincipal;
}

export interface AuthState {
  identity: MockIdentity | null;
  isAuthenticated: boolean;
  isInitializing: boolean;
  isLoggingIn: boolean;
  isLoginError: boolean;
  loginError: Error | null;
  login: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
}

export const DEFAULT_PRINCIPAL = "test-principal-aaaaa";

export const login = vi.fn();
export const clear = vi.fn();

let state: AuthState = {
  identity: null,
  isAuthenticated: false,
  isInitializing: false,
  isLoggingIn: false,
  isLoginError: false,
  loginError: null,
  login,
  clear,
};

const listeners = new Set<() => void>();

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): AuthState {
  return state;
}

export function setAuthState(overrides: Partial<AuthState>) {
  state = { ...state, ...overrides };
  emitChange();
}

export function resetAuthState() {
  state = {
    identity: null,
    isAuthenticated: false,
    isInitializing: false,
    isLoggingIn: false,
    isLoginError: false,
    loginError: null,
    login,
    clear,
  };
  emitChange();
}

export function mockIdentity(
  principal: string = DEFAULT_PRINCIPAL,
): MockIdentity {
  return {
    getPrincipal: () => ({ toString: () => principal }),
  };
}

export function useInternetIdentityMock() {
  return useSyncExternalStore(subscribe, getSnapshot);
}
