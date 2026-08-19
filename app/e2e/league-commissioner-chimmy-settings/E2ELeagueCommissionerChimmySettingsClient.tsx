'use client'

import ChimmyAlertPreferencesPanel from '@/components/chimmy-surfaces/ChimmyAlertPreferencesPanel'

export default function E2ELeagueCommissionerChimmySettingsClient() {
  return (
    <main className="min-h-screen bg-[#060b18] p-6 text-white" data-testid="league-commissioner-chimmy-settings-harness">
      <h1 className="mb-2 text-xl font-semibold">League Commissioner Chimmy Settings Harness</h1>
      <p className="mb-6 text-sm text-white/70">Chimmy Commissioner Alerts</p>
      <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <ChimmyAlertPreferencesPanel role="commissioner" />
      </section>
    </main>
  )
}