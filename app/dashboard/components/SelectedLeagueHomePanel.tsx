'use client'

import { useEffect, useRef } from 'react'
import type { UserLeague } from '@/app/dashboard/types'
import {
  type DashboardDraftOverlayBridgePayload,
  isOpenDraftOverlayMessage,
} from '@/lib/dashboard/dashboard-draft-overlay-bridge'

type SelectedLeagueHomePanelProps = {
  league: UserLeague
  /** Full-screen draft/dispersal overlay on dashboard (from iframe postMessage). */
  onDraftOverlayRequest?: (payload: DashboardDraftOverlayBridgePayload) => void
}

/**
 * Full league hub UI is loaded from `/league/[id]?embed=1` so we reuse `LeagueShell`
 * without duplicating hub markup. The dashboard keeps left chat + My Leagues rails;
 * this panel is only the center column — no duplicate header row above the iframe.
 */
export function SelectedLeagueHomePanel({ league, onDraftOverlayRequest }: SelectedLeagueHomePanelProps) {
  const embedSrc = `/league/${encodeURIComponent(league.id)}?embed=1`
  const dedupeRef = useRef<{ signature: string; at: number }>({ signature: '', at: 0 })

  useEffect(() => {
    if (!onDraftOverlayRequest) return
    const onMsg = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      const data = event.data
      if (!isOpenDraftOverlayMessage(data)) return

      const signature = `${data.leagueId}:${data.draftId ?? ''}:${data.dispersalDraftId ?? ''}:${data.source ?? ''}`
      const now = Date.now()
      if (signature === dedupeRef.current.signature && now - dedupeRef.current.at < 450) return
      dedupeRef.current = { signature, at: now }

      onDraftOverlayRequest(data)
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [league.id, onDraftOverlayRequest])

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden" style={{ background: 'var(--bg)' }}>
      <iframe
        title={`${league.name} — league hub`}
        src={embedSrc}
        className="min-h-0 w-full flex-1 border-0 bg-[#040915]"
        data-testid="dashboard-embedded-league-hub-iframe"
      />
    </div>
  )
}
