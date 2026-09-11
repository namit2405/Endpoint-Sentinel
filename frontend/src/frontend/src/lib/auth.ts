/**
 * Simple local authentication for Django backend.
 * Stores user credentials and session token locally.
 */

export type AccountType = "individual" | "company";

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  individual: "Individual Account",
  company: "Company Account",
};

const STORAGE_KEY_PREFIX = "sentinel.auth";
const USER_KEY = `${STORAGE_KEY_PREFIX}.user`;
const TOKEN_KEY = `${STORAGE_KEY_PREFIX}.token`;
const ACCOUNT_TYPE_KEY = `${STORAGE_KEY_PREFIX}.accountType`;

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  accountType: AccountType;
  accountName: string;
  createdAt: string;
}

export function getStoredUser(): AuthUser | null {
  try {
    const raw = window.localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function getStoredToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredAuth(user: AuthUser, token: string): void {
  try {
    window.localStorage.setItem(USER_KEY, JSON.stringify(user));
    window.localStorage.setItem(TOKEN_KEY, token);
    window.localStorage.setItem(ACCOUNT_TYPE_KEY, user.accountType);
  } catch {
    // Storage may be unavailable
  }
}

export function clearStoredAuth(): void {
  try {
    window.localStorage.removeItem(USER_KEY);
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(ACCOUNT_TYPE_KEY);
  } catch {
    // Ignore storage failures
  }
}

export function getStoredAccountType(): AccountType | null {
  try {
    const raw = window.localStorage.getItem(ACCOUNT_TYPE_KEY);
    return (raw === "individual" || raw === "company") ? raw : null;
  } catch {
    return null;
  }
}

export function setStoredAccountType(type: AccountType): void {
  try {
    window.localStorage.setItem(ACCOUNT_TYPE_KEY, type);
  } catch {
    // Storage may be unavailable
  }
}

export function clearStoredAccountType(): void {
  try {
    window.localStorage.removeItem(ACCOUNT_TYPE_KEY);
  } catch {
    // Ignore storage failures
  }
}
