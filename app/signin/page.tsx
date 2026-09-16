import { Suspense } from "react";
import { SignInApp } from "@/components/SignInApp";

export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-mist text-sm text-black/50">
          Loading sign-in…
        </div>
      }
    >
      <SignInApp />
    </Suspense>
  );
}
