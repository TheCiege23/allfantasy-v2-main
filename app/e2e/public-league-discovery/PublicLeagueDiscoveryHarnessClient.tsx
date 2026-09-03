'use client'

import { useEffect, useState } from 'react'
import { PublicLeagueDiscoveryPage } from '@/components/discovery'

export default function PublicLeagueDiscoveryHarnessClient() {
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setHydrated(true)
  }, [])

  return (
    <div className="min-h-screen bg-[#040915] px-4 py-6 text-white">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">Public League Discovery Harness</h1>
          <p className="text-sm text-white/70">
            Deterministic harness for public league discovery filters, ranking gates, cards, and join flows.
          </p>
          <p className="text-xs text-white/50" data-testid="public-league-discovery-hydrated-flag">
            {hydrated ? 'hydrated' : 'hydrating'}
          </p>
        </div>

        {hydrated ? (
          <PublicLeagueDiscoveryPage />
        ) : (
          <div
            className="rounded-3xl border border-white/10 bg-white/5 p-6 text-sm text-white/70"
            data-testid="public-league-discovery-loading-shell"
          >
            Preparing deterministic discovery controls...
          </div>
        )}
      </div>
    </div>
  )
}
