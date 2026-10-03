'use client'

import PlayerName from '@/components/core-app/player-card/PlayerName'

import { useEffect, useState } from 'react'

import { FOREIGN_IDS_UNREADABLE } from '@/lib/core-app/foreignIdSpaceCopy'
import type { WaiverBoard, WaiverBoardState } from '@/lib/waivers/waiverBoard'
import type { RosterNeeds } from '@/lib/waivers/rosterNeeds'
import { useWaiverIntel } from '@/components/decide/useWaiverIntel'
import { isPerGameBasis } from '@/lib/waivers/waiverSportBasis'

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
  // Imported, but unread: "no roster rows" would be false of a league whose ids we cannot match.
  ids_unreadable: FOREIGN_IDS_UNREADABLE.toLowerCase(),
  no_scoring_settings: 'this league publishes no scoring settings, so nothing here can be priced',
  no_slots: 'this league publishes no starting slots, so there is no lineup to improve',
  no_projections: 'nothing on your roster could be projected under this league’s scoring yet',
  // The note below names the sport and why; this line only says what that means for the wire.
  no_producer: 'nothing projects this sport’s players yet, so this wire cannot be priced',
}

export type WaiverLineupBoardProps = {
  leagueId: string
  /**
   * Set on a FAAB league. Each add then carries the bid the Waiver intelligence panel would suggest
   * for him — the same rule, the same request (useWaiverIntel), so the screen has ONE bid source.
   * `remaining` is your FAAB left, when the platform publishes it.
   */
  faab?: { remaining: number | null } | null
  /**
   * Set on a ROLLING-priority league with a published priority. A claim there sends you to the back
   * of the order, so the list says what that costs against what waiting costs — facts, not a verdict.
   */
  rollingPriority?: { priority: number; leagueRosters: number } | null
}

