/**
 * The live create wizard now asks the Best Ball questions (BestBallSetupPanel on the Draft step), and
 * every answer is SAVED and READ BACK: wizard state -> submitCreateLeagueV2 body -> validateCreatePayload
 * -> createCanonicalLeagueInTransaction -> League row + settings.best_ball_settings, then read back
 * through normalizeBestBallSettings, the reader every Best Ball surface uses.
 *
 * Before: the wizard had no Best Ball controls; every league got bestBallSetupForTeamCount() defaults,
 * and NBA / NHL / MLB defaulted to a "daily" scoring period nobody chose.
 */
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ prisma: { league: { findUnique: vi.fn(), create: vi.fn() } } }))
vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useLanguage: () => ({ t: (key: string) => key, language: 'en' }) }))
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => ({ hasCommissioner: false, loading: false }) }))
// eslint-disable-next-line @next/next/no-img-element
vi.mock('next/image', () => ({ default: (props: { alt: string }) => <img alt={props.alt} /> }))
vi.mock('@/components/create-league-v2/CreateLeagueVideoTile', () => ({
  CreateLeagueVideoTile: ({ testId, onSelect, title }: { testId: string; onSelect: () => void; title: string }) => (
    <button data-testid={testId} onClick={onSelect}>{title}</button>
  ),
}))

import { DEFAULT_V2_STATE, getDefaultBestBallSetup, type CreateLeagueV2State } from '@/lib/create-league-v2/state'
import { submitCreateLeagueV2 } from '@/lib/create-league-v2/submit'
import { validateCreatePayload } from '@/lib/league-creation/canonical/validateCreateLeague'
import { createCanonicalLeagueInTransaction } from '@/lib/league-creation/canonical/createCanonicalLeagueInTransaction'
import { runPresetEngine } from '@/lib/league-creation/preset-engine/runPresetEngine'
import { normalizeBestBallSettings } from '@/lib/bestball/rules'
import {
  bestBallPlayoffTeamChoices,
  fitBestBallToTeamCount,
  bestBallRulesSummary,
  withBestBallCompetition,
  withBestBallPlayoffTeams,
  withBestBallScoringPeriod,
  withBestBallWaivers,
} from '@/lib/create-league-v2/bestBallWizard'
import { DraftStep, ReviewCreateStep } from '@/components/create-league-v2/CreateLeagueWizard'

type Obj = Record<string, any>

function buildTx() {
  let n = 0
  const ok = (id: string) => vi.fn().mockResolvedValue({ id })
  return {
    userProfile: { findUnique: vi.fn().mockResolvedValue({ displayName: 'C', xpLevel: 1, legacyCareerLevel: null }) },
    appUser: { findUnique: vi.fn().mockResolvedValue({ username: 'c', email: 'c@test.local' }) },
    league: { findFirst: vi.fn().mockResolvedValue(null), create: ok('league-1'), update: ok('league-1') },
    leagueSettings: { create: ok('ls') },
    leagueWaiverSettings: { create: ok('lws') },
    scoringSettingsSnapshot: { create: ok('ss') },
    guillotineLeagueConfig: { upsert: ok('g') },
    idpLeagueConfig: { upsert: ok('i') },
    dynastyLeagueConfig: { upsert: ok('d') },
    devyLeagueConfig: { upsert: ok('dv') },
    c2CLeagueConfig: { upsert: ok('c') },
    redraftLeagueExtendedSettings: { create: ok('e') },
    redraftLeagueDraftProfile: { create: ok('dp') },
    redraftLeagueHomepageState: { create: ok('h') },
    redraftLeagueSportIntegration: { create: ok('si') },
    redraftLeagueChatRoom: { create: ok('chat') },
    bestBallContest: { create: ok('bbc') },
    roster: { create: vi.fn().mockImplementation(async (args?: Obj) => ({ id: `roster-${++n}`, platformUserId: args?.data?.platformUserId ?? `p-${n}` })) },
    leagueTeam: { create: vi.fn().mockImplementation(async () => ({ id: `team-${++n}` })) },
    redraftLeagueMember: { create: ok('m') },
    leagueEntrySlot: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    draftSession: { create: ok('ds') },
    leagueInvite: { create: vi.fn().mockResolvedValue({ id: 'inv', token: 'T' }) },
    findLeagueListing: { upsert: ok('fl') },
  }
}

const PRESET: Record<string, string> = { NFL: 'fb_half_ppr', NBA: 'nba_points', NHL: 'nhl_points', MLB: 'mlb_points', NCAAF: 'ncaaf_half_ppr' }

function bestBallState(sport: CreateLeagueV2State['sport'], teamCount: number, edit: (bb: CreateLeagueV2State['bestBall']) => CreateLeagueV2State['bestBall'] = (bb) => bb): CreateLeagueV2State {
  const bestBall = getDefaultBestBallSetup(sport, 'standard', 'snake')
  return {
    ...DEFAULT_V2_STATE, sport, leagueType: 'best_ball', leagueTypeTouched: true, teamCount, draftType: 'snake',
    scoringPresetId: PRESET[sport], name: 'BB', nameTouched: true, draftScheduleLater: true,
    bestBall: edit({ ...bestBall, playoffTeams: Math.min(bestBall.playoffTeams, teamCount) }),
  }
}

