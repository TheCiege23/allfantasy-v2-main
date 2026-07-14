'use client'

import { useEffect, useState } from 'react'
import { CommissionerOperationsWorkspace } from '@/components/league-home/CommissionerOperationsWorkspace'

const league = {
  id: 'g47-commissioner-league',
  name: 'G47 Commissioner League',
  sport: 'NFL',
  leagueType: 'redraft',
  lifecycleState: 'regular_season',
  currentWeek: 7,
} as never

export default function G47CommissionerOperationsHarness() {
  const [isCommissioner, setIsCommissioner] = useState(true)
  const [lastAction, setLastAction] = useState('none')
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => setHydrated(true), [])
  return (
    <main className="min-h-screen bg-[#050814] text-white" data-testid="g47-commissioner-harness" data-hydrated={hydrated ? 'true' : 'false'}>
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-[#050814]/95 p-3">
        <button type="button" className="min-h-11 rounded-xl border border-white/15 px-4" onClick={() => setIsCommissioner((value) => !value)} data-testid="g47-toggle-role">
          {isCommissioner ? 'View member state' : 'View commissioner state'}
        </button>
        <span data-testid="g47-last-action" className="text-xs text-cyan-200">{lastAction}</span>
      </div>
      <CommissionerOperationsWorkspace
        league={league}
        leagueId="g47-commissioner-league"
        isCommissioner={isCommissioner}
        hasActiveRedraftSeason
        onOpenSettings={(panel) => setLastAction(`settings:${panel ?? 'hub'}`)}
        onOpenTab={(tab) => setLastAction(`tab:${tab}`)}
      />
    </main>
  )
}
