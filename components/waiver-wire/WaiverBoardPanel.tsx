'use client'

import { useEffect, useState } from 'react'

import type { WaiverBoard, WaiverBoardState } from '@/lib/waivers/waiverBoard'

/**
 * Who is worth adding, ranked by what the add does to YOUR lineup.
 *
 * ⚠ THIS SITS ABOVE THE WAIVER WIRE RATHER THAN REPLACING IT. `WaiverWirePage` handles claims,
 * FAAB, watchlists and automation — the mechanics of getting a player. It has never answered the
 * question before it: which of these is worth getting. The AI route that was supposed to
 * (`/api/ai/waivers/recommend`) returns the literal `["WR_depth","RB_depth","TE_upgrade"]` to
 * every manager in every league, because every query it makes throws on a column or model that
 * does not exist.
 *
 * ⚠ THE GAIN IS THE POINT, NOT THE PROJECTION. Sorting by projected points reproduces a rankings
 * page — a 14-point running back tops the board whether or not you already start three better
 * ones. The number that matters is how much your best lineup improves, which is why the
 * displaced starter is named on every row: "over Patrick Queen" is the actionable half.
 */

const REASON: Record<Exclude<WaiverBoardState, 'ok'>, string> = {
  no_team_claimed: 'Claim your team in this league and the board appears here.',
  no_roster: 'No roster rows imported for your team yet.',
  no_scoring_settings: 'We don’t hold this league’s scoring settings, so nothing here can be priced.',
  no_slots: 'We don’t hold this league’s starting slots, so there’s no lineup to improve.',
  no_projections: 'Nothing on your roster could be projected under this league’s scoring yet.',
}

export function WaiverBoardPanel({ leagueId }: { leagueId: string }) {
  const [board, setBoard] = useState<WaiverBoard | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    setBoard(null)
    setFailed(false)
    fetch(`/api/idp/players?leagueId=${encodeURIComponent(leagueId)}&view=waiver-board&limit=10`)
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status))
        return (await r.json()) as WaiverBoard
      })
      .then((b) => alive && setBoard(b))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [leagueId])

  /*
   * A panel that cannot say anything useful renders nothing at all rather than an empty card.
   * The waiver wire underneath it is the real surface; this is an opinion layered on top, and an
   * opinion with no content is just furniture.
   */
  if (failed) return null
  if (!board) {
    return (
      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <p className="font-mono text-[11px] text-white/35">Ranking the wire…</p>
      </section>
    )
  }
  if (board.state !== 'ok') {
    return (
      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <h2 className="text-sm font-semibold text-white">Worth adding</h2>
        <p className="mt-1.5 text-xs text-white/45">{REASON[board.state]}</p>
      </section>
    )
  }
  if (board.candidates.length === 0) {
    return (
      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <h2 className="text-sm font-semibold text-white">Worth adding</h2>
        {/* A real finding, not an error: nobody available improves the lineup. */}
        <p className="mt-1.5 text-xs text-white/45">
          Nobody on the wire would improve your starting lineup this week
          {board.currentLineupPoints != null ? ` (projected ${board.currentLineupPoints})` : ''}.
        </p>
      </section>
    )
  }

  return (
    <section className="rounded-xl border border-white/10 bg-black/20 p-4" data-testid="waiver-board-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-white">Worth adding</h2>
        <p className="font-mono text-[10px] uppercase tracking-wide text-white/35">
          your lineup {board.currentLineupPoints}
          {board.week ? ` · wk ${board.week}` : ''}
        </p>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[540px] text-left">
          <thead>
            <tr className="border-b border-white/10 font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-white/35">
              <th className="py-2 pr-2">Player</th>
              <th className="px-2 py-2">Pos</th>
              <th className="px-2 py-2 text-right">Proj</th>
              <th className="px-2 py-2 text-right text-emerald-300/80">Adds</th>
              <th className="px-2 py-2">Instead of</th>
            </tr>
          </thead>
          <tbody>
            {board.candidates.map((c) => (
              <tr key={c.sleeperId} className="border-b border-white/[0.05] last:border-0">
                <td className="py-2 pr-2">
                  <span className="text-[13px] font-semibold text-white/90">{c.name}</span>
                  {c.team ? <span className="ml-1.5 font-mono text-[10px] text-white/35">{c.team}</span> : null}
                </td>
                <td className="px-2 py-2 font-mono text-[11px] text-white/55">{c.position ?? '—'}</td>
                <td className="px-2 py-2 text-right font-mono text-[12px] text-white/80">
                  {c.projectedPoints.toFixed(1)}
                </td>
                {/* The headline. Everything else on the row exists to justify this number. */}
                <td className="px-2 py-2 text-right font-mono text-[13px] font-bold text-emerald-300">
                  +{c.gain.toFixed(1)}
                </td>
                <td className="px-2 py-2 text-[11px] text-white/45">
                  {c.displaces ? (
                    <>
                      {c.displaces.name}{' '}
                      <span className="font-mono text-white/30">({c.displaces.projectedPoints.toFixed(1)})</span>
                    </>
                  ) : (
                    // No incumbent to name — he fills a slot that is currently empty.
                    <span className="text-amber-200/70">an empty slot</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/*
        Coverage travels with the ranking. A board built from a third of the wire is a different
        claim from one built off all of it, and the reader cannot tell them apart otherwise.
      */}
      {board.notes.map((n) => (
        <p key={n} className="mt-2 text-[10px] leading-relaxed text-white/30">
          {n}
        </p>
      ))}
    </section>
  )
}
