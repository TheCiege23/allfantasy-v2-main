'use client'

import { useEffect, useState } from 'react'
import '@/components/core-app/af-core.css'
import '@/components/core-app/af-team-workspace.css'
import { InactiveManagerCommissioner } from '@/components/core-app/InactiveManagerCommissioner'

type Trades = 'off' | 'answer'
const autopilot = (style: string) => ({ since: '2026-11-01T00:00:00Z', byUserId: 'c', autopilot: { style, since: '2026-11-01T00:00:00Z' } })

/** Sample data only: answers the panel's own reads and saves in the page, so nothing reaches a server. */
export function ChimmyManagerTradesPreview() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const trades: Record<string, string> = { r1: 'answer', r2: 'answer_and_send' }
    const real = window.fetch
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (!url.includes('/inactive-managers')) return real(input, init)
      if (init?.method === 'POST') {
        const b = JSON.parse(String(init.body ?? '{}')) as { rosterId?: string; trades?: string }
        if (b.rosterId && b.trades) trades[b.rosterId] = b.trades
        return new Response(JSON.stringify({ trades: b.trades }), { status: 200 })
      }
      return new Response(JSON.stringify({
        native: true, autopilotEntitled: true, draftAsMe: true, autoHandover: null, chimmyLimit: 4, chimmyFreeTeams: 1, chimmyReports: [],
        chimmyPersonalities: [{ id: 'BALANCED', label: 'Balanced' }, { id: 'ADP_VALUE_HUNTER', label: 'Value hunter' }, { id: 'RB_HEAVY', label: 'Running backs' }, { id: 'FLOOR_SAFE', label: 'Plays it safe' }, { id: 'UPSIDE_SWINGER', label: 'Swings for upside' }],
        teams: [
          { rosterId: 'r1', teamName: null, managerName: null, status: 'unknown', suggested: false, emptySeat: true, managed: autopilot('dynasty_owner'),
            chimmy: { personality: 'ADP_VALUE_HUNTER', label: 'Value hunter', summary: 'Hunts bargains and rarely overpays.', trades: trades.r1 } },
          { rosterId: 'r2', teamName: 'Gridiron Ghosts', managerName: 'Sam', status: 'inactive', suggested: false, managed: autopilot('win_now'),
            chimmy: { personality: 'RB_HEAVY', label: 'Running backs', summary: 'Collects running backs.', trades: trades.r2 } },
          { rosterId: 'r3', teamName: 'Blitz Brigade', managerName: 'Dana', status: 'active', suggested: false, managed: null, chimmy: null },
          { rosterId: 'r4', teamName: 'End Zone Elite', managerName: 'Lee', status: 'inactive', suggested: true, managed: null, chimmy: null },
        ],
      }), { status: 200 })
    }) as typeof window.fetch
    setReady(true)
    return () => { window.fetch = real }
  }, [])
  return (
    <div className="af-core" style={{ minHeight: '100vh', padding: 16 }}>
      <main style={{ maxWidth: 760, margin: '0 auto' }}>{ready ? <InactiveManagerCommissioner leagueId="preview-league" /> : null}</main>
    </div>
  )
}
