"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { loginUrlWithIntent } from "@/lib/auth/auth-intent-resolver"
import { resolveSignupRedirectPath } from "@/lib/auth/SignupFlowController"
import { rememberUnifiedAuthDestination } from "@/lib/auth/UnifiedAuthOrchestrator"
import { getTermsUrl, getPrivacyUrl, getNoGamblingPolicyUrl } from "@/lib/legal/LegalRouteResolver"
import { getPasswordStrength } from "@/lib/signup/PasswordStrengthResolver"
import { validateSignupAgreements } from "@/lib/signup/AgreementAcceptanceService"
import { useOptionalLanguage } from "@/components/i18n/LanguageProviderClient"
import { useThemeMode } from "@/components/theme/ThemeProvider"
import { resolveLanguage } from "@/lib/i18n/constants"
import { trackLandingSignupComplete } from "@/lib/landing-analytics"
import { trackMetaEventsFromResponse } from "@/lib/meta-client"
import { useGeoRestriction } from "@/lib/geo/useGeoRestriction"
import { NocturneAuthShell } from "@/components/auth/NocturneAuthShell"
import NocturneOAuthGrid from "@/components/auth/NocturneOAuthGrid"
import { Loader2, TriangleAlert, Eye, EyeOff, CheckCircle2, ShieldCheck } from "lucide-react"

/** Password-strength segment colors, level 1 → 4 (weak → strong). */
const STRENGTH_COLORS = [
  "var(--color-error)", // 1 · weak
  "var(--color-accent-2-500)", // 2 · fair
  "var(--color-accent-400)", // 3 · good
  "var(--color-accent)", // 4 · strong
]

const CARD_STYLE: React.CSSProperties = {
  maxWidth: 420,
  width: "100%",
  padding: 36,
  border: "1px solid var(--color-neutral-800)",
  borderRadius: "var(--radius-lg)",
  background: "var(--color-surface)",
}

/**
 * Honest, non-enumerating copy for a beta-admission rejection surfaced via `?betaError=`
 * (set when an OAuth signup is refused). Mirrors the server's admissionErrorMessage, kept
 * here as a small client map because the server module is server-only.
 */
function resolveBetaErrorMessage(code: string): string {
  switch (code) {
    case "INVITE_REQUIRED":
      return "AllFantasy is in a closed beta — you need an invitation to create an account."
    case "INVITE_EXPIRED":
      return "That invitation has expired. Ask your inviter for a new one."
    case "INVITE_REVOKED":
      return "That invitation is no longer active."
    case "INVITE_REDEEMED":
      return "That invitation has already been used."
    case "INVITE_EMAIL_MISMATCH":
      return "That invitation was issued for a different email address."
    case "GATE_UNAVAILABLE":
      return "We couldn't verify your invitation right now. Please try again in a moment."
    default:
      return "That invitation link isn't valid."
  }
}

