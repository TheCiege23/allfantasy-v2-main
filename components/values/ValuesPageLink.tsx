'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

/**
 * A link to `/player-values`, shown only where it is relevant.
 *
 * 🛑 THE RULES, AND THE FOURTH ONE IS THE IMPORTANT ONE:
 *   IDP + kickers → "defenders and kickers"
 *   IDP only      → "defenders"
 *   kickers only  → "kickers"
 *   neither       → RENDER NOTHING
 *
 * The last case is not an empty state or a disabled link — it is no element at all. A manager
 * in a league that starts neither has no use for the page, and a permanent link on every
 * screen is noise that trains people to ignore the surface.
 *
 * ⚠ THE COPY FOLLOWS THE ELIGIBILITY, NOT THE OTHER WAY ROUND. Offering "defenders and
 * kickers" to a league with no kicker slot advertises a number that does not exist there,
 * which is a small version of exactly the dishonesty the values page was built to correct.
 *
 * Scope: pass `leagueId` on a league surface to ask about THAT league; omit it on `/core` to
 * ask whether ANY league the manager is in qualifies. See
 * `lib/values/valueSurfaceEligibility.ts` for why those are different questions.
 */

type Eligibility = { hasIdp: boolean; hasKicker: boolean; eligible: boolean }

export function ValuesPageLink({
  leagueId,
  className,
  compact = false,
}: {
  /** Omit for the user-scoped question asked on /core. */
  leagueId?: string
  className?: string
  /**
   * Render as a single line rather than a card.
   *
   * ⚠ FOR SURFACES THAT ALREADY HAVE A LIST IDIOM — /core's TOOLS rail is a row of
   * `af3a-tool` links, and dropping a bordered card into it would look like a bug rather
   * than an entry. The eligibility rules are identical in both shapes; only the markup differs.
   */
  compact?: boolean
}) {
  const [data, setData] = useState<Eligibility | null>(null)

  useEffect(() => {
    let live = true
    setData(null)
    /* Rides the existing /api/idp/players endpoint — the route budget is at its ceiling. */
    const qs = leagueId
      ? `leagueId=${encodeURIComponent(leagueId)}&view=value-eligibility`
      : 'view=value-eligibility'
    fetch(`/api/idp/players?${qs}`)
      .then(async (r) => (r.ok ? ((await r.json()) as Eligibility) : null))
      .then((p) => live && setData(p))
      /* A failed lookup shows nothing. A link is never worth breaking a page over. */
      .catch(() => live && setData(null))
    return () => {
      live = false
    }
  }, [leagueId])

  if (!data?.eligible) return null

  const what =
    data.hasIdp && data.hasKicker ? 'defenders and kickers' : data.hasIdp ? 'defenders' : 'kickers'

  if (compact) {
    return (
      <Link href="/player-values" data-testid="values-page-link" className={className}>
        <i>◎</i>
        {data.hasIdp && data.hasKicker
          ? 'Defender & kicker values'
          : data.hasIdp
            ? 'Defender values'
            : 'Kicker values'}
      </Link>
    )
  }

  return (
    <Link
      href="/player-values"
      data-testid="values-page-link"
      className={
        className ??
        'group flex items-center justify-between gap-3 rounded-[13px] border border-white/[0.07] bg-[#0d1020] px-[13px] py-3 no-underline transition-colors hover:border-white/[0.14]'
      }
    >
      <div>
        <div className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-[#5d648a]">
          How we value {what}
        </div>
        <div className="mt-1 text-[12px] leading-[1.45] text-[#c3c9e6]">
          No market prices {what}. See the measurements behind our numbers — including where
          they say we cannot tell you.
        </div>
      </div>
      <div
        aria-hidden
        className="font-mono text-[15px] font-black text-[#5d648a] transition-colors group-hover:text-[#22d3ee]"
      >
        →
      </div>
    </Link>
  )
}
