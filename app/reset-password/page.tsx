"use client"

import Link from "next/link"
import { useState, Suspense, useEffect, type CSSProperties, type ReactNode } from "react"
import { useSearchParams } from "next/navigation"
import { ArrowLeft, ArrowRight, Loader2, Eye, EyeOff, CheckCircle2, TriangleAlert } from "lucide-react"
import { AuthStatusHeader, AuthStatusLoadingFallback, AuthStatusShell } from "@/components/auth/AuthStatusShell"

type AuthMode = "checking" | "token" | "none"

const recoveryInputStyle: CSSProperties = {
  background: "var(--panel2)",
  color: "var(--text)",
  borderColor: "color-mix(in srgb, var(--border) 100%, transparent)",
}

const recoveryInputClassName =
  "w-full rounded-[10px] border px-3.5 py-3 text-sm outline-none transition placeholder:[color:var(--muted2)] focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10"

function RecoveryCard({
  children,
  danger = false,
}: {
  children: ReactNode
  danger?: boolean
}) {
  return (
    <div
      className="rounded-[18px] border p-8"
      style={{
        boxShadow: "0 24px 80px color-mix(in srgb, var(--text) 10%, transparent)",
        ...(danger
          ? {
              borderColor: "color-mix(in srgb, var(--accent-red) 35%, var(--border))",
              background: "color-mix(in srgb, var(--accent-red) 8%, var(--panel))",
            }
          : {
              borderColor: "color-mix(in srgb, var(--border) 100%, transparent)",
              background: "var(--panel)",
            }),
      }}
    >
      {children}
    </div>
  )
}

function RecoveryError({ error }: { error: string | null }) {
  if (!error) return null
  return (
    <div
      className="mb-4 rounded-xl border border-red-500/25 p-3 text-sm"
      style={{
        background: "color-mix(in srgb, var(--accent-red) 10%, transparent)",
        color: "var(--text)",
      }}
    >
      <div className="flex items-start gap-2">
        <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" />
        <div>{error}</div>
      </div>
    </div>
  )
}

