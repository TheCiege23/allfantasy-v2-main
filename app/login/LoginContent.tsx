"use client"

import Link from "next/link"
import { useState, useEffect, type CSSProperties } from "react"
import { signIn } from "next-auth/react"
import { useSearchParams, useRouter } from "next/navigation"
import { Loader2, TriangleAlert, Eye, EyeOff, CheckCircle2, X, ShieldCheck } from "lucide-react"
import { signupUrlWithIntent } from "@/lib/auth/auth-intent-resolver"
import { validateSignInInput } from "@/lib/auth/SignInFormController"
import { resolveLoginErrorMessage } from "@/lib/auth/AuthErrorMessageResolver"
import {
  clearUnifiedAuthDestination,
  rememberUnifiedAuthDestination,
  resolveUnifiedAuthDestination,
} from "@/lib/auth/UnifiedAuthOrchestrator"
import { NocturneAuthShell } from "@/components/auth/NocturneAuthShell"
import NocturneOAuthGrid from "@/components/auth/NocturneOAuthGrid"

const CARD_STYLE: CSSProperties = {
  maxWidth: 420,
  width: "100%",
  padding: 36,
  border: "1px solid var(--color-neutral-800)",
  borderRadius: "var(--radius-lg)",
  background: "var(--color-surface)",
}

function resolveSuccessfulLoginRedirect(callbackUrl: string | null | undefined): string {
  if (typeof callbackUrl === "string") {
    const trimmed = callbackUrl.trim()
    if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
      if (trimmed === "/") return "/dashboard"
      return trimmed
    }
  }
  return "/dashboard"
}

function NocturneBanner({
  tone,
  icon: Icon,
  children,
}: {
  tone: "error" | "accent"
  icon: typeof TriangleAlert
  children: React.ReactNode
}) {
  const isError = tone === "error"
  return (
    <div
      role={isError ? "alert" : undefined}
      style={{
        display: "flex",
        gap: 8,
        alignItems: "flex-start",
        marginBottom: 16,
        padding: "11px 13px",
        fontSize: 13,
        lineHeight: 1.5,
        borderRadius: "var(--radius-md)",
        border: `1px solid color-mix(in srgb, ${isError ? "var(--color-error)" : "var(--color-accent)"} 45%, transparent)`,
        background: "var(--color-neutral-900)",
        color: isError
          ? "color-mix(in srgb, #fff 82%, var(--color-error))"
          : "var(--color-neutral-300)",
      }}
    >
      <Icon size={16} style={{ marginTop: 1, flex: "none", color: isError ? "var(--color-error)" : "var(--color-accent-400)" }} />
      <div>{children}</div>
    </div>
  )
}

