export type AuthSession = {
  email: string;
  signedInAt: string;
};

export const AUTH_STORAGE_KEY = "dermclose.auth.session";

/** Demo-only credentials — not real security. */
export const DEMO_EMAIL = "clinician@harborderm.com";
export const DEMO_PASSWORD = "harbor123";
export const DEMO_OTP = "424242";

export function isValidDemoLogin(email: string, password: string) {
  const normalized = email.trim().toLowerCase();
  if (!normalized.includes("@") || password.trim().length < 4) return false;
  if (normalized === DEMO_EMAIL && password === DEMO_PASSWORD) return true;
  return password.trim().length >= 4;
}

export function isValidDemoOtp(code: string) {
  return code.replace(/\s/g, "") === DEMO_OTP;
}

export function readSession(): AuthSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthSession;
    if (!parsed?.email || !parsed?.signedInAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeSession(session: AuthSession) {
  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
}

export function clearSession() {
  window.localStorage.removeItem(AUTH_STORAGE_KEY);
}
