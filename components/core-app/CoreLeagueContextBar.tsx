'use client'

import { COMMS_OPEN_EVENT } from '@/components/core-app/comms/commsEvents'
import { CORE_SURFACE_LABELS, type CoreSurfaceKey } from '@/lib/core-app/coreSurface'
import '@/components/core-app/af-league-tabs.css'

export type CoreLeagueContextBarProps = {
  leagueName: string
  platform: string
  syncLabel: string
  syncStale: boolean
  gameDayActive: boolean
  decisionAvailable: boolean
  recommendation: { action: string; rationale: string } | null
  surface: CoreSurfaceKey
}

export default function CoreLeagueContextBar({
  leagueName,
  platform,
  syncLabel,
  syncStale,
  gameDayActive,
  decisionAvailable,
  recommendation,
  surface,
}: CoreLeagueContextBarProps) {
  const askChimmy = () => {
    window.dispatchEvent(
      new CustomEvent(COMMS_OPEN_EVENT, {
        detail: {
          tab: 'chimmy',
          prefill: `Review ${leagueName}'s ${CORE_SURFACE_LABELS[surface]} and tell me the most important action to take next.`,
        },
      }),
    )
  }

  return (
    <section className="af-lctx" aria-label={`${leagueName} system status`}>
      <div className="af-lctx-statuses">
        <span className="af-lctx-chip" data-tone="source">
          {platform.toUpperCase()} import
        </span>
        <span className="af-lctx-chip" data-tone={gameDayActive ? 'live' : syncStale ? 'warn' : 'fresh'}>
          {gameDayActive ? 'Game-day view refresh · 20s' : `Synced ${syncLabel}`}
        </span>
        <span className="af-lctx-chip" data-tone={decisionAvailable ? 'decision' : 'muted'}>
          Decision OS {decisionAvailable ? 'connected' : 'building context'}
        </span>
        <span className="af-lctx-chip" data-tone="chimmy">
          Chimmy · {CORE_SURFACE_LABELS[surface]}
        </span>
      </div>

      {recommendation ? (
        <div className="af-lctx-action">
          <span className="af-lctx-action-copy">
            <strong>{recommendation.action}</strong>
            <span>{recommendation.rationale}</span>
          </span>
          <button type="button" onClick={askChimmy}>Ask Chimmy</button>
        </div>
      ) : null}
    </section>
  )
}
