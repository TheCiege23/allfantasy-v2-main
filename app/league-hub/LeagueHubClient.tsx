'use client'

import { ActiveLeagueContextProvider, useActiveLeagueContext } from '@/components/league-hub/ActiveLeagueContextProvider'
import { LeagueSelector } from '@/components/league-hub/LeagueSelector'
import { UserOsActionsSummary } from '@/components/league-hub/UserOsActionsSummary'
import { CommissionerOsActionsSummary } from '@/components/league-hub/CommissionerOsActionsSummary'
import { CrossLeaguePlayerSummary } from '@/components/league-hub/CrossLeaguePlayerSummary'

function ActiveLeagueSummary() {
  const { context, isLoading } = useActiveLeagueContext()

  if (!context) {
    return <p className="text-sm text-white/50">Select a league to establish the active league context.</p>
  }

  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
      <div>
        <dt className="text-white/40">Provider</dt>
        <dd className="text-white">{context.provider}</dd>
      </div>
      <div>
        <dt className="text-white/40">Sport</dt>
        <dd className="text-white">{context.sport}</dd>
      </div>
      <div>
        <dt className="text-white/40">Season</dt>
        <dd className="text-white">{context.season ?? '—'}</dd>
      </div>
      <div>
        <dt className="text-white/40">Commissioner</dt>
        <dd className="text-white">
          {context.isCommissioner ? 'Yes' : 'No'}
          {isLoading ? ' (refreshing…)' : ''}
        </dd>
      </div>
    </dl>
  )
}

export function LeagueHubClient() {
  return (
    <ActiveLeagueContextProvider>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <h1 className="text-xl font-semibold text-white">League Hub</h1>
        <p className="mt-1 text-sm text-white/50">
          Every league you own or participate in — native and imported — in one place.
        </p>

        <section className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <h2 className="text-sm font-medium text-white/70">Active league context</h2>
          <div className="mt-3">
            <ActiveLeagueSummary />
          </div>
        </section>

        <CrossLeaguePlayerSummary />
        <UserOsActionsSummary />
        <CommissionerOsActionsSummary />

        <section className="mt-6">
          <LeagueSelector />
        </section>
      </main>
    </ActiveLeagueContextProvider>
  )
}
