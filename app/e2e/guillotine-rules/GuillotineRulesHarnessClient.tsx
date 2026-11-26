'use client'

import { useState } from 'react'
import { GuillotineRulesPage } from '@/components/league-settings/home/GuillotineRulesPage'
import { DEFAULT_ADVANCED, type GuillotineAdvanced } from '@/lib/guillotine/chopSchedule'
import type { GuillotineRules } from '@/lib/guillotine/guillotineRules'
import { getAllNflSlots } from '@/lib/nfl-roster/NflRosterTemplates'
import { rosterSpotsFromDefinitions, type RosterChange, type RosterScheduleView } from '@/lib/guillotine/rosterSchedule'
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

const LAYOUT = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1, BN: 6, IR: 1 }
/** `locked` is a season under way: week 3 is being played, and one scheduled change has already run. */
const RAN: RosterChange = { id: 'ran', week: 3, kind: 'add_bench', slot: null, count: 1 }

function rosterView(props: Props): RosterScheduleView {
  const layout = props.locked ? { ...LAYOUT, BN: 7 } : LAYOUT
  return {
    changes: props.locked ? [RAN] : [],
    done: props.locked ? [RAN.id] : [],
    skipped: [],
    layout,
    spots: rosterSpotsFromDefinitions(getAllNflSlots(), layout),
    fromWeek: props.locked ? 4 : 2,
    toWeek: props.endWeek,
    supported: true,
  }
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
    roster: rosterView(props),
  }
  const real = w.fetch.bind(window)
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  w.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (!url.startsWith(`/api/leagues/${LEAGUE_ID}/guillotine/summary`)) return url.startsWith('/api/') ? json({ error: 'Not part of this harness.' }, 404) : real(input, init)
    if (String(init?.method ?? 'GET').toUpperCase() === 'GET') return json(stored)
    const body = JSON.parse(String(init?.body ?? '{}')) as { eliminationStartWeek?: number; rules?: Partial<GuillotineRules>; advanced?: GuillotineAdvanced; rosterSchedule?: RosterChange[] }
    if (body.rosterSchedule) {
      if (!props.paid && body.rosterSchedule.length > 0) return json({ error: 'Scheduled roster changes are part of AF Commissioner.', code: 'not_entitled' }, 402)
      const history = stored.roster.changes.filter((c) => stored.roster.done.includes(c.id))
      stored = { ...stored, roster: { ...stored.roster, changes: [...history, ...body.rosterSchedule] } }
      return json({ ok: true, roster: stored.roster })
    }
    if (body.eliminationStartWeek != null) {
      stored = { ...stored, startWeek: body.eliminationStartWeek }
      return json({ ok: true, config: { eliminationStartWeek: stored.startWeek, eliminationEndWeek: stored.rules.eliminationEndWeek } })
    }
    if (body.rules) {
      stored = { ...stored, rules: { ...stored.rules, ...body.rules } }
      const { roster: _roster, ...rulesView } = stored
      return json({ ok: true, ...rulesView })
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
