'use client'

import { CoreDepthLock, FreeUntilNote } from '@/components/core-app/CoreDepthLock'
import type { CoreDepthAccess } from '@/lib/core-app/coreDepthAccess'
import type { DraftEdge } from '@/lib/competitive-edge/draftEdge'

/*
 * Competitive Edge on Draft HQ: what each other manager has actually taken in this league's past
 * drafts (lib/competitive-edge/draftEdge.ts holds the contract). Counts, never a label, and never a
 * guess at what they will take next.
 *
 * The page loads it only for a viewer whose plan includes it; the lock here only decides what is drawn.
 */

export type DraftEdgeState = { available: true; data: DraftEdge } | { available: false; reason: string }

function range(seasons: number[]): string {
  if (seasons.length === 0) return ''
  return seasons[0] === seasons[seasons.length - 1] ? `${seasons[0]}` : `${seasons[0]}–${seasons[seasons.length - 1]}`
}

export function DraftCompetitiveEdge({
  access,
  edge,
}: {
  access: CoreDepthAccess | null
  edge: DraftEdgeState | null | undefined
}) {
  if (access && !access.unlocked) return <CoreDepthLock access={access} what="Competitive Edge" />
  if (!edge) return null

  const head = (
    <header className="af-dh-section-head">
      <h2 className="af-label">Competitive Edge · how the others draft</h2>
      {access ? <FreeUntilNote access={access} /> : null}
    </header>
  )

  if (!edge.available) {
    return (
      <section className="af-frame af-dh-section af-dh-edge" data-testid="draft-competitive-edge">
        {head}
        <p className="af-dh-unavailable">{edge.reason}</p>
      </section>
    )
  }

  const { rivals, coverage } = edge.data
  return (
    <section className="af-frame af-dh-section af-dh-edge" data-testid="draft-competitive-edge">
      {head}
      {coverage.seasons.length === 0 ? (
        <p className="af-dh-unavailable">
          No picks in this league&apos;s drafts are matched to their managers yet, so there is nothing to count.
        </p>
      ) : (
        <ul className="af-dh-edge-rivals">
          {rivals.map((r) => (
            <li key={r.manager.teamExternalId} className="af-dh-edge-rival" data-testid={`draft-edge-rival-${r.manager.teamExternalId}`}>
              <div className="af-dh-edge-name">{r.manager.name}</div>
              <ul className="af-dh-edge-facts">
                {r.facts.map((f) => (
                  <li key={f.key}>{f.text}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      <p className="af-dh-edge-note" data-testid="draft-competitive-edge-basis">
        Counted from this league&apos;s Sleeper drafts
        {coverage.seasons.length > 0 ? ` (${range(coverage.seasons)})` : ''}, matched to the manager who owned
        each team that season.
        {coverage.unattributedSeasons.length > 0
          ? ` Picks from ${coverage.unattributedSeasons.join(', ')} aren't matched to a manager yet, so those drafts are left out.`
          : ''}{' '}
        It shows what they did, not what they&apos;ll take.
      </p>
    </section>
  )
}
