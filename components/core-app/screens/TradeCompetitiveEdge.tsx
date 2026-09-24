'use client'

import { CoreDepthLock, FreeUntilNote } from '@/components/core-app/CoreDepthLock'
import type { CoreDepthAccess } from '@/lib/core-app/coreDepthAccess'
import type { TradeEdge } from '@/lib/competitive-edge/tradeEdge'

/*
 * Competitive Edge in the Trade Center: what the manager on the other side of THIS deal has
 * actually done in this league's trades (lib/competitive-edge/tradeEdge.ts holds the contract).
 *
 * Counts, the trades they came from, and as of when — never a label, and never a guess at whether
 * they will accept. The route computes it only for a viewer whose plan includes it; the lock here
 * only decides what is drawn.
 */

export type TradeEdgeState = { available: true; data: TradeEdge } | { available: false; reason: string }

function asOfLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  }).format(d)
}

export function TradeCompetitiveEdge({
  access,
  edge,
  partnerName,
}: {
  access: CoreDepthAccess | null
  edge: TradeEdgeState | null | undefined
  partnerName: string
}) {
  if (access && !access.unlocked) return <CoreDepthLock access={access} what="Competitive Edge" />
  if (!edge) return null

  if (!edge.available) {
    return (
      <section className="af-tc-dos" data-testid="trade-competitive-edge" aria-label={`Competitive Edge · ${partnerName}`}>
        <div className="af-label">Competitive Edge · {partnerName}</div>
        <p className="af-tc-row-sub">{edge.reason}</p>
      </section>
    )
  }

  const { manager, coverage, facts } = edge.data
  const onDeal = facts.filter((f) => f.bearsOnDeal)
  const record = facts.filter((f) => !f.bearsOnDeal)
  const asOf = asOfLabel(coverage.asOf)

  return (
    <section className="af-tc-dos" data-testid="trade-competitive-edge" aria-label={`Competitive Edge · ${manager.name}`}>
      <div className="af-label">Competitive Edge · {manager.name}</div>
      {access ? <FreeUntilNote access={access} /> : null}

      {onDeal.length > 0 ? (
        <>
          <div className="af-label">On this deal</div>
          <ul className="af-tc-list">
            {onDeal.map((f) => (
              <li key={f.key}>{f.text}</li>
            ))}
          </ul>
        </>
      ) : null}

      <div className="af-label">Their trade record</div>
      <ul className="af-tc-list">
        {record.map((f) => (
          <li key={f.key}>{f.text}</li>
        ))}
      </ul>

      {coverage.shortfall ? <p className="af-tc-row-sub">{coverage.shortfall}</p> : null}
      {coverage.gaps.length > 0 ? (
        <p className="af-tc-row-sub">
          Some of this league&apos;s history could not be read ({coverage.gaps.join('; ')}), so these counts may be low.
        </p>
      ) : null}
      <p className="af-tc-row-sub" data-testid="trade-competitive-edge-basis">
        Counted from completed trades in this league&apos;s Sleeper history
        {coverage.seasons.length > 0 ? ` (${coverage.seasons[0]}–${coverage.seasons[coverage.seasons.length - 1]})` : ''}
        {asOf ? `, as of ${asOf} ET` : ''}
        {coverage.stale ? ' — may be out of date' : ''}. It shows what they did, not whether they will accept.
      </p>
    </section>
  )
}