/** The whole create path; returns the League.create data. */
async function createThroughWizard(state: CreateLeagueV2State): Promise<Obj> {
  let body: unknown = null
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
    body = JSON.parse(init.body)
    return new Response(JSON.stringify({ ok: true, league: { id: 'x' } }), { status: 200 })
  }))
  await submitCreateLeagueV2(state)
  const validated = validateCreatePayload(body)
  if (!validated.ok) throw new Error(`refused: ${validated.error}`)
  const tx = buildTx()
  await createCanonicalLeagueInTransaction(tx as any, 'u1', validated.data as any, runPresetEngine({ ...(validated.data as any), commissionerId: 'u1' }))
  return tx.league.create.mock.calls[0][0].data as Obj
}

function readBack(data: Obj) {
  return normalizeBestBallSettings({ sport: data.sport, conceptSetup: { bestBall: data.settings.best_ball_settings } })
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('every Best Ball choice is saved and read back', () => {
  it('NBA: season-long points, no playoffs, daily, managed (waivers on)', async () => {
    const defaults = getDefaultBestBallSetup('NBA')
    const data = await createThroughWizard(bestBallState('NBA', 12, (bb) =>
      withBestBallWaivers(withBestBallScoringPeriod(withBestBallPlayoffTeams(withBestBallCompetition(bb, 'season_total', { sport: 'NBA', teamCount: 12, defaults }), 0, { sport: 'NBA', defaults }), 'daily', 'NBA'), true)))
    const saved = readBack(data)
    expect(saved).toMatchObject({ matchupFormat: 'cumulative', cumulativeScoring: true, playoffFormat: 'none', playoffTeams: 0, scoringPeriod: 'daily', waiversEnabled: true, regularSeasonLength: 25 })
    expect(data).toMatchObject({ playoffTeams: 0, playoffStartWeek: null, bbScoringPeriod: 'daily', bbWaiversEnabled: true, bbFaEnabled: true, bbMatchupFormat: 'cumulative' })
  })

  it('NFL: head-to-head, 4 playoff teams, weekly, draft only', async () => {
    const defaults = getDefaultBestBallSetup('NFL')
    const data = await createThroughWizard(bestBallState('NFL', 12, (bb) =>
      withBestBallWaivers(withBestBallPlayoffTeams(withBestBallCompetition(bb, 'h2h', { sport: 'NFL', teamCount: 12, defaults }), 4, { sport: 'NFL', defaults }), false)))
    expect(readBack(data)).toMatchObject({ matchupFormat: 'h2h', cumulativeScoring: false, playoffFormat: 'bracket', playoffTeams: 4, scoringPeriod: 'weekly', waiversEnabled: false })
    expect(data).toMatchObject({ playoffTeams: 4, bbScoringPeriod: 'weekly', bbWaiversEnabled: false, bbFaEnabled: false, bbMatchupFormat: 'h2h' })
  })

  it('NFL tournament, 16 teams: two pods of 8, one advancement round, weekly, finishing by week 18', async () => {
    const defaults = getDefaultBestBallSetup('NFL')
    const data = await createThroughWizard(bestBallState('NFL', 16, (bb) => withBestBallCompetition(bb, 'tournament', { sport: 'NFL', teamCount: 16, defaults })))
    const saved = readBack(data)
    expect(saved).toMatchObject({ contestStructure: 'tournament', scoringPeriod: 'weekly', tournamentAdvancementRounds: 1, podSize: 8, advancersPerPod: 1, playoffTeams: 0 })
    expect(saved.regularSeasonLength + saved.tournamentAdvancementRounds).toBeLessThanOrEqual(18)
    expect(data.bestBallVariant).toBe('tournament')
  })

  it('Weekly is the default — NBA, NHL and MLB no longer start on "daily"', async () => {
    for (const sport of ['NBA', 'NHL', 'MLB'] as const) {
      const data = await createThroughWizard(bestBallState(sport, 12))
      expect(readBack(data).scoringPeriod, sport).toBe('weekly')
      expect(data.bbScoringPeriod, sport).toBe('weekly')
    }
  })
})

const nfl = getDefaultBestBallSetup('NFL')

describe('choices respect the rules', () => {
  it('daily only for NBA / NHL / MLB, and never for a tournament', () => {
    expect(withBestBallScoringPeriod(nfl, 'daily', 'NFL').scoringPeriod).toBe('weekly')
    const nba = getDefaultBestBallSetup('NBA')
    expect(withBestBallScoringPeriod(nba, 'daily', 'NBA').scoringPeriod).toBe('daily')
    const tournament = { ...nba, contestStructure: 'tournament' as const, tournamentEnabled: true }
    expect(withBestBallScoringPeriod(tournament, 'daily', 'NBA').scoringPeriod).toBe('weekly')
  })

  it('a tournament switches a daily league back to weekly', () => {
    const daily = withBestBallScoringPeriod(getDefaultBestBallSetup('NFL'), 'weekly', 'NFL')
    expect(withBestBallCompetition({ ...daily, scoringPeriod: 'daily' }, 'tournament', { sport: 'NFL', teamCount: 12, defaults: nfl }).scoringPeriod).toBe('weekly')
  })

  it('a new league size re-cuts tournament pods and shrinks a bracket that no longer fits', () => {
    const t = withBestBallCompetition(nfl, 'tournament', { sport: 'NFL', teamCount: 12, defaults: nfl })
    expect(fitBestBallToTeamCount(t, 6)).toMatchObject({ podSize: 6, tournamentAdvancementRounds: 0 })
    expect(fitBestBallToTeamCount(t, 16)).toMatchObject({ podSize: 8, tournamentAdvancementRounds: 1 })
    expect(fitBestBallToTeamCount({ ...nfl, playoffTeams: 8 }, 6).playoffTeams).toBe(6)
  })

  it('playoff sizes never exceed the league, and "none" is always offered', () => {
    expect(bestBallPlayoffTeamChoices(6)).toEqual([0, 2, 4, 6])
    expect(bestBallPlayoffTeamChoices(12)).toEqual([0, 2, 4, 6, 8])
  })

  it('turning playoffs back on restores a regular season with weeks left for the bracket', () => {
    const none = withBestBallPlayoffTeams(nfl, 0, { sport: 'NFL', defaults: nfl })
    expect(none.regularSeasonLength).toBe(17)
    expect(withBestBallPlayoffTeams(none, 6, { sport: 'NFL', defaults: nfl }).regularSeasonLength).toBe(nfl.regularSeasonLength)
  })
})

describe('the review step says the rules in plain words', () => {
  it('season-long, no playoffs, daily, draft only', () => {
    const nba = getDefaultBestBallSetup('NBA')
    const bb = withBestBallScoringPeriod(withBestBallPlayoffTeams(withBestBallCompetition(nba, 'season_total', { sport: 'NBA', teamCount: 12, defaults: nba }), 0, { sport: 'NBA', defaults: nba }), 'daily', 'NBA')
    const text = Object.fromEntries(bestBallRulesSummary(bb, 'NBA', 12).map((l) => [l.id, l.text]))
    expect(text.lineups).toMatch(/every day/)
    expect(text.transactions).toMatch(/^Draft only: no waivers, no free agency/)
    expect(text.season).toBe('Weeks 1–25 (25 weeks), no playoffs.')
    expect(text.champion).toBe('The team with the most total points after week 25 wins.')
  })

  it('head-to-head with a bracket, managed', () => {
    const bb = withBestBallWaivers(withBestBallCompetition(nfl, 'h2h', { sport: 'NFL', teamCount: 12, defaults: nfl }), true)
    const text = Object.fromEntries(bestBallRulesSummary(bb, 'NFL', 12).map((l) => [l.id, l.text]))
    expect(text.lineups).toMatch(/every week/)
    expect(text.transactions).toMatch(/^Managed Best Ball/)
    expect(text.season).toBe('Regular season weeks 1–14, then playoffs weeks 15–17.')
    expect(text.champion).toMatch(/top 6 by record/)
  })
})

describe('the wizard renders the Best Ball section', () => {
  it('Draft step: the panel is there for Best Ball and its buttons change the saved block', () => {
    const onChange = vi.fn()
    const state = bestBallState('NBA', 12)
    render(<DraftStep state={state} onChange={onChange} fieldErrors={null} />)
    expect(screen.getByTestId('g30-best-ball-panel')).toBeTruthy()
    fireEvent.click(screen.getByTestId('g30-bb-playoffs-0'))
    expect(onChange.mock.calls.at(-1)![0].bestBall).toMatchObject({ playoffTeams: 0, playoffFormat: 'none' })
    fireEvent.click(screen.getByTestId('g30-bb-period-daily'))
    expect(onChange.mock.calls.at(-1)![0].bestBall.scoringPeriod).toBe('daily')
    fireEvent.click(screen.getByTestId('g30-bb-waivers-on'))
    expect(onChange.mock.calls.at(-1)![0].bestBall.waiversEnabled).toBe(true)
    // NBA: no tournament, labelled rather than hidden.
    expect((screen.getByTestId('g30-bb-competition-tournament') as HTMLButtonElement).disabled).toBe(true)
  })

  it('NFL offers no daily scoring', () => {
    render(<DraftStep state={bestBallState('NFL', 12)} onChange={vi.fn()} fieldErrors={null} />)
    expect(screen.queryByTestId('g30-bb-period-daily')).toBeNull()
  })

  it('[control] no Best Ball section for redraft', () => {
    render(<DraftStep state={{ ...bestBallState('NFL', 12), leagueType: 'redraft' }} onChange={vi.fn()} fieldErrors={null} />)
    expect(screen.queryByTestId('g30-best-ball-panel')).toBeNull()
  })

  it('Review step: the rules summary is shown', () => {
    render(<ReviewCreateStep state={bestBallState('NFL', 12)} completionIssues={[]} submitError={null} />)
    expect(screen.getByTestId('g30-review-best-ball-rules').textContent).toContain('Set automatically every week')
  })
})
