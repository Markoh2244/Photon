"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  clearSession,
  readSession,
  writeSession,
  type AuthSession,
} from "@/lib/auth-session";

type AuthContextValue = {
  session: AuthSession | null;
  ready: boolean;
  signIn: (email: string) => void;
  signOut: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setSession(readSession());
    setReady(true);
  }, []);

  const signIn = useCallback((email: string) => {
    const next: AuthSession = {
      email: email.trim().toLowerCase(),
      signedInAt: new Date().toISOString(),
    };
    writeSession(next);
    setSession(next);
  }, []);

  const signOut = useCallback(() => {
    clearSession();
    setSession(null);
    router.replace("/signin");
  }, [router]);

  useEffect(() => {
    if (!ready) return;
    const onSignIn = pathname === "/signin";
    if (!session && !onSignIn) {
      router.replace(`/signin?next=${encodeURIComponent(pathname || "/")}`);
      return;
    }
    if (session && onSignIn) {
      router.replace("/");
    }
  }, [ready, session, pathname, router]);

  const value = useMemo(
    () => ({ session, ready, signIn, signOut }),
    [session, ready, signIn, signOut],
  );

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-mist text-sm text-black/50">
        Loading…
      </div>
    );
  }

  const onSignIn = pathname === "/signin";
  if (!session && !onSignIn) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-mist text-sm text-black/50">
        Redirecting to sign in…
      </div>
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
