'use client'
import { useTradeVisualCopy } from "./useTradeVisualCopy"

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

function asOfLabel(iso: string, locale: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat(locale, {
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
  const {copy,locale}=useTradeVisualCopy()

  if (access && !access.unlocked) return <CoreDepthLock access={access} what="Competitive Edge" />
  if (!edge) return null

  if (!edge.available) {
    return (
      <section className="af-tc-dos" data-testid="trade-competitive-edge" aria-label={copy(`Competitive Edge · ${partnerName}`)}>
        <div className="af-label">{copy("Competitive Edge · ")}{copy(partnerName)}</div>
        <p className="af-tc-row-sub">{copy(edge.reason)}</p>
      </section>
    )
  }

  const { manager, coverage, facts } = edge.data
  const onDeal = facts.filter((f) => f.bearsOnDeal)
  const record = facts.filter((f) => !f.bearsOnDeal)
  const asOf = asOfLabel(coverage.asOf, locale)

  return (
    <section className="af-tc-dos" data-testid="trade-competitive-edge" aria-label={copy(`Competitive Edge · ${manager.name}`)}>
      <div className="af-label">{copy("Competitive Edge · ")}{manager.name}</div>
      {access ? <FreeUntilNote access={access} /> : null}

      {onDeal.length > 0 ? (
        <>
          <div className="af-label">{copy("On this deal")}</div>
          <ul className="af-tc-list">
            {onDeal.map((f) => (
              <li key={f.key}>{copy(f.text)}</li>
            ))}
          </ul>
        </>
      ) : null}

      <div className="af-label">{copy("Their trade record")}</div>
      <ul className="af-tc-list">
        {record.map((f) => (
          <li key={f.key}>{copy(f.text)}</li>
        ))}
      </ul>

      {coverage.shortfall ? <p className="af-tc-row-sub">{copy(coverage.shortfall)}</p> : null}
      {coverage.gaps.length > 0 ? (
        <p className="af-tc-row-sub">{copy(" Some of this league's history could not be read (")}{copy(coverage.gaps.join('; '))}{copy("), so these counts may be low. ")}</p>
      ) : null}
      <p className="af-tc-row-sub" data-testid="trade-competitive-edge-basis">{copy(" Counted from completed trades in this league's Sleeper history ")}{copy(coverage.seasons.length > 0 ? ` (${coverage.seasons[0]}–${coverage.seasons[coverage.seasons.length - 1]})` : '')}
        {copy(asOf ? `, as of ${asOf} ET` : '')}
        {copy(coverage.stale ? ' — may be out of date' : '')}{copy(". It shows what they did, not whether they will accept. ")}</p>
    </section>
  )
}