export function WaiverLineupBoard({ leagueId, faab = null, rollingPriority = null }: WaiverLineupBoardProps) {
  const [board, setBoard] = useState<WaiverBoard | null>(null)
  const [failed, setFailed] = useState(false)
  const { data: intelResponse } = useWaiverIntel(leagueId, faab != null)
  const bidQuotes = intelResponse && intelResponse.supported ? (intelResponse.intel?.bidQuotes ?? null) : null

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
  if (failed) return null
  /*
   * ⚠ LOADING HOLDS ITS PLACE. This used to return null until the fetch landed, so the card
   * appeared afterwards and pushed the bid pricing and everything below it down the page — on a
   * phone, mid-scroll. A placeholder of the same shape keeps the layout still; a failure still
   * removes the card entirely, per the rule above.
   */
  if (!board) {
    return (
      <section className="af-card af-wv-section af-wlb" data-testid="waiver-lineup-board-loading" aria-busy="true">
        <div className="af-wv-section-head">
          <h2 className="af-label">Worth adding</h2>
        </div>
        <div className="af-wlb-skel" aria-hidden />
        <div className="af-wlb-skel" aria-hidden />
        <div className="af-wlb-skel" aria-hidden />
      </section>
    )
  }

  /*
   * ⚠ OUTSIDE THE NFL EVERY NUMBER IS PER GAME, FROM A SEASON RATE — never "this week". The header,
   * each row and the empty state say so; the board's notes say which scoring priced it.
   */
  const perGame = isPerGameBasis(board.basis)
  const sport = board.sport ?? 'NFL'

  return (
    <section className="af-card af-wv-section af-wlb" data-testid="waiver-lineup-board">
      <div className="af-wv-section-head">
        <h2 className="af-label">Worth adding</h2>
        {board.state === 'ok' && board.currentLineupPoints != null ? (
          <span className="af-wv-section-note af-num">
            {/* The BEST lineup your roster can field — not the one set on the platform. */}
            your best lineup {board.currentLineupPoints}
            {perGame ? ' per game' : board.week ? ` · wk ${board.week}` : ''}
          </span>
        ) : null}
      </div>

      {board.state === 'ok' && board.needs ? <RosterNeedsStrip needs={board.needs} /> : null}

      {board.state !== 'ok' ? (
        <p className="af-wlb-why">{REASON[board.state]}</p>
      ) : board.candidates.length === 0 ? (
        // A finding, not an error — nobody available changes the lineup.
        <p className="af-wlb-why">
          {perGame
            ? 'nobody on the wire would improve your starting lineup per game'
            : 'nobody on the wire would improve your starting lineup this week'}
        </p>
      ) : (
        <ul className="af-wlb-list">
          {board.candidates.map((c) => (
            <li key={c.sleeperId ?? c.playerKey ?? c.name} className="af-wlb-row">
              <span className="af-wlb-who">
                <span className="af-wlb-name">
                  {/*
                    Opens the player card in this league's context (handoff STATE 7). Outside the
                    NFL there is no Sleeper id (`sleeperId` is null), so the name renders as text:
                    the card's other lookup is by `externalId`, which is not scoped to a provider,
                    and a college Rolling Insights number can be a CFBD row's number too.
                  */}
                  <PlayerName
                    sport={sport}
                    sleeperId={c.sleeperId}
                    name={c.name}
                    position={c.position}
                    team={c.team}
                    leagueId={leagueId}
                  />
                </span>
                <span className="af-wlb-meta">
                  {c.position ?? '—'}
                  {c.team ? ` · ${c.team}` : ''} · proj{' '}
                  <span className="af-num">{c.projectedPoints.toFixed(1)}</span>
                  {/* AllFantasy's own engine, beside the provider's figure. */}
                  {c.afProjectedPoints != null ? (
                    <>
                      {' · '}
                      <span className="af-wlb-af af-num" title="AllFantasy engine projection, adjusted to this league's scoring">
                        AF {c.afProjectedPoints.toFixed(1)}
                      </span>
                    </>
                  ) : null}
                  {/*
                    ⚠ A FORM NUMBER IS BACKWARD-LOOKING AND SAYS SO. It is a recency-weighted mean
                    of what he has actually scored here, used only where no projection feed covers
                    him. It knows nothing about a coming bye or a changed depth chart, so
                    rendering it identically to a real projection would make a forecast the
                    number never made. The design's LIMITED DATA chip is exactly this case.
                  */}
                  {c.basis === 'form' ? (
                    <span className="af-wlb-chip" title="No projection feed covers him — this is his recent scoring here">
                      form · {c.formGames}g
                    </span>
                  ) : null}
                  {c.basis === 'season_rate' ? (
                    <span
                      className="af-wlb-chip"
                      title="A per-game rate from AllFantasy's season projection, not a projection for this week"
                    >
                      per game · season
                    </span>
                  ) : null}
                  {/*
                    The bid, from the Waiver intelligence rule — the only bid source on this
                    screen. A player that rule has no market value for gets no figure, never a
                    made-up one; "over your $N left" is said rather than hidden.
                  */}
                  {faab && c.sleeperId && bidQuotes?.[c.sleeperId] != null ? (
                    <span
                      className="af-wlb-bid af-num"
                      data-over={faab.remaining != null && bidQuotes[c.sleeperId] > faab.remaining ? 'true' : undefined}
                      title="Suggested bid by the Waiver intelligence rule below: budget × his market value ÷ the anchor, capped at 60% of the budget"
                    >
                      bid ~${bidQuotes[c.sleeperId]}
                      {faab.remaining != null && bidQuotes[c.sleeperId] > faab.remaining ? ` · over your $${faab.remaining} left` : ''}
                    </span>
                  ) : null}
                </span>
              </span>
              {/* The headline. Everything else on the row justifies it. */}
              <span className="af-wlb-gain af-num">+{c.gain.toFixed(1)}</span>
              <span className="af-wlb-over">
                {c.displaces ? (
                  <>
                    over {c.displaces.name}{' '}
                    <span className="af-num">
                      ({c.displaces.projectedPoints.toFixed(1)}
                      {c.displaces.afProjectedPoints != null ? ` · AF ${c.displaces.afProjectedPoints.toFixed(1)}` : ''})
                    </span>
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

      {rollingPriority && board.state === 'ok' && board.candidates.length > 0 ? (
        <PriorityCost priority={rollingPriority} candidates={board.candidates} perGame={perGame} />
      ) : null}

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

/**
 * What your roster needs from the wire: empty starting slots this week, positions with no backup,
 * and byes in the weeks just ahead. Three checkable facts (lib/waivers/rosterNeeds.ts) — nothing
 * here grades the roster.
 */
function RosterNeedsStrip({ needs }: { needs: RosterNeeds }) {
  const byes = needs.byes.filter((b) => b.players.some((p) => p.starter))
  if (needs.emptySlots.length === 0 && needs.noBackup.length === 0 && byes.length === 0) return null
  return (
    <ul className="af-wlb-needs" data-testid="waiver-roster-needs" aria-label="What your roster needs">
      {needs.emptySlots.length > 0 ? (
        <li data-tone="bad">
          <span className="af-wlb-need-k">Empty{needs.week != null ? ` in wk ${needs.week}` : ''}</span>
          {needs.emptySlots.join(', ')}
        </li>
      ) : null}
      {needs.noBackup.map((n) => (
        <li key={n.position} data-tone="warn">
          <span className="af-wlb-need-k">No {n.position} backup</span>
          {n.rostered} rostered for {n.starting} starting {n.starting === 1 ? 'slot' : 'slots'}
        </li>
      ))}
      {byes.map((b) => (
        <li key={b.week} data-tone={needs.week != null && b.week === needs.week ? 'bad' : 'muted'}>
          <span className="af-wlb-need-k">Bye wk {b.week}</span>
          {/* Starters only: a bench player's bye changes nothing you start. */}
          {b.players
            .filter((p) => p.starter)
            .map((p) => `${p.name}${p.position ? ` (${p.position})` : ''}`)
            .join(', ')}
        </li>
      ))}
    </ul>
  )
}

/**
 * Rolling priority: a claim sends you to the back of the order. Two numbers decide whether that
 * is worth it — the best add's gain, and how much you give up by taking the next-best instead
 * (or by waiting, when he is the only one). Stated, not decided: how much a priority slot is
 * worth this late in a season is the manager's call.
 */
function PriorityCost({
  priority,
  candidates,
  perGame,
}: {
  priority: { priority: number; leagueRosters: number }
  candidates: WaiverBoard['candidates']
  perGame: boolean
}) {
  const [top, next] = candidates
  const unit = perGame ? ' per game' : ''
  return (
    <p className="af-wlb-priority" data-testid="waiver-priority-cost">
      <strong>Your priority: #{priority.priority} of {priority.leagueRosters}.</strong>{' '}
      {priority.priority === priority.leagueRosters
        ? 'You are already last, so a claim costs you no place in the order.'
        : `A claim sends you to #${priority.leagueRosters}. `}
      {priority.priority !== priority.leagueRosters
        ? next
          ? `${top.name} adds +${top.gain.toFixed(1)}${unit}; the next best, ${next.name}, adds +${next.gain.toFixed(1)} — a ${(top.gain - next.gain).toFixed(1)}-point gap is what spending it buys.`
          : `${top.name} (+${top.gain.toFixed(1)}${unit}) is the only free agent who improves your lineup.`
        : ''}
    </p>
  )
}

export default WaiverLineupBoard
