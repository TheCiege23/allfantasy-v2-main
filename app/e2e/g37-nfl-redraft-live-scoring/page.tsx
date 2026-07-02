'use client'

import { useEffect, useMemo, useState } from 'react'
import { MatchupView } from '@/app/league/[leagueId]/tabs/redraft/MatchupView'
import type { CanonicalLeagueRules } from '@/lib/league-runtime/canonicalLeagueRules'
import type { RedraftMatchupClient } from '@/lib/redraft/client'
import {
  buildNflRedraftLiveScoringRuntimeState,
  type NflRedraftRuntimeScoreInput,
  type NflRedraftRuntimeTeamInput,
} from '@/lib/scoring-runtime/canonicalNflRedraftScoringRuntime'

const rules = {
  version: 1,
  leagueId: 'league-g37-browser',
  generatedAtIso: '2026-07-02T12:00:00.000Z',
  source: {
    commissionerSettings: 'League',
    draftSettings: 'LeagueSettings',
    effectiveResolvers: ['draft', 'draftUi', 'scoring', 'waivers', 'playoffs', 'schedule'],
    settingsSnapshotVersion: 6,
    presetKey: 'af:v2|concept=redraft|sport=NFL',
  },
  general: {
    name: 'G37 Browser League',
    sport: 'NFL',
    season: 2026,
    format: 'redraft',
    variant: null,
    teamCount: 2,
    rosterSize: 7,
    lifecycleState: 'active',
    status: 'active',
    locked: false,
    emergencyPaused: false,
    timezone: 'America/New_York',
    language: 'en',
  },
  draft: {} as CanonicalLeagueRules['draft'],
  scoring: {
    templateId: 'nfl_half_ppr',
    presetId: 'nfl_half_ppr',
    formatType: 'redraft',
    sport: 'NFL',
    activeRuleCount: 1,
    overriddenRuleCount: 0,
    activeRules: [{ statKey: 'te_premium', pointsValue: 0.5, multiplier: 1, enabled: true }],
  },
  roster: {
    size: 7,
    starters: ['QB', 'TE', 'RB', 'K', 'DEF'],
    irSlots: 1,
    eligibleReserveStatuses: ['IR'],
    allowPreDraftMoves: true,
    preventBenchDrops: false,
    lockAllMoves: false,
  },
  waivers: {} as CanonicalLeagueRules['waivers'],
  trades: { reviewHours: 24, deadlineWeek: 10, draftPickTrading: true },
  playoffs: { teamCount: 2, startWeek: 15, standingsTiebreakers: ['win_pct', 'points_for'] },
  schedule: {
    unit: 'week',
    regularSeasonLength: 14,
    matchupFrequency: 'weekly',
    matchupCadence: 'weekly',
    generationStrategy: 'round_robin',
    playoffTransitionPoint: 15,
    headToHeadBehavior: 'standard',
    lockTimeBehavior: 'per_player_kickoff',
    lockWindowBehavior: 'nfl_week',
    scoringPeriodBehavior: 'weekly',
    rescheduleHandling: null,
    doubleheaderHandling: null,
  },
  permissions: {
    settingsEditableByRoles: ['commissioner'],
    memberMovesLocked: false,
    inviteLinksDisabled: false,
    inviteCapacityOverride: false,
  },
  intelligence: {} as CanonicalLeagueRules['intelligence'],
} as CanonicalLeagueRules

const teams: NflRedraftRuntimeTeamInput[] = [
  {
    rosterId: 'alpha',
    displayName: 'Alpha Redraft',
    ownerName: 'Ava',
    players: [
      { rosterId: 'alpha', playerId: 'qb-1', playerName: 'Quarterback One', position: 'QB', slotType: 'QB' },
      { rosterId: 'alpha', playerId: 'te-1', playerName: 'Premium Tight End', position: 'TE', slotType: 'TE' },
      { rosterId: 'alpha', playerId: 'rb-bench', playerName: 'Bench Runner', position: 'RB', slotType: 'BENCH' },
    ],
  },
  {
    rosterId: 'bravo',
    displayName: 'Bravo Redraft',
    ownerName: 'Ben',
    players: [
      { rosterId: 'bravo', playerId: 'rb-1', playerName: 'Runner One', position: 'RB', slotType: 'RB' },
      { rosterId: 'bravo', playerId: 'k-1', playerName: 'Kicker One', position: 'K', slotType: 'K' },
      { rosterId: 'bravo', playerId: 'nfl:def:KC', playerName: 'Kansas City D/ST', position: 'DEF', slotType: 'DEF' },
    ],
  },
]

