"use client"

import Link from "next/link"
import { ArrowRight, CheckCircle2 } from "lucide-react"
import { AuthStatusHeader, AuthStatusShell } from "@/components/auth/AuthStatusShell"

/**
 * Shared post-reset success screen for forgot-password and reset-password flows.
 * Extracted as its own module to keep route files smaller and avoid SWC parse edge cases
 * on large client components (see production build errors on nested success branches).
 */
export function PasswordResetSuccessState({ loginHref }: { loginHref: string }) {
  return (
    <AuthStatusShell navRightHref="/login" navRightLabel="Sign In">
      <div className="w-full max-w-[440px]">
        <AuthStatusHeader
          title="Password reset"
          subtitle="Your password was updated successfully."
        />
        <div
          className="rounded-[18px] border p-8"
          style={{
            boxShadow: "0 24px 80px color-mix(in srgb, var(--text) 10%, transparent)",
            borderColor: "color-mix(in srgb, var(--border) 100%, transparent)",
            background: "var(--panel)",
          }}
        >
          <div className="text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-500/20 bg-emerald-500/10">
              <CheckCircle2 className="h-7 w-7 text-emerald-400" />
            </div>
            <h1 className="mt-5 text-2xl font-semibold" style={{ color: "var(--text)" }}>
              You&apos;re back!
            </h1>
            <p className="mt-3 text-sm leading-6" style={{ color: "var(--muted)" }}>
              Your password has been updated. Loading your account...
            </p>
            <Link
              href={loginHref}
              className="mt-7 inline-flex items-center justify-center gap-2 rounded-[11px] bg-gradient-to-r from-cyan-500 to-blue-500 px-6 py-3 text-sm font-semibold transition hover:-translate-y-0.5 hover:opacity-90"
              style={{ color: "var(--on-accent-bg)" }}
            >
              <span>Jump Back In</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>
    </AuthStatusShell>
  )
}
