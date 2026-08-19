'use client'

import { SportAwareWaiverWire } from '@/components/waiver-wire/SportAwareWaiverWire'

export function WaiverWireLiveHarnessClient() {
  return (
    <main className="min-h-screen bg-[#050915] p-6 text-white">
      <h1 className="mb-3 text-lg font-semibold">Waiver Wire Live Harness</h1>
      <SportAwareWaiverWire leagueId="e2e-waiver-live" />
    </main>
  )
}
