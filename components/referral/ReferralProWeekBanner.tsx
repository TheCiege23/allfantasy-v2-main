"use client"

import Link from "next/link"
import { useState } from "react"
import { useProWeekOffer } from "@/lib/referral/useProWeekOffer"

/**
 * What a visitor who arrived on a friend's referral link is offered: bring a league, and you both get
 * a free week of AF Pro (lib/referral/proWeek.ts). Rendered by `ReferralTracker` only once the code is
 * known to be valid.
 *
 * Shown to SIGNED-OUT visitors only (`earnedInWindow === null`): a member already has an account, and
 * a referral never attaches to an existing account. 🛑 Never in the iOS app: the endpoint answers
 * `days: 0` there and the tracker does not mount this inside the app at all.
 */
export function ReferralProWeekBanner({ code }: { code: string }) {
  const offer = useProWeekOffer(true)
  const [dismissed, setDismissed] = useState(false)
  if (dismissed || offer.days <= 0 || offer.earnedInWindow !== null) return null
  return (
    <div
      role="region"
      aria-label="Referral offer"
      data-testid="referral-pro-week-banner"
      className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-xl items-center gap-3 rounded-2xl border px-4 py-3 text-sm shadow-lg"
      style={{ background: "var(--panel, #111827)", borderColor: "var(--border, #374151)", color: "var(--text, #f9fafb)" }}
    >
      <p className="min-w-0 flex-1">
        <span className="font-semibold">A friend invited you.</span>{" "}
        Import a league and you both get {offer.days} days of AF Pro, free. No card needed.
      </p>
      <Link
        href={`/signup?ref=${encodeURIComponent(code)}`}
        className="shrink-0 rounded-xl px-3 py-2 font-semibold"
        style={{ background: "var(--accent, #22d3ee)", color: "var(--bg, #0b1020)" }}
      >
        Get started
      </Link>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => setDismissed(true)}
        className="shrink-0 rounded-lg px-2 py-1"
        style={{ color: "var(--muted, #9ca3af)" }}
      >
        ×
      </button>
    </div>
  )
}
