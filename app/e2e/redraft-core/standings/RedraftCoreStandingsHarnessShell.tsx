'use client'

import { useState, type ReactNode } from 'react'
import AfCoreShell, { type CoreNavKey } from '@/components/core-app/AfCoreShell'
import type { RedraftSportTheme } from '@/lib/league-media/redraftIdentity'
import type { ChecklistItem } from '@/lib/commissioner/weeklyChecklist'

type Props = {
  active: CoreNavKey
  sport: string
  redraftSport: RedraftSportTheme | null
  leagueId: string
  leagueName: string
  /** The commissioner checklist the real WeeklyChecklist island fetches; null answers 404 (it then hides). */
  checklist: { applies: true; week: number; items: ChecklistItem[] } | null
  children: ReactNode
}

/**
 * Answers the screens' own client fetches, so the real islands run with no database: the weekly
 * checklist from the fixture (built by the real `buildWeeklyChecklist`), and everything else 404, which
 * every optional commissioner card already treats as "nothing to show". Writes are refused.
 * Installed during the first render — before any child effect — and only on this harness page.
 */
function installFixtureFetch(checklist: Props['checklist']) {
  const w = window as unknown as { __rdcHarnessFetch?: boolean; __rdcChecklist?: Props['checklist']; fetch: typeof fetch }
  w.__rdcChecklist = checklist
  if (w.__rdcHarnessFetch) return
  w.__rdcHarnessFetch = true
  const real = w.fetch.bind(window)
  w.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0]
    if (!path.startsWith('/api/')) return real(input, init)
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    if (String(init?.method ?? 'GET').toUpperCase() !== 'GET') return json({ error: 'Harness: writes are disabled.' }, 409)
    if (path.endsWith('/weekly-checklist') && w.__rdcChecklist) return json(w.__rdcChecklist)
    return json({ error: 'not in harness' }, 404)
  }
}

/** Harness only (app/e2e is 404 in production): the real AfCoreShell chrome around one real /core screen. */
export default function RedraftCoreStandingsHarnessShell(props: Props) {
  useState(() => {
    if (typeof window !== 'undefined') installFixtureFetch(props.checklist)
    return true
  })
  const league = { id: props.leagueId, name: props.leagueName, platform: 'allfantasy', mark: 'SN', sport: props.sport }
  const other = { id: 'e2e-redraft-core-2', name: 'Office Dynasty', platform: 'sleeper', mark: 'OD', sport: 'NFL' }
  return (
    <AfCoreShell
      active={props.active}
      leagues={[league, other]}
      selectedLeagueId={league.id}
      nativeLeague
      redraftSport={props.redraftSport}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
      scope={{ value: league.id, label: league.name, favoriteIds: [], leagues: [league, other] }}
      comms={{ leagues: [], chimmyTokenCost: null, dockable: false, supportEmail: null }}
    >
      <div data-testid="redraft-core-standings-fixture">{props.children}</div>
    </AfCoreShell>
  )
}
