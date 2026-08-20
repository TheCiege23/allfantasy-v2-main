'use client'

import LeagueShell from '@/components/app/LeagueShell'
import type { LeagueShellTab } from '@/components/app/LeagueTabNav'

const FOLLOW_UP_TABS: LeagueShellTab[] = ['Overview', 'Roster', 'Draft', 'Waivers', 'Settings']

function renderFollowUpTab(tab: LeagueShellTab) {
  if (tab === 'Roster') {
    return (
      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <h3 className="text-sm font-semibold text-white">Roster</h3>
        <p className="mt-1 text-xs text-white/70" data-testid="league-follow-up-roster-panel">
          Roster panel rendered.
        </p>
      </section>
    )
  }

  if (tab === 'Draft') {
    return (
      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <h3 className="text-sm font-semibold text-white">Draft</h3>
        <p className="mt-1 text-xs text-white/70" data-testid="league-follow-up-draft-panel">
          Draft panel rendered.
        </p>
      </section>
    )
  }

  if (tab === 'Waivers') {
    return (
      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <h3 className="text-sm font-semibold text-white">Waivers</h3>
        <p className="mt-1 text-xs text-white/70" data-testid="league-follow-up-waivers-panel">
          Waivers panel rendered.
        </p>
      </section>
    )
  }

  if (tab === 'Settings') {
    return (
      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <h3 className="text-sm font-semibold text-white">Settings</h3>
        <button
          type="button"
          className="mt-2 rounded-lg border border-white/20 px-3 py-1.5 text-xs text-white/80"
          data-testid="league-follow-up-settings-general"
        >
          General
        </button>
      </section>
    )
  }

  return (
    <section className="rounded-xl border border-white/10 bg-black/20 p-4">
      <h3 className="text-sm font-semibold text-white">Overview</h3>
      <p className="mt-1 text-xs text-white/70" data-testid="league-follow-up-overview-panel">
        Overview panel rendered.
      </p>
    </section>
  )
}

export function LeagueShellFollowUpHarnessClient() {
  return (
    <main className="min-h-screen bg-[#0a0a0f] px-4 py-6 text-white">
      <h1 className="mx-auto mb-4 max-w-5xl text-lg font-semibold">League shell follow-up navigation harness</h1>
      <LeagueShell
        leagueName="Harness League"
        initialTab="Overview"
        tabs={FOLLOW_UP_TABS}
        renderTab={renderFollowUpTab}
        leagueModeLabel="Dynasty"
      />
    </main>
  )
}