export default function LoginContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const callbackUrlParam = searchParams?.get("callbackUrl")
  const callbackUrl = resolveUnifiedAuthDestination({
    callbackUrl: callbackUrlParam,
    next: searchParams?.get("next"),
    returnTo: searchParams?.get("returnTo"),
    intent: searchParams?.get("intent"),
  })
  const postLoginRedirect = resolveSuccessfulLoginRedirect(callbackUrl)
  const isAdminLogin = callbackUrl.startsWith("/admin")
  const passwordReset = searchParams?.get("reset") === "1"
  const oauthErrorParam = searchParams?.get("error")

  const [loginId, setLoginId] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [devBypassLoading, setDevBypassLoading] = useState(false)

  const [adminPassword, setAdminPassword] = useState("")
  const [adminLoading, setAdminLoading] = useState(false)
  const [adminError, setAdminError] = useState<string | null>(null)
  const [adminRemaining, setAdminRemaining] = useState<number | null>(null)
  const [adminModalOpen, setAdminModalOpen] = useState(isAdminLogin)
  const [showAdminPassword, setShowAdminPassword] = useState(false)

  const [configError, setConfigError] = useState<string | null>(null)
  const showDevBypass = process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS_ENABLED === "true"

  useEffect(() => {
    rememberUnifiedAuthDestination(callbackUrl)
  }, [callbackUrl])

  useEffect(() => {
    fetch("/api/auth/config-check")
      .then((res) => (res.status === 503 ? res.json() : null))
      .then((data) => {
        if (data?.ok === false && data?.message) setConfigError(data.message)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (isAdminLogin) setAdminModalOpen(true)
  }, [isAdminLogin])

  useEffect(() => {
    if (!adminModalOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAdminModalOpen(false)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [adminModalOpen])

  async function handlePasswordLogin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const fd = new FormData(e.currentTarget)
    const loginRaw = (typeof fd.get("af-login") === "string" ? (fd.get("af-login") as string) : loginId) || ""
    const passwordRaw = (typeof fd.get("af-password") === "string" ? (fd.get("af-password") as string) : password) || ""
    const loginTrimmed = loginRaw.trim()
    setLoginId(loginTrimmed)
    setPassword(passwordRaw)

    if (!loginTrimmed) {
      setError("Please enter your email, username, or phone number.")
      return
    }
    if (!passwordRaw.trim()) {
      setError("Please enter your password.")
      return
    }
    const validation = validateSignInInput({ login: loginTrimmed, password: passwordRaw })
    if (!validation.ok) {
      setError(validation.error ?? "Something went wrong. Please try again.")
      return
    }

    setLoading(true)
    try {
      const result = await signIn("credentials", {
        login: loginTrimmed,
        password: passwordRaw,
        redirect: false,
        callbackUrl: postLoginRedirect,
      })
      if (result?.error) {
        setError(resolveLoginErrorMessage(result.error))
      } else {
        clearUnifiedAuthDestination()
        router.replace(postLoginRedirect)
      }
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  async function handleAdminLogin(e: React.FormEvent) {
    e.preventDefault()
    setAdminError(null)
    if (!adminPassword.trim()) {
      setAdminError("Enter your admin password.")
      return
    }
    setAdminLoading(true)
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: adminPassword, next: "/admin" }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        setAdminError(data?.error || "Sign-in failed. Please try again.")
        setAdminRemaining(typeof data?.remaining === "number" ? data.remaining : null)
        return
      }
      clearUnifiedAuthDestination()
      window.location.href = data.next || "/admin"
    } catch (err: any) {
      setAdminError(err?.message || "Sign-in failed. Please try again.")
    } finally {
      setAdminLoading(false)
    }
  }

  async function handleDevBypassLogin() {
    setError(null)
    setDevBypassLoading(true)
    try {
      const result = await signIn("dev-bypass", { redirect: false, callbackUrl: postLoginRedirect })
      if (result?.error) {
        setError("Local dev sign-in failed. Check DEV_AUTH_BYPASS_ENABLED in .env.local.")
      } else {
        clearUnifiedAuthDestination()
        window.location.assign(postLoginRedirect)
      }
    } catch {
      setError("Local dev sign-in failed. Check DEV_AUTH_BYPASS_ENABLED in .env.local.")
    } finally {
      setDevBypassLoading(false)
    }
  }

  return (
    <NocturneAuthShell
      navRight={
        <>
          New here?{" "}
          <Link href={signupUrlWithIntent(callbackUrl)} style={{ fontWeight: 600 }}>
            Create account
          </Link>
        </>
      }
    >
      <div className="card" style={CARD_STYLE}>
        <h1 style={{ fontSize: 26, lineHeight: 1.2, margin: "0 0 6px" }}>Welcome back</h1>
        <p style={{ fontSize: 14, color: "var(--color-neutral-500)", margin: "0 0 24px" }}>
          Sign in to your leagues.
        </p>

        {configError && (
          <NocturneBanner tone="accent" icon={TriangleAlert}>
            <strong>Sign-in temporarily unavailable.</strong> {configError}
          </NocturneBanner>
        )}
        {passwordReset && !error && (
          <NocturneBanner tone="accent" icon={CheckCircle2}>
            Password updated. Sign in with your new password.
          </NocturneBanner>
        )}
        {oauthErrorParam && !error && (
          <NocturneBanner tone="accent" icon={TriangleAlert}>
            {/* OAuthCallback fires when the PROVIDER rejects the callback (e.g. Spotify
                answering 403 to the profile request), not only when a cookie is missing.
                The old copy named the browser as the cause, sending users to clear cookies
                for something they cannot fix. Lead with the retry, offer the real fallback. */}
            {oauthErrorParam === "OAuthCallback"
              ? "Social sign-in couldn't complete. Please try again — if it keeps failing, sign in with your email and password instead."
              : oauthErrorParam === "OAuthAccountNotLinked"
                ? "This social account is already linked to a different AllFantasy account. Sign in with your original method and connect it from settings."
                : oauthErrorParam === "SOCIAL_EMAIL_UNVERIFIED"
                  ? "That sign-in method's email isn't verified, so we can't safely connect it to an existing account. Verify your email with that provider, or sign in with your original method first."
                  : "Social sign-in failed. Please try again or use your email and password."}
          </NocturneBanner>
        )}

        <form onSubmit={handlePasswordLogin} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="field">
            <label htmlFor="login-identifier">Email</label>
            <input
              id="login-identifier"
              name="af-login"
              className="input"
              type="text"
              value={loginId}
              onChange={(e) => setLoginId(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              disabled={loading}
              placeholder="you@example.com"
            />
          </div>

          <div className="field">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <label htmlFor="login-password" style={{ marginBottom: 0 }}>
                Password
              </label>
              <Link
                href={`/forgot-password?method=email&returnTo=${encodeURIComponent(callbackUrl)}`}
                style={{ fontSize: 12.5 }}
              >
                Forgot password?
              </Link>
            </div>
            <div style={{ position: "relative", marginTop: 5 }}>
              <input
                id="login-password"
                name="af-password"
                className="input"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                disabled={loading}
                placeholder="Your password"
                style={{ paddingRight: 44 }}
              />
              <button
                type="button"
                className="input-affordance"
                aria-label={showPassword ? "Hide password" : "Show password"}
                onClick={() => setShowPassword((v) => !v)}
              >
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </div>

          {error && (
            <NocturneBanner tone="error" icon={TriangleAlert}>
              {error}
            </NocturneBanner>
          )}

          <button
            type="submit"
            className="btn btn-primary btn-block"
            disabled={loading}
            style={{ minHeight: 46, fontSize: 15 }}
          >
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Signing in…
              </>
            ) : (
              "Sign in"
            )}
          </button>
        </form>

        {showDevBypass && (
          <div
            style={{
              marginTop: 16,
              padding: 16,
              borderRadius: "var(--radius-md)",
              border: "1px solid color-mix(in srgb, var(--color-accent) 35%, transparent)",
              background: "color-mix(in srgb, var(--color-accent) 8%, transparent)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontSize: 13, fontWeight: 600, color: "var(--color-accent-300)" }}>
              <ShieldCheck size={16} />
              Local Dev Access
            </div>
            <p style={{ fontSize: 12, lineHeight: 1.5, color: "var(--color-neutral-400)", margin: "0 0 12px" }}>
              Development-only bypass for localhost testing. Signs in as the local test user.
            </p>
            <button
              type="button"
              className="btn btn-secondary btn-block"
              onClick={handleDevBypassLogin}
              disabled={devBypassLoading}
            >
              {devBypassLoading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Signing in…
                </>
              ) : (
                "Continue as Local Dev User"
              )}
            </button>
          </div>
        )}

        <div className="n-divider" style={{ margin: "22px 0 16px" }}>
          <span>or continue with</span>
        </div>

        <NocturneOAuthGrid callbackUrl={postLoginRedirect} />

        <div style={{ textAlign: "center", marginTop: 22 }}>
          <button
            type="button"
            onClick={() => {
              setAdminError(null)
              setAdminRemaining(null)
              setAdminModalOpen(true)
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 12,
              color: "var(--color-neutral-600)",
            }}
          >
            <ShieldCheck size={13} />
            Secure admin access
          </button>
        </div>
      </div>

      {adminModalOpen && (
        <div
          className="n-dialog-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) setAdminModalOpen(false)
          }}
        >
          <div className="n-dialog">
            <button
              type="button"
              onClick={() => setAdminModalOpen(false)}
              aria-label="Close"
              style={{
                position: "absolute",
                right: 14,
                top: 14,
                padding: 4,
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--color-neutral-500)",
              }}
            >
              <X size={18} />
            </button>

            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <ShieldCheck size={20} style={{ color: "var(--color-accent-400)" }} />
              <h2 style={{ fontSize: 20 }}>Admin sign-in</h2>
            </div>
            <p style={{ fontSize: 13.5, color: "var(--color-neutral-500)", margin: "0 0 18px" }}>
              Restricted access. Enter your admin credentials to continue.
            </p>

            {adminError && (
              <NocturneBanner tone="error" icon={TriangleAlert}>
                {adminError}
                {typeof adminRemaining === "number" && (
                  <span style={{ marginLeft: 4, color: "var(--color-neutral-500)" }}>
                    ({adminRemaining} attempts remaining)
                  </span>
                )}
              </NocturneBanner>
            )}

            <form onSubmit={handleAdminLogin} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ position: "relative" }}>
                <input
                  className="input"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  type={showAdminPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Admin password"
                  disabled={adminLoading}
                  autoFocus
                  style={{ paddingRight: 44 }}
                />
                <button
                  type="button"
                  className="input-affordance"
                  onClick={() => setShowAdminPassword((v) => !v)}
                  aria-label={showAdminPassword ? "Hide password" : "Show password"}
                >
                  {showAdminPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
              <button
                type="submit"
                className="btn btn-primary btn-block"
                disabled={adminLoading || !adminPassword.trim()}
                style={{ minHeight: 46, fontSize: 15 }}
              >
                {adminLoading ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Signing in…
                  </>
                ) : (
                  "Sign in as admin"
                )}
              </button>
            </form>
          </div>
        </div>
      )}
    </NocturneAuthShell>
  )
}
