'use client'

import GeneralSettingsPanel from '@/components/app/settings/GeneralSettingsPanel'

export function GeneralSettingsContextHarnessClient() {
  return (
    <main className="min-h-screen bg-[#0a0a0f] px-4 py-6 text-white">
      <h1 className="mx-auto mb-4 max-w-3xl text-lg font-semibold">
        General settings variant context harness
      </h1>
      <div className="mx-auto max-w-3xl">
        <GeneralSettingsPanel leagueId="e2e-league-settings-context" />
      </div>
    </main>
  )
}
