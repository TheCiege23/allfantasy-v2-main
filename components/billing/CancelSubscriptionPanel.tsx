"use client"

import { useState } from "react"

/**
 * "Cancel my subscription" on the block pages — /paid-restricted (owner's call, 2026-10-02) and
 * /geo-blocked (fully blocked states, same day). The billing portal is refused there, so before this a
 * subscriber had no way to stop a charge.
 * Two steps (button, then confirm) because cancelling is immediate; see
 * app/api/account/cancel-subscription for the terms and why it has no geo check.
 */
export function CancelSubscriptionPanel({ hasStripe, hasApple }: { hasStripe: boolean; hasApple: boolean }) {
  const [step, setStep] = useState<"idle" | "confirm" | "busy" | "done" | "error">("idle")
  const [error, setError] = useState<string | null>(null)
  const [appleStillActive, setAppleStillActive] = useState(false)

  const cancel = async () => {
    setStep("busy")
    setError(null)
    try {
      const res = await fetch("/api/account/cancel-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: unknown; appleSubscriptionActive?: boolean }
      if (!res.ok) {
        setError(
          typeof data.error === "string" && data.error
            ? data.error
            : "We couldn't cancel your subscription just now. Please try again.",
        )
        setStep("error")
        return
      }
      setAppleStillActive(data.appleSubscriptionActive === true)
      setStep("done")
    } catch {
      setError("Couldn't reach AllFantasy. Check your connection and try again.")
      setStep("error")
    }
  }

  return (
    <section
      className="mb-8 rounded-2xl border border-amber-400/30 bg-amber-500/10 p-5 text-sm"
      aria-labelledby="paid-restricted-cancel-title"
      data-testid="paid-restricted-cancel"
    >
      <p id="paid-restricted-cancel-title" className="mb-2 font-semibold text-amber-100">
        You have an active subscription
      </p>

      {hasStripe && step === "done" ? (
        <p className="text-emerald-200" role="status" data-testid="paid-restricted-cancel-done">
          ✓ Your subscription is cancelled. You won&apos;t be charged again.
        </p>
      ) : hasStripe ? (
        <>
          <p className="mb-4 text-amber-50/80">
            You can&apos;t use it from where you are, so you can cancel it here. Cancelling is immediate, with no
            refund for the rest of the current billing period.
          </p>
          {step === "confirm" || step === "busy" ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void cancel()}
                disabled={step === "busy"}
                className="inline-flex min-h-[44px] items-center rounded-xl border border-red-400/50 bg-red-500/15 px-4 font-semibold text-red-100 disabled:opacity-60"
                data-testid="paid-restricted-cancel-confirm"
              >
                {step === "busy" ? "Cancelling…" : "Yes, cancel my subscription"}
              </button>
              <button
                type="button"
                onClick={() => setStep("idle")}
                disabled={step === "busy"}
                className="inline-flex min-h-[44px] items-center rounded-xl border border-white/15 px-4 font-semibold text-white/80"
              >
                Keep it
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setStep("confirm")}
              className="inline-flex min-h-[44px] items-center rounded-xl border border-white/20 bg-white/5 px-4 font-semibold text-white"
              data-testid="paid-restricted-cancel-start"
            >
              Cancel my subscription
            </button>
          )}
          {step === "error" && error ? (
            <p className="mt-3 text-red-200" role="alert" data-testid="paid-restricted-cancel-error">
              {error}
            </p>
          ) : null}
        </>
      ) : null}

      {hasApple || appleStillActive ? (
        <p className="mt-3 text-amber-50/80" data-testid="paid-restricted-cancel-apple">
          Subscribed in the iPhone app? Apple doesn&apos;t let us cancel that for you — open iPhone Settings → your
          name → Subscriptions → AllFantasy.
        </p>
      ) : null}
    </section>
  )
}
