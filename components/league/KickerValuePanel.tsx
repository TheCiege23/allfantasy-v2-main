'use client'

import { useEffect, useState } from 'react'

/**
 * What a kicker is worth in this league — one number, with the reason it is one number.
 *
 * 🛑 THIS PANEL EXISTS BECAUSE THE DEFENSE HUB CANNOT ANSWER FOR MOST LEAGUES. The hub renders
 * kickers too, but it only loads for leagues that roster defenders: 10 of 115 in production,
 * of which 5 start a kicker. NINETEEN leagues start one. The other fourteen see this panel and
 * nothing else.
 *
 * 🛑 AND IT SHOWS ONE VALUE ON PURPOSE. Measured over 4,482 kicker games (2019-2025), kicker
 * rank does not persist — negative in all six year-over-year season pairs (mean -0.455) and
 * effectively zero within a season, across a population spanning only 1.55x. Every kicker in a
 * league is worth the same because nothing we can measure separates them. Anyone adding a
 * per-kicker number here should read `lib/kicker-values/leagueKickerValue.ts` first.
 *
 * Renders NOTHING when the league starts no kicker. A kicker is not a zero-value asset there;
 * he is not an asset, and an empty-state telling a manager his kicker is worth nothing would
 * be a different and false claim.
 */

type KickerValue = {
  value: number | null
  replacementRank: number
  scarcity: number
  rankPredictability: 'none'
  basis: string
}

export function KickerValuePanel({ leagueId }: { leagueId: string }) {
  const [data, setData] = useState<KickerValue | null>(null)

  useEffect(() => {
    let live = true
    setData(null)
    /* Rides the existing /api/idp/players endpoint — the route budget is at its ceiling. */
    fetch(`/api/idp/players?leagueId=${encodeURIComponent(leagueId)}&view=kicker-value`)
      .then(async (r) => (r.ok ? ((await r.json()) as KickerValue) : null))
      .then((p) => live && setData(p))
      /* A failed lookup renders nothing. This is a side panel, never a reason to break My Team. */
      .catch(() => live && setData(null))
    return () => {
      live = false
    }
  }, [leagueId])

  if (!data || data.value == null) return null

  return (
    <section
      className="rounded-[13px] border border-white/[0.07] bg-[#0d1020] p-[13px]"
      data-testid="kicker-value-panel"
    >
      <div className="mb-2.5 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-[#5d648a]">
        Kicker value
      </div>

      <div className="flex items-baseline gap-2.5">
        <div className="font-mono text-[17px] font-black text-[#eef0fa]">
          {data.value.toLocaleString()}
        </div>
        <div className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-[#5d648a]">
          any kicker · replacement about K{data.replacementRank}
        </div>
      </div>

      <p className="mt-2 text-[11px] leading-[1.5] text-[#8f97bd]">{data.basis}</p>
    </section>
  )
}
