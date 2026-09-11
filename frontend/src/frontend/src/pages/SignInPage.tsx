import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ACCOUNT_TYPE_LABELS, type AccountType } from "@/lib/auth";
import { useAuth } from "@/lib/useAuth";
import { cn } from "@/lib/utils";
import { Navigate } from "@tanstack/react-router";
import {
  Building2,
  Loader2,
  ShieldCheck,
  User,
} from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";

const ACCOUNT_OPTIONS: {
  type: AccountType;
  icon: typeof User;
  title: string;
  description: string;
}[] = [
  {
    type: "individual",
    icon: User,
    title: "Individual Account",
    description:
      "Use your account and credentials for your enterprise endpoints.",
  },
  {
    type: "company",
    icon: Building2,
    title: "Company Account",
    description:
      "Company account we consider valid for your enterprise endpoints.",
  },
];

export default function SignInPage() {
  const {
    isAuthenticated,
    isInitializing,
    isLoggingIn,
    isLoginError,
    loginError,
    login,
    accountType,
    setAccountType,
  } = useAuth();

  const [selected, setSelected] = useState<AccountType>(
    accountType ?? "individual",
  );
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const handleLogin = () => {
    setAccountType(selected);
    login(username, password, selected);
  };

  if (isAuthenticated) {
    return <Navigate to="/" />;
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <motion.aside
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4 }}
        className="relative hidden overflow-hidden bg-sidebar text-sidebar-foreground lg:flex lg:flex-col lg:justify-between gradient-signin"
      >
        {/* Drifting orbs */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
        >
          <div className="absolute -left-16 top-24 size-72 rounded-full bg-signin-accent/20 blur-3xl animate-drift" />
          <div
            className="absolute right-10 top-1/3 size-56 rounded-full bg-signin-accent/15 blur-3xl animate-drift"
            style={{ animationDelay: "2s" }}
          />
          <div
            className="absolute bottom-24 left-1/4 size-64 rounded-full bg-signin-accent/10 blur-3xl animate-drift"
            style={{ animationDelay: "4s" }}
          />
        </div>

        {/* Geometric network grid */}
        <svg
          aria-hidden="true"
          className="absolute inset-0 h-full w-full opacity-[0.12]"
          viewBox="0 0 800 800"
          preserveAspectRatio="xMidYMid slice"
        >
          <defs>
            <pattern
              id="grid"
              width="48"
              height="48"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 48 0 L 0 0 0 48"
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
              />
            </pattern>
          </defs>
          <rect width="800" height="800" fill="url(#grid)" />
          <g fill="currentColor">
            <circle cx="120" cy="180" r="3" />
            <circle cx="300" cy="120" r="2.5" />
            <circle cx="520" cy="260" r="3" />
            <circle cx="680" cy="140" r="2.5" />
            <circle cx="200" cy="420" r="2.5" />
            <circle cx="460" cy="520" r="3" />
            <circle cx="640" cy="620" r="2.5" />
            <circle cx="140" cy="640" r="3" />
          </g>
          <g stroke="currentColor" strokeWidth="1">
            <line x1="120" y1="180" x2="300" y2="120" />
            <line x1="300" y1="120" x2="520" y2="260" />
            <line x1="520" y1="260" x2="680" y2="140" />
            <line x1="200" y1="420" x2="460" y2="520" />
            <line x1="460" y1="520" x2="640" y2="620" />
            <line x1="140" y1="640" x2="460" y2="520" />
          </g>
        </svg>

        <div className="relative z-10 flex items-center gap-3 px-10 pt-10">
          <div className="flex size-11 items-center justify-center rounded-xl gradient-signin-accent text-signin-accent-foreground shadow-elevated">
            <ShieldCheck className="size-6" aria-hidden="true" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="font-display text-xl font-bold tracking-tight">
              Sentinel Command
            </span>
            <span className="text-[11px] font-medium uppercase tracking-widest text-sidebar-foreground/60">
              Endpoint Security
            </span>
          </div>
        </div>

        <div className="relative z-10 px-10 pb-10">
          <h1 className="max-w-md font-display text-4xl font-bold leading-tight tracking-tight md:text-5xl">
            Secure. Monitor. Manage.
          </h1>
          <p className="mt-4 max-w-md text-base leading-relaxed text-sidebar-foreground/70">
            Complete visibility for your enterprise endpoints — health, risk,
            and compliance at a glance.
          </p>
          <div className="mt-8 flex flex-wrap gap-2 font-mono text-xs text-sidebar-foreground/60">
            <span className="rounded-md border border-sidebar-border bg-sidebar-accent/40 px-2.5 py-1">
              Linux
            </span>
            <span className="rounded-md border border-sidebar-border bg-sidebar-accent/40 px-2.5 py-1">
              Windows
            </span>
            <span className="rounded-md border border-sidebar-border bg-sidebar-accent/40 px-2.5 py-1">
              macOS
            </span>
          </div>
        </div>
      </motion.aside>

      {/* Auth form */}
      <div className="flex items-center justify-center bg-background px-4 py-10 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="w-full max-w-md"
        >
          <div className="mb-6 flex items-center gap-2.5 lg:hidden">
            <div className="flex size-9 items-center justify-center rounded-lg gradient-signin-accent text-signin-accent-foreground">
              <ShieldCheck className="size-5" aria-hidden="true" />
            </div>
            <span className="font-display text-lg font-bold tracking-tight text-foreground">
              Sentinel Command
            </span>
          </div>

          <div className="rounded-2xl border border-border bg-card p-8 shadow-auth md:p-10">
            <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
              Sign in to Sentinel Command
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Choose your account type and enter your credentials.
            </p>

            <div className="mt-6 grid gap-4">
              {ACCOUNT_OPTIONS.map((option, index) => {
                const Icon = option.icon;
                const isSelected = selected === option.type;
                return (
                  <motion.button
                    key={option.type}
                    type="button"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: 0.15 + index * 0.06 }}
                    onClick={() => setSelected(option.type)}
                    aria-pressed={isSelected}
                    className={cn(
                      "group flex items-start gap-4 rounded-2xl border p-4 text-left transition-all duration-200",
                      "hover:-translate-y-0.5 hover:shadow-elevated",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isSelected
                        ? "border-primary bg-card ring-2 ring-primary gradient-subtle"
                        : "border-border bg-card hover:border-primary/40",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-11 shrink-0 items-center justify-center rounded-xl transition-colors",
                        isSelected
                          ? "gradient-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground group-hover:text-foreground",
                      )}
                    >
                      <Icon className="size-5" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-display text-base font-semibold text-foreground">
                          {option.title}
                        </span>
                        <span
                          aria-hidden="true"
                          className={cn(
                            "flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                            isSelected
                              ? "border-primary bg-primary"
                              : "border-border",
                          )}
                        >
                          {isSelected && (
                            <span className="size-2 rounded-full bg-primary-foreground" />
                          )}
                        </span>
                      </span>
                      <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">
                        {option.description}
                      </span>
                    </span>
                  </motion.button>
                );
              })}
            </div>

            {/* Credentials form */}
            <div className="mt-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  Username
                </label>
                <Input
                  type="text"
                  placeholder="Enter your username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={isLoggingIn || isInitializing}
                  className="w-full"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  Password
                </label>
                <Input
                  type="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoggingIn || isInitializing}
                  className="w-full"
                  onKeyPress={(e) => {
                    if (e.key === "Enter" && username && password) {
                      handleLogin();
                    }
                  }}
                />
              </div>
            </div>

            <Button
              type="button"
              size="lg"
              onClick={handleLogin}
              disabled={
                isLoggingIn || isInitializing || !username || !password
              }
              className="mt-6 w-full gradient-signin-accent text-signin-accent-foreground shadow-elevated transition-all hover:shadow-auth"
            >
              {isLoggingIn ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <ShieldCheck className="size-4" aria-hidden="true" />
              )}
              {isLoggingIn ? "Signing in…" : "Sign In"}
            </Button>

            {isLoginError && loginError && (
              <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {loginError.message}
              </div>
            )}

            <p className="mt-4 text-center text-xs leading-relaxed text-muted-foreground">
              Use your Django dashboard credentials to sign in.
            </p>
          </div>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            © {new Date().getFullYear()} Sentinel Command · Endpoint Security
          </p>
        </motion.div>
      </div>
    </div>
  );
}
