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
        background: "rgba(0,0,0,0.6)",
      }}
    >
      <div
        style={{
          maxWidth: 420,
          width: "100%",
          padding: 28,
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--color-neutral-800)",
          background: "var(--color-surface)",
          color: "var(--color-neutral-200)",
        }}
      >
        <h2 id="af-age-prompt-title" style={{ fontSize: 20, margin: "0 0 10px" }}>
          Quick confirmation
        </h2>
        <p style={{ fontSize: 14, lineHeight: 1.6, margin: "0 0 18px", color: "var(--color-neutral-400)" }}>
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
          <p role="alert" style={{ fontSize: 13, margin: "0 0 14px", color: "var(--color-error)" }}>
            {error}
          </p>
        )}

        <div style={{ display: "flex", gap: 10 }}>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={submitting}
            className="btn btn-primary"
            style={{ flex: 1, minHeight: 44 }}
          >
            {submitting ? "Saving…" : "I'm 18+ and agree"}
          </button>
          <button
            type="button"
            onClick={dismiss}
            disabled={submitting}
            className="btn btn-secondary"
            style={{ minHeight: 44 }}
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  )
}
