'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import type { DecisionReceiptsData, TradeReceipt } from '@/lib/core-app/decisionReceipts'

/**
 * The home "Receipts" card — how your past moves turned out (retention item 6, user
 * decisions 2026-09-14). Trades first. Good and bad outcomes read the same way: the points
 * and which side of them you are on, never a letter and never softened.
 *
 * ⚠ NOT RENDERED WITH NOTHING TO SAY. `data` null (no Sleeper identity, or no league the
 * grades cover), or no receipt AND nothing too early to call, renders nothing — an empty
 * card on the home is noise, not honesty.
 */

const OUTCOME_TEXT: Record<TradeReceipt['outcome'], string> = {
  ahead: 'you’re ahead',
  behind: 'you’re behind',
  even: 'about even',
}

function signed(n: number): string {
  const r = Math.round(n * 10) / 10
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r).toFixed(1)}`
}

function list(names: string[]): string {
  if (names.length === 0) return 'nothing'
  return names.length <= 2 ? names.join(' & ') : `${names.slice(0, 2).join(', ')} +${names.length - 2}`
}

export function ReceiptsCard({ data, help }: { data: DecisionReceiptsData | null; help?: ReactNode }) {
  if (!data) return null
  if (data.trades.length === 0 && data.tooEarly === 0) return null

  return (
    <section className="af3a-card af3a-receipts">
      <header className="af3a-cardhead">
        <span className="af3a-label">RECEIPTS</span>
        {help}
      </header>
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
      {data.uncoveredLeagues > 0 ? (
        <p className="af3a-exp-note">Trade receipts cover your Sleeper leagues for now.</p>
      ) : null}
    </section>
  )
}

export default ReceiptsCard
