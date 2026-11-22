"use client"

/**
 * One-time 18+/terms confirmation for accounts that have none recorded.
 *
 * OAuth signups created accounts with `ageConfirmedAt` null: the /signup checkbox sat
 * directly above the provider buttons but was never passed to them, so the tick was
 * discarded. Those users then hit `isAgeConfirmed` gates — bracket entry, the settings
 * legal panel — and were told they had never confirmed their age.
 *
 * The signup path is fixed going forward, but existing accounts cannot be repaired by a
 * backfill: because the tick never reached the server, someone who checked the box is
 * indistinguishable from someone who never did, and stamping them all would fabricate a
 * legal attestation. The only honest repair is to ask once, which is what this does.
 *
 * Deliberately NOT a trap. "Not now" dismisses for the session, because the real feature
 * gates still protect the surfaces that require confirmation — this prompt exists to stop
 * users being confused later, not to hold the app hostage. It returns on the next session
 * until confirmed.
 */
import { useCallback, useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import Link from "next/link"
import { getTermsUrl, getPrivacyUrl } from "@/lib/legal/LegalRouteResolver"

/** Session-scoped so a dismissal does not persist past the tab. */
const DISMISS_KEY = "af_age_prompt_dismissed"

export default function AgeConfirmationPrompt() {
  const { status } = useSession()
  const [needsConfirm, setNeedsConfirm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    // Only ever ask a signed-in user, and never re-ask within a session.
    if (status !== "authenticated") return
    if (typeof window !== "undefined" && sessionStorage.getItem(DISMISS_KEY) === "1") return

    let cancelled = false
    void (async () => {
      try {
        const res = await fetch("/api/auth/confirm-age", { method: "GET" })
        if (!res.ok) return
        const data = (await res.json()) as { confirmed?: boolean }
        // Anything other than an explicit `false` leaves the prompt hidden. A malformed or
        // degraded response must not put a legal modal in front of someone.
        if (!cancelled && data?.confirmed === false) setNeedsConfirm(true)
      } catch {
        // Network failure — stay silent rather than guessing.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [status])

  const confirm = useCallback(async () => {
    setSubmitting(true)
    setError("")
    try {
      const res = await fetch("/api/auth/confirm-age", { method: "POST" })
      if (!res.ok) {
        setError("We couldn't save that. Please try again.")
        return
      }
      setNeedsConfirm(false)
    } catch {
      setError("We couldn't save that. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }, [])

  const dismiss = useCallback(() => {
    try {
      sessionStorage.setItem(DISMISS_KEY, "1")
    } catch {
      // Private mode / storage disabled — the prompt simply reappears. Acceptable.
    }
    setNeedsConfirm(false)
  }, [])

  if (!needsConfirm) return null

  /*
   * 🛑 EVERY TOKEN BELOW CARRIES A LITERAL FALLBACK, AND THE BUTTONS ARE STYLED INLINE. The
   * `--color-*` / `--radius-lg` tokens and the `.btn-primary` / `.btn-secondary` classes are
   * defined only in nocturne-auth.css and the landing's nocturne.css — and this prompt is
   * suppressed on auth routes (SafeGlobalChrome), so on every screen where it DOES render they
   * were unset. Measured 2026-11-20 on /core at 393x852: card background `rgba(0, 0, 0, 0)`, no
   * border, and both buttons as bare text, so the dialog read as loose text printed over the
   * page. The fallbacks are the app's dark palette; where the tokens exist they still win.
   */
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="af-age-prompt-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        background: "rgba(2,6,23,0.72)",
      }}
    >
      <div
        style={{
          maxWidth: 420,
          width: "100%",
          maxHeight: "calc(100dvh - 40px)",
          overflowY: "auto",
          padding: 24,
          borderRadius: "var(--radius-lg, 16px)",
          border: "1px solid var(--color-neutral-800, #1e293b)",
          background: "var(--color-surface, #0f172a)",
          color: "var(--color-neutral-200, #e2e8f0)",
          boxShadow: "0 20px 50px rgba(0,0,0,0.5)",
        }}
      >
        <h2 id="af-age-prompt-title" style={{ fontSize: 20, margin: "0 0 10px" }}>
          Quick confirmation
        </h2>
        <p style={{ fontSize: 14, lineHeight: 1.6, margin: "0 0 18px", color: "var(--color-neutral-400, #94a3b8)" }}>
          We don&apos;t have your age confirmation on file. Please confirm you&apos;re 18 or
          older and agree to the{" "}
          <Link href={getTermsUrl()} style={{ fontWeight: 600 }}>
            Terms
          </Link>{" "}
          and{" "}
          <Link href={getPrivacyUrl()} style={{ fontWeight: 600 }}>
            Privacy Policy
          </Link>
          . AllFantasy is a fantasy sports management platform — no betting, wagering, or DFS.
        </p>

        {error && (
          <p role="alert" style={{ fontSize: 13, margin: "0 0 14px", color: "var(--color-error, #f87171)" }}>
            {error}
          </p>
        )}

        <div style={{ display: "flex", gap: 10 }}>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={submitting}
            className="btn btn-primary"
            style={{
              flex: 1,
              minHeight: 44,
              padding: "10px 16px",
              borderRadius: 12,
              border: "none",
              background: "#22d3ee",
              color: "#020617",
              fontSize: 15,
              fontWeight: 700,
              cursor: "pointer",
              opacity: submitting ? 0.7 : 1,
            }}
          >
            {submitting ? "Saving…" : "I'm 18+ and agree"}
          </button>
          <button
            type="button"
            onClick={dismiss}
            disabled={submitting}
            className="btn btn-secondary"
            style={{
              minHeight: 44,
              padding: "10px 16px",
              borderRadius: 12,
              border: "1px solid var(--color-neutral-800, #334155)",
              background: "transparent",
              color: "var(--color-neutral-200, #e2e8f0)",
              fontSize: 15,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  )
}
