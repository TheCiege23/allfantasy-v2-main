'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMessages } from '@/components/i18n/useMessages'
import { InfoTip } from '@/components/core-app/InfoTip'
import type { MatchupData } from '@/lib/core-app/matchup'
import {
  buildMarketRows,
  isMarketSport,
  marketStarters,
  type MarketRow,
  type MatchupMarketResponse,
} from '@/lib/core-app/matchupMarket'
import { matchupMarketPanelMessages } from '@/lib/core-app/messages/matchupMarketPanel'

type MatchupMarketPanelMessages = typeof matchupMarketPanelMessages.en

/**
 * "Scoring environment" on /core Matchup — the betting market read as a FORECAST: for each of your
 * starters, the points his team's offense is expected to score, and the game script around it.
 *
 * Built 2026-09-10 inside `MatchupPrepModal`, which nothing had mounted since July, so it never
 * rendered for anyone; restored here 2026-10-06. The data comes from the stored `game_odds` rows via
 * `/api/core/matchup-market` (DB-first — no provider call on this path).
 *
 * 🛑 THIS IS NOT A BETTING CARD, AND THE WORDING IS THE BOUNDARY. The read layer refuses to return
 * prices or sportsbook names, so no odd can render even by mistake; what this file must still get
 * right is the language, in both languages:
 *   - the headline is EXPECTED POINTS for that player's offense, not a line;
 *   - the spread is game script in words — "favored by 3.5" / «favorito por 3.5» — never "-3.5";
 *   - the total is "combined" / «entre ambos», never "O/U".
 *
 * ⚠ AN EMPTY PANEL IS A NORMAL STATE, NOT A FAULT. Only fixtures inside roughly two days of kickoff
 * carry a market read, so early in a week most starters have none. That is said as "not yet", and a
 * starter without a read is counted, never shown as "—" or "0.0".
 *
 * Renders nothing for a finished week, a non-NFL league (no feed), or a board with no lineups.
 */

type Copy = MatchupMarketPanelMessages

/** Game script in words, from the starter's own side. Never betting notation. */
function scriptText(spread: number | null, c: Copy): string | null {
  if (spread == null || !Number.isFinite(spread)) return null
  if (spread < 0) return c.favored(Math.abs(spread))
  if (spread > 0) return c.underdog(spread)
  return c.even
}

function rowDetail(r: MarketRow, c: Copy): string {
  const parts: string[] = []
  if (r.opponent) parts.push(c.where(r.isHome, r.opponent))
  const script = scriptText(r.spread, c)
  if (script) parts.push(script)
  if (r.gameTotal != null && Number.isFinite(r.gameTotal)) parts.push(c.combined(r.gameTotal.toFixed(1)))
  return parts.join(' · ')
}

export type MarketPanelState =
  | { status: 'ready'; rows: MarketRow[]; withoutRead: number }
  | { status: 'failed' }

/** The panel itself, given a settled state. Exported for its tests. */
export function MarketEnvironmentView({ state }: { state: MarketPanelState }) {
  const c = useMessages(matchupMarketPanelMessages)
  const tip = [c.tip1, c.tip2, c.tip3, c.tip4]

  return (
    <section className="af-frame af-mu-section af-mu-market" aria-labelledby="af-mu-market-h">
      <header className="af-mu-section-head">
        <h2 className="af-label" id="af-mu-market-h">
          {c.title}
        </h2>
        <InfoTip label={c.tipLabel} title={c.tipLabel}>
          {tip.map((p) => (
            <span className="af-info-para" key={p}>
              {p}
            </span>
          ))}
        </InfoTip>
      </header>

      {state.status === 'failed' ? (
        <p className="af-mu-unavailable" role="status">
          {c.failed}
        </p>
      ) : state.rows.length === 0 ? (
        <p className="af-mu-unavailable">{c.empty}</p>
      ) : (
        <>
          <ul className="af-mu-missing">
            {state.rows.map((r) => {
              const detail = rowDetail(r, c)
              return (
                <li key={r.key} data-stale={r.isStale || undefined}>
                  <span className="af-mu-missing-key">
                    {r.name} <span className="af-mu-missing-caveat">({r.team})</span>
                  </span>
                  <span className="af-mu-missing-value af-num">
                    {c.expected(r.impliedTeamTotal.toFixed(1))}
                    {detail ? <em className="af-mu-missing-caveat"> — {detail}</em> : null}
                  </span>
                </li>
              )
            })}
          </ul>
          {state.withoutRead > 0 ? <p className="af-mu-note">{c.partial(state.withoutRead)}</p> : null}
          {state.rows.some((r) => r.isStale) ? <p className="af-mu-note">{c.stale}</p> : null}
          <p className="af-mu-note">{c.footer}</p>
        </>
      )}
    </section>
  )
}

/**
 * Mounted once on the Matchup screen. Works out which of your starters can have a market read, asks
 * the DB-first route for their clubs, and renders the view once the answer is in.
 */
export function MatchupMarketPanel({ data }: { data: MatchupData }) {
  const week = data.week.available && !data.week.data.isFinal ? data.week.data : null
  const slots = data.lineups.available ? data.lineups.data : null
  const starters = useMemo(
    () => (week && slots && isMarketSport(slots) ? marketStarters(slots) : []),
    [week, slots],
  )
  const teams = useMemo(() => [...new Set(starters.map((s) => s.team))].sort(), [starters])
  const query =
    week && teams.length > 0
      ? `season=${week.season}&week=${week.week}&${teams.map((t) => `team=${encodeURIComponent(t)}`).join('&')}`
      : null

  const [answer, setAnswer] = useState<{ query: string; result: MatchupMarketResponse | 'failed' } | null>(null)

  useEffect(() => {
    if (!query || typeof fetch !== 'function') return
    const ctrl = new AbortController()
    fetch(`/api/core/matchup-market?${query}`, { cache: 'no-store', credentials: 'same-origin', signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status))
        const body = (await res.json()) as MatchupMarketResponse
        if (!body || typeof body.teams !== 'object' || body.teams == null) throw new Error('bad body')
        setAnswer({ query, result: body })
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setAnswer({ query, result: 'failed' })
      })
    return () => ctrl.abort()
  }, [query])

  if (!query || !answer || answer.query !== query) return null
  if (answer.result === 'failed') return <MarketEnvironmentView state={{ status: 'failed' }} />
  const { rows, withoutRead } = buildMarketRows(starters, answer.result.teams)
  return <MarketEnvironmentView state={{ status: 'ready', rows, withoutRead }} />
}

export default MatchupMarketPanel
