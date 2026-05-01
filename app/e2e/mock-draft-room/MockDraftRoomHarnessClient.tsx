'use client'

import { useState } from 'react'
import MockDraftSimulatorWrapper from '@/components/mock-draft/MockDraftSimulatorWrapper'

const E2E_LEAGUES = [
  { id: 'e2e-lg-nfl', name: 'E2E NFL League', platform: 'Sleeper', leagueSize: 12, isDynasty: false, scoring: 'ppr', sport: 'NFL' },
  { id: 'e2e-lg-nhl', name: 'E2E NHL League', platform: 'Sleeper', leagueSize: 12, isDynasty: false, scoring: 'default', sport: 'NHL' },
  { id: 'e2e-lg-nba', name: 'E2E NBA League', platform: 'Sleeper', leagueSize: 12, isDynasty: false, scoring: 'default', sport: 'NBA' },
  { id: 'e2e-lg-mlb', name: 'E2E MLB League', platform: 'Sleeper', leagueSize: 12, isDynasty: false, scoring: 'default', sport: 'MLB' },
  { id: 'e2e-lg-ncaab', name: 'E2E NCAAB League', platform: 'Sleeper', leagueSize: 12, isDynasty: false, scoring: 'default', sport: 'NCAAB' },
  { id: 'e2e-lg-ncaaf', name: 'E2E NCAAF League', platform: 'Sleeper', leagueSize: 12, isDynasty: false, scoring: 'default', sport: 'NCAAF' },
  { id: 'e2e-lg-soccer', name: 'E2E Soccer League', platform: 'Sleeper', leagueSize: 12, isDynasty: false, scoring: 'default', sport: 'SOCCER' },
]

type HarnessMode = 'setup' | 'active'

export function MockDraftRoomHarnessClient({ mode = 'setup' }: { mode?: HarnessMode }) {
  const [open, setOpen] = useState(mode === 'active')
  const initialSessionDraft = mode === 'active'
    ? {
        id: 'mock-e2e-1',
        inviteLink: 'https://allfantasy.ai/mock-draft/join?invite=e2e',
        status: 'pre_draft',
        canManage: true,
      }
    : null

  if (!open) {
    return (
      <main className="min-h-screen bg-[#0a0a0f] p-6 text-white space-y-4">
        <h1 className="text-xl font-semibold">E2E Mock Draft Room Harness</h1>
        <p className="text-sm text-white/60">
          Open the mock draft room harness to validate setup, session controls, chat AI suggestions, ADP AI mode, and back navigation.
        </p>
        <button
          type="button"
          data-testid="mock-draft-enter-room-button"
          onClick={() => setOpen(true)}
          className="rounded border border-cyan-500/40 bg-cyan-500/20 px-3 py-2 text-sm text-cyan-200 hover:bg-cyan-500/30"
        >
          Enter mock draft room
        </button>
      </main>
    )
  }

  return (
    <div className="min-h-screen bg-[#05060b]">
      <div className="border-b border-white/10 bg-black/40 px-4 py-2">
        <button
          type="button"
          data-testid="mock-draft-harness-back-button"
          onClick={() => setOpen(false)}
          className="rounded border border-white/20 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10"
        >
          Back
        </button>
      </div>
      <div className="p-4">
        <MockDraftSimulatorWrapper leagues={E2E_LEAGUES} initialSessionDraft={initialSessionDraft} />
      </div>
    </div>
  )
}
