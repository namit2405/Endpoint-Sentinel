import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { AccountType, AuthUser } from "./auth";
import {
  clearStoredAuth,
  clearStoredAccountType,
  getStoredAccountType,
  getStoredToken,
  getStoredUser,
  setStoredAccountType,
  setStoredAuth,
} from "./auth";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8001";

function useAuthState() {
  const [user, setUserState] = useState<AuthUser | null>(() => getStoredUser());
  const [token, setTokenState] = useState<string | null>(() => getStoredToken());
  const [accountType, setAccountTypeState] = useState<AccountType | null>(() =>
    getStoredAccountType(),
  );
  const [isInitializing, setIsInitializing] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isLoginError, setIsLoginError] = useState(false);
  const [loginError, setLoginError] = useState<Error | null>(null);

  // Initialize from storage (only once)
  useEffect(() => {
    const storedUser = getStoredUser();
    const storedToken = getStoredToken();
    const storedAccountType = getStoredAccountType();
    setUserState(storedUser);
    setTokenState(storedToken);
    setAccountTypeState(storedAccountType);
    setIsInitializing(false);
  }, []); // Empty dependency array - only run once

  const login = useCallback(async (username: string, password: string, accountTypeParam?: AccountType) => {
    setIsLoggingIn(true);
    setIsLoginError(false);
    setLoginError(null);

    try {
      // Use the passed accountType parameter instead of state
      const typeToUse = accountTypeParam || accountType || "individual";
      
      const response = await fetch(`${API_BASE_URL}/api/auth/login/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ username, password, account_type: typeToUse }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Invalid credentials");
      }

      const resolvedAccountType = data.account_type || typeToUse;
      const authUser: AuthUser = {
        id: data.user_id,
        username: data.username,
        email: data.email,
        accountType: resolvedAccountType,
        accountName:
          data.account_name || data.username ||
          (resolvedAccountType === "company" ? "Company Account" : "Individual Account"),
        createdAt: new Date().toISOString(),
      };

      setStoredAuth(authUser, data.token);
      setAccountTypeState(resolvedAccountType);
      setUserState(authUser);
      setTokenState(data.token);
    } catch (err) {
      setIsLoginError(true);
      setLoginError(err instanceof Error ? err : new Error("Login failed"));
    } finally {
      setIsLoggingIn(false);
    }
  }, []); // Empty dependency array - no dependencies needed

  const logout = useCallback(() => {
    clearStoredAuth();
    clearStoredAccountType();
    setUserState(null);
    setTokenState(null);
    setAccountTypeState(null);
  }, []);

  const setAccountType = useCallback((type: AccountType) => {
    setStoredAccountType(type);
    setAccountTypeState(type);
  }, []);

  return {
    user,
    token,
    isAuthenticated: !!user && !!token,
    isInitializing,
    isLoggingIn,
    isLoginError,
    loginError,
    login,
    logout,
    accountType,
    setAccountType,
  };
}

type AuthContextValue = ReturnType<typeof useAuthState>;

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const auth = useAuthState();
  return createElement(AuthContext.Provider, { value: auth }, children);
}

export function useAuth(): AuthContextValue {
  const auth = useContext(AuthContext);
  if (!auth) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return auth;
}
