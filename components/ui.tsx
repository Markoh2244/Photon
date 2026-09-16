import Link from "next/link";

export function RoleNav({
  role,
  doctorTab = "assistant",
  inboxCount = 0,
}: {
  role: "doctor" | "patient";
  doctorTab?: "assistant" | "inbox";
  inboxCount?: number;
}) {
  return (
    <header className="border-b border-black/10 bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-clay">Harbor Dermatology</p>
          <p className="font-serif text-2xl">
            {role === "doctor" ? "DermClose AI" : "My prescriptions"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {role === "doctor" && (
            <nav className="flex rounded-full border border-black/10 p-1 text-sm">
              <Link
                href="/"
                className={`rounded-full px-4 py-1.5 ${
                  doctorTab === "assistant" ? "bg-ink text-white" : "text-black/60"
                }`}
              >
                Assistant
              </Link>
              <Link
                href="/inbox"
                className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 ${
                  doctorTab === "inbox" ? "bg-ink text-white" : "text-black/60"
                }`}
              >
                Inbox
                {inboxCount > 0 && (
                  <span
                    className={`rounded-full px-1.5 text-[10px] font-medium ${
                      doctorTab === "inbox"
                        ? "bg-white/20 text-white"
                        : "bg-clay/15 text-clay"
                    }`}
                  >
                    {inboxCount}
                  </span>
                )}
              </Link>
            </nav>
          )}
          <nav className="flex rounded-full border border-black/10 p-1 text-sm">
            <Link
              href="/"
              className={`rounded-full px-4 py-1.5 ${
                role === "doctor" ? "bg-mist text-ink" : "text-black/60"
              }`}
            >
              Doctor view
            </Link>
            <Link
              href="/patient"
              className={`rounded-full px-4 py-1.5 ${
                role === "patient" ? "bg-ink text-white" : "text-black/60"
              }`}
            >
              Patient view
            </Link>
          </nav>
        </div>
      </div>
    </header>
  );
}

export function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
      <h2 className="mb-3 font-medium">{title}</h2>
      {children}
    </div>
  );
}

export function Stars({ value, size = "sm" }: { value: number; size?: "sm" | "lg" }) {
  const rounded = Math.round(value);
  return (
    <span
      className={`tracking-tight text-clay ${size === "lg" ? "text-lg" : "text-sm"}`}
      aria-label={`${value.toFixed(1)} out of 5`}
    >
      {"★★★★★".slice(0, rounded)}
      <span className="text-black/20">{"★★★★★".slice(rounded)}</span>
    </span>
  );
}

export function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-mist px-2 py-0.5 text-xs text-black/60">{children}</span>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        className="w-full max-w-md rounded-2xl border border-black/10 bg-white p-5 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="confirm-dialog-title" className="font-medium text-ink">
          {title}
        </h2>
        <p id="confirm-dialog-message" className="mt-2 text-sm leading-6 text-black/70">
          {message}
        </p>
        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            className="rounded-lg px-4 py-2 text-sm text-black/60 hover:text-ink disabled:opacity-40"
            disabled={busy}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="rounded-lg bg-ink px-4 py-2 text-sm text-white disabled:opacity-40"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
