'use client'

import { CoreDepthLock, FreeUntilNote } from '@/components/core-app/CoreDepthLock'
import type { CoreDepthAccess } from '@/lib/core-app/coreDepthAccess'
import type { WaiverEdge } from '@/lib/competitive-edge/waiverEdge'

/*
 * Competitive Edge on Waivers: who you are bidding against — how much FAAB each other manager has
 * left, and what they have actually won on waivers this season (lib/competitive-edge/waiverEdge.ts
 * holds the contract). Counts and budgets, never a label and never a guess at what they will bid.
 *
 * The page loads it only for a viewer whose plan includes it; the lock here only decides what is
 * drawn.
 */

export type WaiverEdgeState = { available: true; data: WaiverEdge } | { available: false; reason: string }

function asOfLabel(iso: string | null): string {
  if (!iso) return ''
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

export function WaiverCompetitiveEdge({
  access,
  edge,
}: {
  access: CoreDepthAccess | null
  edge: WaiverEdgeState | null | undefined
}) {
  if (access && !access.unlocked) return <CoreDepthLock access={access} what="Competitive Edge" />
  if (!edge) return null

  if (!edge.available) {
    return (
      <section className="af-card af-wv-section" data-testid="waiver-competitive-edge" aria-label="Competitive Edge · waivers">
        <h2 className="af-label">Competitive Edge · who you&apos;re bidding against</h2>
        <p className="af-wv-edge-note">{edge.reason}</p>
      </section>
    )
  }

  const { leagueFacts, rivals, coverage } = edge.data
  const asOf = asOfLabel(coverage.asOf)

  return (
    <section className="af-card af-wv-section" data-testid="waiver-competitive-edge" aria-label="Competitive Edge · waivers">
      <h2 className="af-label">Competitive Edge · who you&apos;re bidding against</h2>
      {access ? <FreeUntilNote access={access} /> : null}

      <ul className="af-wv-edge-league">
        {[...leagueFacts]
          .sort((a, b) => Number(b.bearsOnDeal) - Number(a.bearsOnDeal))
          .map((f) => (
            <li key={f.key} data-testid={`waiver-edge-${f.key}`}>
              {f.text}
            </li>
          ))}
      </ul>

      <ul className="af-wv-edge-rivals">
        {rivals.map((r) => (
          <li key={r.manager.teamExternalId} className="af-wv-edge-rival" data-testid={`waiver-edge-rival-${r.manager.teamExternalId}`}>
            <div className="af-wv-edge-name">{r.manager.name}</div>
            <ul className="af-wv-edge-facts">
              {r.facts.map((f) => (
                <li key={f.key}>{f.text}</li>
              ))}
            </ul>
          </li>
        ))}
      </ul>

      <p className="af-wv-edge-note" data-testid="waiver-competitive-edge-basis">
        Counted from winning waiver claims in this league&apos;s Sleeper history for the {coverage.season} season
        {asOf ? `, as of ${asOf} ET` : ''}
        {coverage.stale ? ' — may be out of date' : ''}. Sleeper doesn&apos;t publish losing bids, so these are wins only.
        It shows what they did, not what they&apos;ll bid.
      </p>
    </section>
  )
}
