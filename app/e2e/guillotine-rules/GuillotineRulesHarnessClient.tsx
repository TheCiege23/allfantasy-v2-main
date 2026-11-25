'use client'

import { useState } from 'react'
import { GuillotineRulesPage } from '@/components/league-settings/home/GuillotineRulesPage'
import { DEFAULT_ADVANCED, type GuillotineAdvanced } from '@/lib/guillotine/chopSchedule'
import type { GuillotineRules } from '@/lib/guillotine/guillotineRules'
// The settings page loads these itself (components/league-settings/home/LeagueSettingsHome.tsx); the harness
// draws the sub-page without that shell, so it must too.
import '@/components/core-app/af-core.css'
import '@/components/league/league-admin.css'
import '@/components/league-settings/home/league-settings-home.css'

const LEAGUE_ID = 'e2e-guillotine-rules'

type Props = { paid: boolean; teamCount: number; endWeek: number; locked: boolean }

const RULES: GuillotineRules = {
  teamsPerChop: 1,
  eliminationEndWeek: 18,
  endgame: 'last_team_standing',
  tiebreakerOrder: ['bench_points', 'season_points', 'previous_period', 'draft_slot', 'commissioner', 'random'],
  statCorrectionHours: 48,
  dangerMarginPoints: 10,
  rosterReleaseTiming: 'next_waiver_run',
  aiRecapAuto: true,
  faabOnChop: 'keep',
  faabOnChopPercent: 100,
  bestBall: false,
  periodWeeks: 1,
  chopListOrder: 'chop_top',
}

/** Answers the page's one GET and accepts its PATCHes in the browser. Nothing reaches a route. */
function installFetch(props: Props) {
  const w = window as unknown as { __glRulesFetch?: boolean; fetch: typeof fetch }
  if (w.__glRulesFetch) return
  w.__glRulesFetch = true
  let stored = {
    rules: { ...RULES, eliminationEndWeek: props.endWeek },
    startWeek: props.locked ? 3 : 1,
    seasonWeeks: 18,
    endgameLocked: props.locked,
    bestBallLocked: props.locked,
    periodWeeksAvailable: false,
    canEditPaid: props.paid,
    aiRecapAvailable: props.paid,
    advanced: DEFAULT_ADVANCED as GuillotineAdvanced,
    teamCount: props.teamCount,
  }
  const real = w.fetch.bind(window)
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  w.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (!url.startsWith(`/api/leagues/${LEAGUE_ID}/guillotine/summary`)) return url.startsWith('/api/') ? json({ error: 'Not part of this harness.' }, 404) : real(input, init)
    if (String(init?.method ?? 'GET').toUpperCase() === 'GET') return json(stored)
    const body = JSON.parse(String(init?.body ?? '{}')) as { eliminationStartWeek?: number; rules?: Partial<GuillotineRules>; advanced?: GuillotineAdvanced }
    if (body.eliminationStartWeek != null) {
      stored = { ...stored, startWeek: body.eliminationStartWeek }
      return json({ ok: true, config: { eliminationStartWeek: stored.startWeek, eliminationEndWeek: stored.rules.eliminationEndWeek } })
    }
    if (body.rules) {
      stored = { ...stored, rules: { ...stored.rules, ...body.rules } }
      return json({ ok: true, ...stored })
    }
    stored = { ...stored, advanced: body.advanced ?? stored.advanced }
    return json({ ok: true, advanced: stored.advanced, scheduleLines: [] })
  }
}

/** Harness only (app/e2e is 404 in production). The real page; a fixture league of `teamCount` teams. */
export default function GuillotineRulesHarnessClient(props: Props) {
  // Synchronously, during the first render, so it is in place before the page's effect fetches.
  useState(() => (typeof window === 'undefined' ? null : installFetch(props)))
  return (
    <div className="af-core lsh-root" data-testid="league-settings-subpage" data-subpage="guillotine-rules" style={{ minHeight: '100vh', background: '#070b16' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '20px 16px 96px' }}>
        <header className="lsh-header"><h1>Guilly rules</h1></header>
        <div className="lsh-subpage-body af-league-admin">
          <GuillotineRulesPage leagueId={LEAGUE_ID} chopLabel="By Tuesday 9:00 AM ET" waiverLabel="Wednesday 3:00 AM ET" />
        </div>
      </div>
    </div>
  )
}
