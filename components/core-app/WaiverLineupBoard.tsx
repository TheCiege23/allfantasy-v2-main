'use client'

import { useEffect, useState } from 'react'

import type { WaiverBoard, WaiverBoardState } from '@/lib/waivers/waiverBoard'

/**
 * Who is worth adding, ranked by what the add does to YOUR starting lineup.
 *
 * ⚠ IT ANSWERS A DIFFERENT QUESTION FROM THE TWO PANELS BELOW IT, AND THE ORDER MATTERS.
 * `WaiverIntel` prices a bid from market value and this league's bidding history; the AI panel
 * offers a written recommendation. Neither says how much a player would actually change your
 * week. So this sits FIRST — decide who helps, then decide what to pay — and every row names the
 * starter he would displace, because "over Patrick Queen" is the half a manager can act on.
 *
 * ⚠ AND IT IS NOT A "BEST AVAILABLE" LIST. A free agent projected for 14 points is worth nothing
 * to someone already starting three better players at that position. The ranked column is the
 * marginal gain, which also makes flex handling fall out instead of needing a rule.
 */

const REASON: Record<Exclude<WaiverBoardState, 'ok'>, string> = {
  no_team_claimed: 'we cannot tell which roster in this league is yours',
  no_roster: 'no roster rows imported for your team yet',
  no_scoring_settings: 'this league publishes no scoring settings, so nothing here can be priced',
  no_slots: 'this league publishes no starting slots, so there is no lineup to improve',
  no_projections: 'nothing on your roster could be projected under this league’s scoring yet',
}

export function WaiverLineupBoard({ leagueId }: { leagueId: string }) {
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
   * A panel that cannot form an opinion removes itself. The rest of this screen is the real
   * surface; a broken card sitting above working panels is worse than no card.
   */
  if (failed || !board) return null

  return (
    <section className="af-card af-wv-section af-wlb" data-testid="waiver-lineup-board">
      <div className="af-wv-section-head">
        <h2 className="af-label">Worth adding</h2>
        {board.state === 'ok' && board.currentLineupPoints != null ? (
          <span className="af-wv-section-note af-num">
            your lineup {board.currentLineupPoints}
            {board.week ? ` · wk ${board.week}` : ''}
          </span>
        ) : null}
      </div>

      {board.state !== 'ok' ? (
        <p className="af-wlb-why">{REASON[board.state]}</p>
      ) : board.candidates.length === 0 ? (
        // A finding, not an error — nobody available changes the lineup.
        <p className="af-wlb-why">
          nobody on the wire would improve your starting lineup this week
        </p>
      ) : (
        <ul className="af-wlb-list">
          {board.candidates.map((c) => (
            <li key={c.sleeperId} className="af-wlb-row">
              <span className="af-wlb-who">
                <span className="af-wlb-name">{c.name}</span>
                <span className="af-wlb-meta">
                  {c.position ?? '—'}
                  {c.team ? ` · ${c.team}` : ''} · proj{' '}
                  <span className="af-num">{c.projectedPoints.toFixed(1)}</span>
                </span>
              </span>
              {/* The headline. Everything else on the row justifies it. */}
              <span className="af-wlb-gain af-num">+{c.gain.toFixed(1)}</span>
              <span className="af-wlb-over">
                {c.displaces ? (
                  <>
                    over {c.displaces.name}{' '}
                    <span className="af-num">({c.displaces.projectedPoints.toFixed(1)})</span>
                  </>
                ) : (
                  // No incumbent to name; a blank here would read as a bug.
                  'fills an empty slot'
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/*
        Coverage rides with the ranking. A board built from a third of the wire is a different
        claim from one built off all of it, and nothing else on screen would say which.
      */}
      {board.notes.map((n) => (
        <p key={n} className="af-wlb-note">
          {n}
        </p>
      ))}
    </section>
  )
}

export default WaiverLineupBoard
