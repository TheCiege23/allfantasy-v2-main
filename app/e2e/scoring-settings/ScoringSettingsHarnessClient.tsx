'use client'

import ScoringSettingsPanel from '@/components/app/settings/ScoringSettingsPanel'

export function ScoringSettingsHarnessClient({ leagueId }: { leagueId: string }) {
  return (
    <main className="min-h-screen bg-[#040915] p-6 text-white">
      <h1 className="text-xl font-semibold">E2E scoring settings harness</h1>
      <div className="mt-6 max-w-2xl">
        <ScoringSettingsPanel leagueId={leagueId} />
      </div>
    </main>
  )
}
