"use client"

import { useEffect, useState } from "react"
import { Gift } from "lucide-react"
import { isInIosAppClient } from "@/lib/platform/iosApp"
import { useProWeekOffer } from "@/lib/referral/useProWeekOffer"

/**
 * "Give a week, get a week" (lib/referral/proWeek.ts) beside a member's referral link: what a friend
 * bringing a league earns them both, and how much of this month's cap they have used.
 *
 * 🛑 Never inside the iOS app: it is not mounted there (checked after mount, the user agent is not
 * known on the server) and the endpoint answers `days: 0` to it anyway (App Store 3.1.1 / 3.1.3).
 */
export function ProWeekOfferCard({ testId = "referral-pro-week-offer" }: { testId?: string }) {
  const [inIosApp, setInIosApp] = useState(true)
  useEffect(() => setInIosApp(isInIosAppClient()), [])
  const offer = useProWeekOffer(!inIosApp)
  if (inIosApp || offer.days <= 0) return null
  const earned = offer.earnedInWindow
  const full = earned != null && offer.cap > 0 && earned >= offer.cap
  return (
    <div
      data-testid={testId}
      className="flex items-start gap-3 rounded-2xl border p-4"
      style={{ borderColor: "var(--border)", background: "var(--panel)" }}
    >
      <Gift className="mt-0.5 h-5 w-5 shrink-0" style={{ color: "var(--accent)" }} aria-hidden />
      <div className="min-w-0 text-sm">
        <p className="font-semibold" style={{ color: "var(--text)" }}>
          Give a week, get a week
        </p>
        <p className="mt-1" style={{ color: "var(--muted)" }}>
          When a friend joins with your link and brings a league (imports theirs or joins yours), you both get {offer.days} days of AF Pro, free.
          No card needed, for either of you.
        </p>
        {earned != null && offer.cap > 0 ? (
          <p className="mt-2 text-xs" style={{ color: "var(--muted)" }} data-testid={`${testId}-progress`}>
            {full
              ? `You've earned ${offer.cap} free weeks in the last 30 days, the most a month holds. Friends who join still get theirs.`
              : `You've earned ${earned} of ${offer.cap} free weeks in the last 30 days.`}
          </p>
        ) : null}
      </div>
    </div>
  )
}