function ResetPasswordContent() {
  const searchParams = useSearchParams()
  const token = searchParams?.get("token") || ""
  const requestedReturnTo = searchParams?.get("returnTo") || ""
  const safeReturnTo = requestedReturnTo.startsWith("/") ? requestedReturnTo : "/dashboard"
  const loginHref = `/login?callbackUrl=${encodeURIComponent(safeReturnTo)}`

  const [authMode, setAuthMode] = useState<AuthMode>("checking")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (token) {
      setAuthMode("token")
    } else {
      setAuthMode("none")
    }
  }, [token])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (password.length < 8) {
      setError("Password must be at least 8 characters.")
      return
    }

    if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      setError("Password must include at least one letter and one number.")
      return
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.")
      return
    }

    setLoading(true)
    try {
      const res = await fetch("/api/auth/password/reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: password }),
      })

      const data = await res.json()

      if (!res.ok) {
        const errorMap: Record<string, string> = {
          MISSING_FIELDS: "Token and new password are required.",
          WEAK_PASSWORD: "Password must be at least 8 characters with a letter and number.",
          INVALID_OR_USED_TOKEN: "This reset link is invalid or has already been used.",
          EXPIRED_TOKEN: "This reset link has expired. Please request a new one.",
          RESET_FAILED: "Something went wrong saving your password. Please try again.",
        }
        setError(errorMap[data.error] || data.error || "Something went wrong.")
        return
      }

      setSuccess(true)
      setTimeout(() => {
        window.location.href = `${loginHref}&reset=success`
      }, 2000)
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  if (authMode === "checking") {
    return (
      <AuthStatusShell navRightHref="/login" navRightLabel="Sign In">
        <div className="w-full max-w-[440px]">
          <AuthStatusHeader title="Loading" subtitle="Checking your reset session…" />
          <RecoveryCard>
            <div className="flex justify-center py-4">
              <div
                className="flex h-14 w-14 items-center justify-center rounded-2xl border"
                style={{
                  borderColor: "color-mix(in srgb, var(--accent-cyan) 25%, var(--border))",
                  background: "color-mix(in srgb, var(--accent-cyan) 10%, transparent)",
                }}
              >
                <Loader2 className="h-7 w-7 animate-spin" style={{ color: "var(--accent-cyan-strong)" }} />
              </div>
            </div>
          </RecoveryCard>
        </div>
      </AuthStatusShell>
    )
  }

  if (authMode === "none" && !token) {
    return (
      <AuthStatusShell navRightHref="/login" navRightLabel="Sign In">
        <div className="w-full max-w-[440px]">
          <AuthStatusHeader
            title="Invalid reset link"
            subtitle="Open the link from your password reset email, or request a new one."
          />
          <RecoveryCard>
            <div className="text-center">
              <div
                className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border"
                style={{
                  borderColor: "color-mix(in srgb, var(--accent-amber-strong) 25%, var(--border))",
                  background: "color-mix(in srgb, var(--accent-amber) 10%, transparent)",
                }}
              >
                <TriangleAlert className="h-7 w-7" style={{ color: "var(--accent-amber-strong)" }} />
              </div>
              <h1 className="mt-5 text-2xl font-semibold" style={{ color: "var(--text)" }}>
                Session required
              </h1>
              <p className="mt-3 text-sm leading-6" style={{ color: "var(--muted)" }}>
                We couldn&apos;t verify a password reset session. Use the link from your email, or request a new reset.
              </p>
              <Link
                href="/forgot-password"
                className="mt-7 inline-flex items-center justify-center gap-2 rounded-[11px] bg-gradient-to-r from-cyan-500 to-blue-500 px-6 py-3 text-sm font-semibold transition hover:-translate-y-0.5 hover:opacity-90"
                style={{ color: "var(--on-accent-bg)" }}
              >
                <span>Request reset</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </RecoveryCard>
        </div>
      </AuthStatusShell>
    )
  }

  if (success) {
    return (
      <AuthStatusShell navRightHref="/login" navRightLabel="Sign In">
        <div className="w-full max-w-[440px]">
          <AuthStatusHeader
            title="Password reset"
            subtitle="Your password was updated successfully."
          />
          <RecoveryCard>
            <div className="text-center">
              <div
                className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border"
                style={{
                  borderColor: "color-mix(in srgb, var(--accent-emerald-strong) 25%, var(--border))",
                  background: "color-mix(in srgb, var(--accent-emerald) 10%, transparent)",
                }}
              >
                <CheckCircle2 className="h-7 w-7" style={{ color: "var(--accent-emerald-strong)" }} />
              </div>
              <h1 className="mt-5 text-2xl font-semibold" style={{ color: "var(--text)" }}>
                Password reset
              </h1>
              <p className="mt-3 text-sm leading-6" style={{ color: "var(--muted)" }}>
                Your password has been updated. Redirecting to sign in...
              </p>
              <Link
                href={loginHref}
                className="mt-7 inline-flex items-center justify-center gap-2 rounded-[11px] bg-gradient-to-r from-cyan-500 to-blue-500 px-6 py-3 text-sm font-semibold transition hover:-translate-y-0.5 hover:opacity-90"
                style={{ color: "var(--on-accent-bg)" }}
              >
                <span>Sign In</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </RecoveryCard>
        </div>
      </AuthStatusShell>
    )
  }

  return (
    <AuthStatusShell navRightHref="/login" navRightLabel="Sign In">
      <div className="w-full max-w-[440px]">
        <Link
          href={loginHref}
          className="mb-6 inline-flex items-center gap-2 rounded-[10px] border px-4 py-2.5 text-sm font-medium transition hover:opacity-90"
          style={{
            borderColor: "color-mix(in srgb, var(--border) 100%, transparent)",
            background: "var(--panel2)",
            color: "var(--muted)",
          }}
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Sign In</span>
        </Link>

        <AuthStatusHeader
          title="Set new password"
          subtitle="Choose a strong new password for your AllFantasy account."
        />

        <RecoveryError error={error} />

        <RecoveryCard>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                className="text-[13px] font-semibold tracking-[0.02em]"
                style={{ color: "var(--muted)" }}
              >
                New password
              </label>
              <div className="relative mt-1.5">
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  className={`${recoveryInputClassName} pr-11`}
                  style={recoveryInputStyle}
                  placeholder="At least 8 characters"
                  disabled={loading}
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 transition [color:var(--muted)] hover:[color:var(--accent-cyan-strong)]"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div>
              <label
                className="text-[13px] font-semibold tracking-[0.02em]"
                style={{ color: "var(--muted)" }}
              >
                Confirm password
              </label>
              <input
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                type="password"
                autoComplete="new-password"
                className={`mt-1.5 ${recoveryInputClassName}`}
                style={recoveryInputStyle}
                placeholder="Confirm your new password"
                disabled={loading}
              />
            </div>
            <button
              type="submit"
              disabled={loading || !password || !confirmPassword}
              className="flex w-full items-center justify-center gap-2 rounded-[11px] bg-gradient-to-r from-cyan-500 to-blue-500 px-4 py-3 text-sm font-semibold transition hover:-translate-y-0.5 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              style={{ color: "var(--on-accent-bg)" }}
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Resetting...
                </>
              ) : (
                <>
                  <span>Reset Password</span>
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>
        </RecoveryCard>
      </div>
    </AuthStatusShell>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<AuthStatusLoadingFallback />}>
      <ResetPasswordContent />
    </Suspense>
  )
}
