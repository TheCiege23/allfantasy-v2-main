'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import type {
  AutoCoachReceipt,
  DecisionReceiptsData,
  LineupReceipt,
  TradeReceipt,
  WaiverReceipt,
} from '@/lib/core-app/decisionReceipts'

/**
 * The home "Receipts" card — how your past moves turned out (retention item 6, user
 * decisions 2026-09-14). Trades, waiver adds, lineups and AutoCoach calls. Good and bad
 * outcomes read the same way: the points and which side of them you are on, never a letter
 * and never softened.
 *
 * ⚠ NOT RENDERED WITH NOTHING TO SAY. `data` null, or no receipt of any kind AND nothing
 * too early, pending, unscored or unreadable to mention, renders nothing — an empty card on
 * the home is noise, not honesty.
 */

const OUTCOME_TEXT: Record<TradeReceipt['outcome'], string> = {
  ahead: 'you’re ahead',
  behind: 'you’re behind',
  even: 'about even',
}

const CALL_TEXT: Record<AutoCoachReceipt['call'], string> = {
  right: 'AutoCoach was right',
  wrong: 'AutoCoach was wrong',
  same: 'about the same',
}

function signed(n: number): string {
  const r = Math.round(n * 10) / 10
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r).toFixed(1)}`
}

function list(names: string[]): string {
  if (names.length === 0) return 'nothing'
  return names.length <= 2 ? names.join(' & ') : `${names.slice(0, 2).join(', ')} +${names.length - 2}`
}

function WaiverRow({ w }: { w: WaiverReceipt }) {
  return (
    <li className="af3a-receipt" data-kind="waiver">
      <Link className="af3a-receipt-title" href={w.href}>
        You added {w.playerName}
        {w.position ? ` (${w.position})` : ''}
      </Link>
      <span className="af3a-receipt-where af3a-mono">
        {w.leagueName} · {w.season} wk {w.week}
        {w.faab != null ? ` · $${w.faab} FAAB` : ''}
      </span>
      <span className="af3a-receipt-result">
        <b className="af3a-mono">{w.points.toFixed(1)} pts</b> for you ·{' '}
        {w.starts} start{w.starts === 1 ? '' : 's'}
        {w.leftWeek != null ? ` · gone wk ${w.leftWeek}` : ' (still yours)'}
      </span>
    </li>
  )
}

function LineupRow({ l }: { l: LineupReceipt }) {
  return (
    <li className="af3a-receipt" data-kind="lineup" data-outcome={l.perfect ? 'ahead' : undefined}>
      <Link className="af3a-receipt-title" href={l.href}>
        {l.perfect ? `Perfect lineup in week ${l.week}` : `You left ${l.pointsLeft.toFixed(1)} pts on your bench`}
      </Link>
      <span className="af3a-receipt-where af3a-mono">
        {l.leagueName} · {l.season} wk {l.week}
      </span>
      {!l.perfect && (l.benched || l.started) ? (
        <span className="af3a-receipt-swap">
          {l.benched ? `Benched ${l.benched.name} (${l.benched.points.toFixed(1)})` : ''}
          {l.benched && l.started ? ' · ' : ''}
          {l.started ? `started ${l.started.name} (${l.started.points.toFixed(1)})` : ''}
        </span>
      ) : null}
    </li>
  )
}

function AutoCoachRow({ a }: { a: AutoCoachReceipt }) {
  const outcome = a.call === 'right' ? 'ahead' : a.call === 'wrong' ? 'behind' : undefined
  return (
    <li className="af3a-receipt" data-kind="autocoach" data-outcome={outcome}>
      <Link className="af3a-receipt-title" href={a.href}>
        AutoCoach said start {a.recommended.name} over {a.instead.name}
      </Link>
      <span className="af3a-receipt-where af3a-mono">
        {a.leagueName} · {a.season} wk {a.week}
        {a.slot ? ` · ${a.slot}` : ''}
      </span>
      <span className="af3a-receipt-result">
        <b className="af3a-mono">
          {a.recommended.name} {a.recommended.points.toFixed(1)}
        </b>{' '}
        · {a.instead.name} {a.instead.points.toFixed(1)} — {CALL_TEXT[a.call]}
      </span>
      <span className="af3a-receipt-note">
        {a.followed === 'yes'
          ? `You started ${a.recommended.name} on Sleeper.`
          : a.followed === 'no'
            ? `You kept ${a.instead.name} in on Sleeper.`
            : 'Your Sleeper lineup didn’t match either way.'}
      </span>
    </li>
  )
}

export function ReceiptsCard({ data, help }: { data: DecisionReceiptsData | null; help?: ReactNode }) {
  if (!data) return null
  const waivers = data.waivers ?? []
  const waiversTooEarly = data.waiversTooEarly ?? 0
  const waiversUnscored = data.waiversUnscored ?? 0
  const lineups = data.lineups ?? []
  const lineupsUnscored = data.lineupsUnscored ?? 0
  const lineupsUnreadable = data.lineupsUnreadable ?? 0
  const autocoach = data.autocoach ?? []
  const autocoachPending = data.autocoachPending ?? 0
  const autocoachUnscored = data.autocoachUnscored ?? 0
  const autocoachUnreadable = data.autocoachUnreadable ?? 0
  const hasTrades = data.trades.length > 0 || data.tooEarly > 0
  const hasWaivers = waivers.length > 0 || waiversTooEarly > 0 || waiversUnscored > 0
  const hasLineups = lineups.length > 0 || lineupsUnscored > 0 || lineupsUnreadable > 0
  const hasAutoCoach = autocoach.length > 0 || autocoachPending > 0 || autocoachUnscored > 0 || autocoachUnreadable > 0
  const kinds = [hasTrades, hasWaivers, hasLineups, hasAutoCoach].filter(Boolean).length
  if (kinds === 0) return null
  const headed = kinds > 1

  return (
    <section className="af3a-card af3a-receipts">
      <header className="af3a-cardhead">
        <span className="af3a-label">RECEIPTS</span>
        {help}
      </header>

      {hasTrades ? (
        <>
          {headed ? <h3 className="af3a-receipt-group">Trades</h3> : null}
          {data.trades.length > 0 ? (
            <ul className="af3a-receipt-list">
              {data.trades.map((t) => (
                <li key={`${t.leagueId}:${t.id}`} className="af3a-receipt" data-outcome={t.outcome}>
                  <Link className="af3a-receipt-title" href={t.href}>
                    Your trade{t.counterparty ? ` with ${t.counterparty}` : ''}
                  </Link>
                  <span className="af3a-receipt-where af3a-mono">
                    {t.leagueName} · {t.season} wk {t.week}
                  </span>
                  <span className="af3a-receipt-swap">
                    Gave {list(t.gave)} · got {list(t.got)}
                  </span>
                  <span className="af3a-receipt-result">
                    <b className="af3a-mono">{signed(t.netPoints)} pts</b> since — {OUTCOME_TEXT[t.outcome]}
                    {t.ongoing ? ' (still counting)' : ''}
                  </span>
                  {t.unsettledPicks > 0 ? (
                    <span className="af3a-receipt-note">
                      {t.unsettledPicks} pick{t.unsettledPicks === 1 ? '' : 's'} not drafted yet — not counted
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {data.tooEarly > 0 ? (
            <p className="af3a-exp-note">
              {data.tooEarly} newer trade{data.tooEarly === 1 ? ' is' : 's are'} too early to call.
            </p>
          ) : null}
        </>
      ) : null}

      {hasWaivers ? (
        <>
          {headed ? <h3 className="af3a-receipt-group">Waiver adds</h3> : null}
          {waivers.length > 0 ? (
            <ul className="af3a-receipt-list">
              {waivers.map((w) => (
                <WaiverRow key={w.id} w={w} />
              ))}
            </ul>
          ) : null}
          {waiversTooEarly > 0 ? (
            <p className="af3a-exp-note">
              {waiversTooEarly} recent add{waiversTooEarly === 1 ? ' is' : 's are'} too early to call.
            </p>
          ) : null}
          {waiversUnscored > 0 ? (
            <p className="af3a-exp-note">
              {waiversUnscored} add{waiversUnscored === 1 ? ' has' : 's have'} no weekly scores on file yet.
            </p>
          ) : null}
        </>
      ) : null}

      {hasLineups ? (
        <>
          {headed ? <h3 className="af3a-receipt-group">Lineups</h3> : null}
          {lineups.length > 0 ? (
            <ul className="af3a-receipt-list">
              {lineups.map((l) => (
                <LineupRow key={l.id} l={l} />
              ))}
            </ul>
          ) : null}
          {lineupsUnscored > 0 ? (
            <p className="af3a-exp-note">
              {lineupsUnscored} recent week{lineupsUnscored === 1 ? ' has' : 's have'} no weekly scores on file yet.
            </p>
          ) : null}
          {lineupsUnreadable > 0 ? (
            <p className="af3a-exp-note">
              {lineupsUnreadable} week{lineupsUnreadable === 1 ? '' : 's'} couldn’t be checked — a starter’s
              position or the league’s lineup slots aren’t on file.
            </p>
          ) : null}
        </>
      ) : null}

      {hasAutoCoach ? (
        <>
          {headed ? <h3 className="af3a-receipt-group">AutoCoach</h3> : null}
          {autocoach.length > 0 ? (
            <ul className="af3a-receipt-list">
              {autocoach.map((a) => (
                <AutoCoachRow key={a.id} a={a} />
              ))}
            </ul>
          ) : null}
          {autocoachPending > 0 ? (
            <p className="af3a-exp-note">
              {autocoachPending} AutoCoach call{autocoachPending === 1 ? ' is' : 's are'} for a week still being played.
            </p>
          ) : null}
          {autocoachUnscored > 0 ? (
            <p className="af3a-exp-note">
              {autocoachUnscored} call{autocoachUnscored === 1 ? ' has' : 's have'} no weekly scores on file yet.
            </p>
          ) : null}
          {autocoachUnreadable > 0 ? (
            <p className="af3a-exp-note">
              {autocoachUnreadable} call{autocoachUnreadable === 1 ? '' : 's'} couldn’t be matched to a week or to your
              roster that week.
            </p>
          ) : null}
        </>
      ) : null}

      {data.uncoveredLeagues > 0 ? (
        <p className="af3a-exp-note">Receipts cover your Sleeper leagues for now.</p>
      ) : null}
    </section>
  )
}

export default ReceiptsCard
