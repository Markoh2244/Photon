"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import {
  DEMO_EMAIL,
  DEMO_OTP,
  DEMO_PASSWORD,
  isValidDemoLogin,
  isValidDemoOtp,
} from "@/lib/auth-session";

type Step = "credentials" | "otp";

export function SignInApp() {
  const { signIn, session } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = useMemo(() => {
    const next = searchParams.get("next");
    return next && next.startsWith("/") ? next : "/";
  }, [searchParams]);

  const [step, setStep] = useState<Step>("credentials");
  const [email, setEmail] = useState(DEMO_EMAIL);
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-mist text-sm text-black/50">
        Already signed in — taking you in…
      </div>
    );
  }

  function onCredentials(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!isValidDemoLogin(email, password)) {
      setError("Use a clinic email and a password with at least 4 characters.");
      return;
    }
    setBusy(true);
    window.setTimeout(() => {
      setBusy(false);
      setStep("otp");
    }, 450);
  }

  function onOtp(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!isValidDemoOtp(otp)) {
      setError(`Invalid code. For this demo, use ${DEMO_OTP}.`);
      return;
    }
    setBusy(true);
    window.setTimeout(() => {
      signIn(email);
      setBusy(false);
      router.replace(nextPath);
    }, 450);
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-mist">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(196,92,38,0.12),_transparent_55%),linear-gradient(160deg,#f4f1ea_0%,#e8e2d6_45%,#f7f4ee_100%)]"
      />
      <div className="relative mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-16">
        <div className="mb-10 text-center">
          <p className="text-xs uppercase tracking-[0.22em] text-clay">Harbor Dermatology</p>
          <h1 className="mt-2 font-serif text-4xl text-ink">DermClose</h1>
          <p className="mt-3 text-sm text-black/60">
            Clinician sign-in for the prescribing assistant. Demo auth only — not production security.
          </p>
        </div>

        <div className="rounded-2xl border border-black/10 bg-white/90 p-6 shadow-sm backdrop-blur">
          <div className="mb-6 flex gap-2 text-xs uppercase tracking-[0.16em] text-black/40">
            <span className={step === "credentials" ? "text-clay" : undefined}>1 · Password</span>
            <span aria-hidden>·</span>
            <span className={step === "otp" ? "text-clay" : undefined}>2 · Two-factor</span>
          </div>

          {step === "credentials" ? (
            <form onSubmit={onCredentials} className="space-y-4">
              <label className="block text-sm">
                <span className="mb-1.5 block text-black/60">Work email</span>
                <input
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 outline-none focus:border-clay"
                  required
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1.5 block text-black/60">Password</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 outline-none focus:border-clay"
                  required
                />
              </label>
              {error && <p className="text-sm text-red-700">{error}</p>}
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-xl bg-ink px-4 py-2.5 text-sm text-white disabled:opacity-50"
              >
                {busy ? "Checking…" : "Continue"}
              </button>
            </form>
          ) : (
            <form onSubmit={onOtp} className="space-y-4">
              <p className="text-sm text-black/60">
                Enter the 6-digit code sent to <span className="font-medium text-ink">{email}</span>
                {" "}(simulated).
              </p>
              <label className="block text-sm">
                <span className="mb-1.5 block text-black/60">Authentication code</span>
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 tracking-[0.35em] outline-none focus:border-clay"
                  placeholder="••••••"
                  required
                />
              </label>
              {error && <p className="text-sm text-red-700">{error}</p>}
              <button
                type="submit"
                disabled={busy || otp.length < 6}
                className="w-full rounded-xl bg-ink px-4 py-2.5 text-sm text-white disabled:opacity-50"
              >
                {busy ? "Verifying…" : "Verify and enter clinic"}
              </button>
              <button
                type="button"
                className="w-full text-sm text-black/50 underline-offset-2 hover:underline"
                onClick={() => {
                  setStep("credentials");
                  setOtp("");
                  setError(null);
                }}
              >
                Use a different account
              </button>
            </form>
          )}
        </div>

        <div className="mt-6 rounded-2xl border border-dashed border-black/15 bg-white/50 px-4 py-3 text-xs text-black/55">
          <p className="font-medium text-ink">Demo credentials</p>
          <p className="mt-1">
            Email <code className="text-ink">{DEMO_EMAIL}</code> · password{" "}
            <code className="text-ink">{DEMO_PASSWORD}</code> · code{" "}
            <code className="text-ink">{DEMO_OTP}</code>
          </p>
          <p className="mt-2">
            This gate is clinic-app auth only. Signing a prescription in Photon Elements still uses Google SSO.
          </p>
        </div>
      </div>
    </div>
  );
}
