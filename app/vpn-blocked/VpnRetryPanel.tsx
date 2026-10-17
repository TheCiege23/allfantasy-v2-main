"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { vpnKindCopy, type VpnKindCopy } from "./vpnKindCopy"

type Check =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "still_blocked"; copy: VpnKindCopy | null; at: string }

/**
 * "I turned it off — try again", made to answer.
 *
 * 🛑 THE BUTTON USED TO BE A PLAIN LINK BACK TO THE BLOCKED PAGE. When anything
 * was still hiding the connection — most often Safari's iCloud Private Relay
 * after the VPN app itself was switched off — the middleware redirected straight
 * back here and the page looked unchanged. Reported 2026-09-28 from the owner's
 * iPhone: "the screen just refreshes and stays the same".
 *
 * Now it asks /api/geo/vpn-status first (a forced recheck, so a cached block is
 * not replayed) and either goes on, or says WHAT is still on. Any failure to ask
 * falls back to the old behaviour — navigating and letting the middleware
 * decide — so this can never be the thing that keeps someone out.
 *
 * It also re-checks when the page comes back into view or the network returns:
 * an installed iPhone app resumes this page after the person visits Settings.
 * The href stays on the anchor so the button still works without JavaScript.
 *
 * And it re-checks ON ITS OWN, on the schedule below, so someone who turns the
 * VPN off goes straight in without touching the button (owner's request,
 * 2026-09-28). ⚠ EVERY CHECK CAN COST A VENDOR LOOKUP, so the schedule backs off
 * and then STOPS — nine checks over about five minutes — rather than polling
 * forever for someone who has walked away with the VPN still on. A hidden tab
 * skips its checks (coming back into view re-checks anyway), and tapping the
 * button starts the schedule over.
 */

/** Seconds before each automatic re-check, in order; after the last one it stops. */
export const AUTO_RECHECK_DELAYS_S: readonly number[] = [5, 10, 15, 20, 30, 30, 45, 60, 60]

type Mode = "manual" | "quiet" | "auto"

function clockTime(): string {
  return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })
}
export function VpnRetryPanel({ href, paidScope = false }: { href: string; paidScope?: boolean }) {
  const [check, setCheck] = useState<Check>({ state: "idle" })
  const [autoStep, setAutoStep] = useState(0)
  const [autoCheckedAt, setAutoCheckedAt] = useState<string | null>(null)
  const busy = useRef(false)

  const recheck = useCallback(
    async (mode: Mode) => {
      if (busy.current) return
      busy.current = true
      if (mode === "manual") setCheck({ state: "checking" })
      try {
        const res = await fetch(`/api/geo/vpn-status?recheck=1${paidScope ? "&scope=paid" : ""}`, {
          cache: "no-store",
          credentials: "same-origin",
        })
        const body = res.ok ? ((await res.json()) as { blocked?: unknown; kind?: unknown }) : null
        if (!body || body.blocked !== true) {
          window.location.replace(href)
          return
        }
        // An automatic check that finds nothing new stays quiet: the warning box is
        // the answer to someone who acted, not a banner that pops up while they read.
        if (mode === "auto") {
          setAutoCheckedAt(clockTime())
          return
        }
        setCheck({ state: "still_blocked", copy: vpnKindCopy(body.kind), at: clockTime() })
      } catch {
        // A failed automatic check is not a reason to navigate: that would reload
        // the page on every network blip. The button and the other triggers still
        // fall back to letting the middleware decide.
        if (mode !== "auto") window.location.replace(href)
      } finally {
        busy.current = false
      }
    },
    [href, paidScope],
  )

  useEffect(() => {
    if (autoStep >= AUTO_RECHECK_DELAYS_S.length) return
    const timer = window.setTimeout(() => {
      if (document.visibilityState === "hidden") {
        setAutoStep((step) => step + 1)
        return
      }
      void recheck("auto").finally(() => setAutoStep((step) => step + 1))
    }, AUTO_RECHECK_DELAYS_S[autoStep] * 1000)
    return () => window.clearTimeout(timer)
  }, [autoStep, recheck])

  const autoChecking = autoStep < AUTO_RECHECK_DELAYS_S.length

  useEffect(() => {
    let wasHidden = document.visibilityState === "hidden"
    const onVisibility = () => {
      if (document.visibilityState === "hidden") wasHidden = true
      else if (wasHidden) {
        wasHidden = false
        void recheck("quiet")
      }
    }
    const onOnline = () => void recheck("quiet")
    document.addEventListener("visibilitychange", onVisibility)
    window.addEventListener("online", onOnline)
    return () => {
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener("online", onOnline)
    }
  }, [recheck])

  return (
    <div className="mb-8">
      {check.state === "still_blocked" ? (
        <div
          role="status"
          aria-live="polite"
          className="mb-4 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-left text-sm leading-6 text-amber-100"
        >
          <p className="font-semibold text-amber-50">
            Checked again at {check.at} — we can still see {check.copy?.detected ?? "a VPN, proxy or privacy relay"}.
          </p>
          {check.copy ? (
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {check.copy.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-2">Work through the steps above, then try again.</p>
          )}
        </div>
      ) : null}
      <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
        <a
          href={href}
          onClick={(e) => {
            e.preventDefault()
            setAutoStep(0)
            void recheck("manual")
          }}
          aria-busy={check.state === "checking"}
          className="inline-flex rounded-xl bg-cyan-500/90 px-5 py-2.5 text-sm font-semibold text-slate-950"
        >
          {check.state === "checking" ? "Checking your connection…" : "I turned it off — try again"}
        </a>
        <a href="mailto:support@allfantasy.ai" className="text-sm text-cyan-400 hover:text-cyan-300">
          Contact Support
        </a>
      </div>
      <p data-testid="vpn-auto-recheck" className="mt-3 text-xs text-slate-400">
        {autoChecking
          ? "We're checking again automatically — once it's off, you'll go straight in."
          : "Stopped checking automatically. Tap the button once it's off."}
        {autoCheckedAt ? ` Last checked ${autoCheckedAt}.` : null}
      </p>
    </div>
  )
}
