'use client'

import { useSearchParams } from 'next/navigation'
import DraftSettingsPanel from '@/components/app/settings/DraftSettingsPanel'

export default function DraftSettingsHarnessClient() {
  const searchParams = useSearchParams()
  const leagueId = searchParams.get('leagueId') ?? 'e2e-settings-league'

  return (
    <main className="min-h-screen bg-[#040915] p-6 text-white">
      <h1 className="mb-4 text-xl font-semibold">E2E Draft Settings Harness</h1>
      <DraftSettingsPanel leagueId={leagueId} />
    </main>
  )
}