export default function SignupContent() {
  const { language } = useOptionalLanguage()
  const { mode } = useThemeMode()
  const searchParams = useSearchParams()
  const nextParam = searchParams?.get("next") ?? undefined
  const postSignupDestination = useMemo(
    () =>
      resolveSignupRedirectPath({
        callbackUrl: searchParams?.get("callbackUrl"),
        next: searchParams?.get("next"),
        returnTo: searchParams?.get("returnTo"),
        intent: searchParams?.get("intent"),
      }),
    [searchParams]
  )
  const refParam = searchParams?.get("ref")?.trim() || undefined
  // Closed-beta (P0-1 BETA-GATE). The admission token normally rides an httpOnly cookie set
  // at /api/auth/beta/claim; `?invite=` is a secondary carry for a pasted token. `beta=1`
  // shows the closed-beta context; `betaError` is the honest reason from an OAuth rejection.
  const inviteParam = searchParams?.get("invite")?.trim() || undefined
  const betaMode = searchParams?.get("beta") === "1"
  const betaErrorCode = searchParams?.get("betaError")?.trim() || undefined
  const betaErrorMessage = betaErrorCode ? resolveBetaErrorMessage(betaErrorCode) : undefined

  const [fullName, setFullName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [consentChecked, setConsentChecked] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState(false)
  const [emailVerificationPrepared, setEmailVerificationPrepared] = useState(true)
  const signupConversionTrackedRef = useRef(false)
  const geo = useGeoRestriction()

  const passwordStrength = useMemo(() => getPasswordStrength(password), [password])
  const passwordsMatch = useMemo(
    () => confirmPassword.length > 0 && password === confirmPassword,
    [password, confirmPassword]
  )

  useEffect(() => {
    rememberUnifiedAuthDestination(postSignupDestination)
  }, [postSignupDestination])

  const trackSignupConversion = useCallback((source: string) => {
    if (signupConversionTrackedRef.current) return
    signupConversionTrackedRef.current = true
    trackLandingSignupComplete({ existing_user: false, source })
  }, [])

  const handleConsentChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setConsentChecked(e.target.checked)
    if (e.target.checked) setError("")
  }, [])

  const submitDisabled =
    loading ||
    !fullName.trim() ||
    !email.trim() ||
    !password ||
    !confirmPassword ||
    password !== confirmPassword ||
    !passwordStrength.valid ||
    !consentChecked

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError("")

    try {
      // One consent checkbox drives all three backend agreement booleans in
      // lockstep (age/disclaimer/terms) — deliberate: minimal UI, unchanged
      // consent contract. Do not split back into separate checkboxes.
      const agreements = validateSignupAgreements({
        ageConfirmed: consentChecked,
        disclaimerAgreed: consentChecked,
        termsAgreed: consentChecked,
      })
      if (!agreements.ok) {
        setError(agreements.error)
        return
      }
      if (password !== confirmPassword) {
        setError("Passwords do not match.")
        return
      }

      // No username field — the server generates one from the display name and
      // marks the profile incomplete so onboarding can collect the real handle.
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          password,
          displayName: fullName.trim(),
          ageConfirmed: consentChecked,
          disclaimerAgreed: consentChecked,
          termsAgreed: consentChecked,
          verificationMethod: "EMAIL",
          preferredLanguage: resolveLanguage(language),
          themePreference: mode,
          referralCode: refParam,
          inviteToken: inviteParam,
        }),
      })

      let data: Record<string, unknown> = {}
      let responseText = ""
      try {
        responseText = await res.text()
        data = responseText ? (JSON.parse(responseText) as Record<string, unknown>) : {}
      } catch {
        data = {}
      }

      if (!res.ok) {
        if (data.code === "DB_UNAVAILABLE") {
          setError("Our servers are briefly unavailable. Please try again in a moment.")
        } else {
          const backendError =
            typeof data.error === "string"
              ? data.error.trim()
              : responseText && !responseText.trim().startsWith("<")
                ? responseText.trim()
                : ""
          setError(backendError || "Account creation failed. Please try again.")
        }
        return
      }

      trackMetaEventsFromResponse(data)
      trackSignupConversion(refParam ? "signup_form_referral" : "signup_form")

      if (typeof data.emailVerificationPrepared === "boolean") {
        setEmailVerificationPrepared(data.emailVerificationPrepared)
      }
      setSuccess(true)
    } catch (err: unknown) {
      console.error("[signup] Create account failed:", err)
      const message = err instanceof Error ? err.message.trim() : ""
      setError(message || "Something went wrong. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  // ── Geo: fully blocked ────────────────────────────────────────────────────
  if (!geo.loading && geo.isFullyBlocked) {
    const sc = geo.stateCode ?? "WA"
    return (
      <div
        className="nocturne-auth flex min-h-screen items-center justify-center"
        style={{ padding: 24 }}
      >
        <div className="card" style={{ ...CARD_STYLE, textAlign: "center" }}>
          <img
            src="/brand/af-shield-transparent.png"
            alt=""
            style={{ height: 48, width: "auto", margin: "0 auto 20px" }}
          />
          <h1 style={{ fontSize: 22, lineHeight: 1.25, margin: "0 0 10px" }}>
            AllFantasy isn&apos;t available in {geo.stateName ?? sc}
          </h1>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--color-neutral-400)", margin: "0 0 22px" }}>
            State law prohibits fantasy sports services here, so account creation is not available from
            this location.
          </p>
          <Link
            href={`/geo-blocked?state=${encodeURIComponent(sc)}`}
            className="btn btn-primary btn-block"
            style={{ minHeight: 46, fontSize: 15 }}
          >
            View details
          </Link>
        </div>
      </div>
    )
  }

  // ── Success: check your inbox ─────────────────────────────────────────────
  if (success) {
    return (
      <NocturneAuthShell
        navRight={
          <>
            Already have an account?{" "}
            <Link href={loginUrlWithIntent(postSignupDestination)} style={{ fontWeight: 600 }}>
              Sign in
            </Link>
          </>
        }
      >
        <div className="card" style={{ ...CARD_STYLE, textAlign: "center" }}>
          <div
            style={{
              width: 48,
              height: 48,
              margin: "0 auto 18px",
              display: "grid",
              placeItems: "center",
              borderRadius: "var(--radius-md)",
              background: "var(--color-accent-900)",
            }}
          >
            <CheckCircle2 size={26} style={{ color: "var(--color-accent-400)" }} />
          </div>
          <h1 style={{ fontSize: 24, lineHeight: 1.2, margin: "0 0 8px" }}>Check your inbox</h1>
          {emailVerificationPrepared ? (
            <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--color-neutral-400)", margin: "0 0 8px" }}>
              We sent a verification link to <strong style={{ color: "var(--color-text)" }}>{email}</strong>.
              Verify it and sign in — you&apos;ll choose your username and finish your profile (photo,
              timezone) next.
            </p>
          ) : (
            <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--color-neutral-400)", margin: "0 0 8px" }}>
              Your account was created, but email verification is briefly unavailable. Sign in to continue
              and retry verification from your account.
            </p>
          )}
          <p style={{ fontSize: 12.5, color: "var(--color-neutral-600)", margin: "0 0 24px" }}>
            Check your spam and junk folders if it doesn&apos;t arrive within a couple of minutes.
          </p>
          <Link
            href={loginUrlWithIntent(postSignupDestination)}
            className="btn btn-primary btn-block"
            style={{ minHeight: 46, fontSize: 15 }}
          >
            Go to sign in
          </Link>
        </div>
      </NocturneAuthShell>
    )
  }

  // ── Create account form ───────────────────────────────────────────────────
  return (
    <NocturneAuthShell
      navRight={
        <>
          Already have an account?{" "}
          <Link href={loginUrlWithIntent(postSignupDestination)} style={{ fontWeight: 600 }}>
            Sign in
          </Link>
        </>
      }
    >
      <div className="card" style={CARD_STYLE}>
        <h1 style={{ fontSize: 26, lineHeight: 1.2, margin: "0 0 6px" }}>Create your account</h1>
        <p style={{ fontSize: 14, color: "var(--color-neutral-500)", margin: "0 0 6px" }}>
          Free to start — no gambling, no DFS.
        </p>
        <p style={{ fontSize: 11.5, lineHeight: 1.5, color: "var(--color-neutral-500)", margin: "0 0 24px" }}>
          AllFantasy is a fantasy sports management and intelligence platform. It does not offer sports betting,
          wagering, DFS contests, or gambling.
        </p>

        {(betaMode || betaErrorMessage) && (
          <div
            role={betaErrorMessage ? "alert" : undefined}
            style={{
              marginBottom: 16,
              padding: "11px 13px",
              fontSize: 13,
              lineHeight: 1.5,
              borderRadius: "var(--radius-md)",
              border: betaErrorMessage
                ? "1px solid color-mix(in srgb, var(--color-error) 45%, transparent)"
                : "1px solid var(--color-neutral-800)",
              background: "var(--color-surface-2, transparent)",
              color: "var(--color-neutral-300)",
            }}
          >
            {/* Signup is OPEN — an invite link is a welcome, not a requirement. Only the
                error variant (unreachable while the gate is off) still mentions invitations. */}
            {betaErrorMessage ?? "Welcome to AllFantasy. Signup is open — create your account below to get started."}{" "}
            <Link href={loginUrlWithIntent(postSignupDestination)} style={{ fontWeight: 600 }}>
              Already have an account? Sign in
            </Link>
          </div>
        )}

        {error && (
          <div
            role="alert"
            style={{
              display: "flex",
              gap: 8,
              alignItems: "flex-start",
              marginBottom: 16,
              padding: "11px 13px",
              fontSize: 13,
              lineHeight: 1.5,
              borderRadius: "var(--radius-md)",
              border: "1px solid color-mix(in srgb, var(--color-error) 45%, transparent)",
              background: "var(--color-neutral-900)",
              color: "color-mix(in srgb, #fff 82%, var(--color-error))",
            }}
          >
            <TriangleAlert size={16} style={{ marginTop: 1, flex: "none", color: "var(--color-error)" }} />
            <div>{error}</div>
          </div>
        )}

        {!geo.loading && geo.isPaidBlocked && geo.stateCode ? (
          <div
            style={{
              marginBottom: 16,
              padding: "11px 13px",
              fontSize: 13,
              lineHeight: 1.55,
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--color-neutral-800)",
              background: "color-mix(in srgb, var(--color-surface) 60%, transparent)",
              color: "var(--color-neutral-400)",
            }}
          >
            You can create a free account, but paid leagues and subscriptions aren&apos;t available in{" "}
            {geo.stateName ?? geo.stateCode} due to state law.{" "}
            <Link href={`/paid-restricted?state=${encodeURIComponent(geo.stateCode)}`}>Learn more</Link>
          </div>
        ) : null}

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="field">
            <label htmlFor="signup-fullname">Full name</label>
            <input
              id="signup-fullname"
              className="input"
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Jordan Rivera"
              autoComplete="name"
              required
            />
          </div>

          <div className="field">
            <label htmlFor="signup-email">Email</label>
            <input
              id="signup-email"
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </div>

          <div className="field">
            <label htmlFor="signup-password">Password</label>
            <div style={{ position: "relative" }}>
              <input
                id="signup-password"
                className="input"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                autoComplete="new-password"
                minLength={8}
                required
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
            <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
              {[1, 2, 3, 4].map((seg) => (
                <div
                  key={seg}
                  style={{
                    height: 3,
                    flex: 1,
                    borderRadius: 2,
                    background:
                      seg <= passwordStrength.level
                        ? STRENGTH_COLORS[passwordStrength.level - 1]
                        : "var(--color-neutral-800)",
                  }}
                />
              ))}
            </div>
            {password.length > 0 && (
              <p
                style={{
                  fontSize: 12,
                  margin: "6px 0 0",
                  color: passwordStrength.valid ? "var(--color-accent-400)" : "var(--color-neutral-500)",
                }}
              >
                {passwordStrength.label}
              </p>
            )}
          </div>

          <div className="field">
            <label htmlFor="signup-confirm">Confirm password</label>
            <input
              id="signup-confirm"
              className="input"
              type={showPassword ? "text" : "password"}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter your password"
              autoComplete="new-password"
              minLength={8}
              required
            />
            {confirmPassword.length > 0 && (
              <p
                style={{
                  fontSize: 12,
                  margin: "6px 0 0",
                  color: passwordsMatch ? "var(--color-accent-400)" : "var(--color-error)",
                }}
              >
                {passwordsMatch ? "Passwords match." : "Passwords do not match."}
              </p>
            )}
          </div>

          <label
            style={{
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
              fontSize: 13,
              lineHeight: 1.5,
              color: "var(--color-neutral-400)",
            }}
          >
            <input
              type="checkbox"
              checked={consentChecked}
              onChange={handleConsentChange}
              required
              aria-required="true"
              style={{ accentColor: "var(--color-accent)", width: 16, height: 16, flex: "none", marginTop: 1 }}
            />
            <span>
              I&apos;m 18+ and agree to the{" "}
              <Link href={getTermsUrl(true, nextParam)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                Terms
              </Link>
              ,{" "}
              <Link href={getPrivacyUrl(true, nextParam)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                Privacy Policy
              </Link>{" "}
              and{" "}
              <Link href={getNoGamblingPolicyUrl(true, nextParam)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                No-Gambling Policy
              </Link>
              .
            </span>
          </label>

          <button
            type="submit"
            className="btn btn-primary btn-block"
            disabled={submitDisabled}
            style={{ minHeight: 46, fontSize: 15 }}
          >
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Creating account…
              </>
            ) : (
              "Create account"
            )}
          </button>
        </form>

        <div className="n-divider" style={{ margin: "22px 0 16px" }}>
          <span>or continue with</span>
        </div>

        <NocturneOAuthGrid callbackUrl={postSignupDestination} />

        <p
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            margin: "20px 0 0",
            fontSize: 12,
            color: "var(--color-neutral-600)",
          }}
        >
          <ShieldCheck size={13} />
          Fantasy sports only — never gambling or DFS.
        </p>
      </div>
    </NocturneAuthShell>
  )
}