const scoreRows: NflRedraftRuntimeScoreInput[] = [
  { playerId: 'qb-1', stats: { pass_yds: 260, pass_td: 3, __af_correction_version: 1 }, isFinalized: true },
  { playerId: 'te-1', stats: { rec: 6, rec_yds: 60 }, isFinalized: true },
  { playerId: 'rb-bench', stats: { rush_yds: 120, rush_td: 1 }, isFinalized: true },
  { playerId: 'rb-1', stats: { rush_yds: 80, rush_td: 2, rec: 2, rec_yds: 10 }, isFinalized: true },
  { playerId: 'k-1', stats: { fg_0_39: 2, fg_50_plus: 1, xp_made: 3, fg_miss: 1 }, isFinalized: true },
  { playerId: 'nfl:def:KC', stats: { def_sack: 3, def_int: 1, def_fr: 1, def_td: 1, def_points_allowed: 10 }, isFinalized: true },
]

export default function G37NflRedraftLiveScoringHarness() {
  const [mode, setMode] = useState<'dark' | 'light'>('dark')
  const [hydrated, setHydrated] = useState(false)
  const state = useMemo(
    () =>
      buildNflRedraftLiveScoringRuntimeState({
        leagueId: rules.leagueId,
        seasonId: 'season-g37-browser',
        season: 2026,
        week: 1,
        rules,
        teams,
        matchups: [{ matchupId: 'm1', week: 1, homeRosterId: 'alpha', awayRosterId: 'bravo' }],
        scoreRows,
        now: new Date('2026-07-02T12:00:00.000Z'),
      }),
    [],
  )
  const fallbackMatchup: RedraftMatchupClient = {
    id: 'm1',
    week: 1,
    status: 'final',
    homeScore: state.matchups[0]?.homeScore ?? 0,
    awayScore: state.matchups[0]?.awayScore ?? 0,
    homeRosterId: 'alpha',
    awayRosterId: 'bravo',
    homeRoster: { id: 'alpha', teamName: 'Alpha Redraft', ownerName: 'Ava', wins: 0, losses: 1, pointsFor: 38.4 },
    awayRoster: { id: 'bravo', teamName: 'Bravo Redraft', ownerName: 'Ben', wins: 1, losses: 0, pointsFor: 52 },
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setMode(params.get('mode') === 'light' ? 'light' : 'dark')
    setHydrated(true)
  }, [])

  return (
    <main
      data-mode={mode}
      className={mode === 'dark' ? 'min-h-screen bg-[#07111f] p-4 text-white' : 'min-h-screen bg-slate-100 p-4 text-slate-950'}
    >
      <div className="mx-auto max-w-6xl space-y-4" data-testid="g37-live-scoring-harness" data-hydrated={hydrated ? 'true' : 'false'}>
        <MatchupView
          matchup={fallbackMatchup}
          liveMatchup={state.matchups[0]}
          selectedRosterId="alpha"
          sport="NFL"
        />

        <section
          data-testid="redraft-live-standings"
          className="rounded-2xl border border-white/[0.08] bg-[#0a1220] p-4 text-white"
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-200/70">Standings after scoring</p>
              <p className="text-[11px] text-white/45">Week {state.week} results are resolved from starter totals only.</p>
            </div>
            <span className="rounded-full border border-emerald-300/25 bg-emerald-400/10 px-2 py-1 text-[10px] font-semibold text-emerald-100">
              {state.coverage.finalizedMatchups} final
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {state.standings.map((row) => (
              <div key={row.rosterId} className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3">
                <p className="text-[12px] font-bold">{row.playoffSeed}. {row.displayName}</p>
                <p className="mt-1 text-[11px] text-white/50">
                  {row.wins}-{row.losses}-{row.ties} · PF {row.pointsFor.toFixed(2)} · PA {row.pointsAgainst.toFixed(2)}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section
          data-testid="redraft-scoring-audit"
          className="rounded-2xl border border-white/[0.08] bg-[#0a1220] p-4 text-white"
        >
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-200/70">Commissioner scoring audit</p>
          <p className="mt-1 text-[12px] text-white/60">
            Correction version {state.coverage.correctionVersion} is visible, and bench points remain separated from matchup totals.
          </p>
        </section>
      </div>
    </main>
  )
}
