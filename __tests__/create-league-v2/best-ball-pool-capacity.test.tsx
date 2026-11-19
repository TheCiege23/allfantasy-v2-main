/**
 * League size vs player pool for best ball (lib/bestball/poolCapacity.ts). Audit 2026-11-06, row
 * "League size vs pool / positions / calendar validation": only team-count limits were checked, so a
 * 35-team NFL Guilly league with best ball lineups was accepted with a K seat and a DEF seat although the
 * NFL has 32 of each.
 *
 * Covers the pure check (Hall's condition across flex seats), the wizard's blocking issue and note, the
 * server validator both create paths share, and the commissioner saves. Mocks only.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useLanguage: () => ({ t: (key: string) => key, language: 'en' }) }))
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => ({ hasCommissioner: false, loading: false }) }))
// eslint-disable-next-line @next/next/no-img-element
vi.mock('next/image', () => ({ default: (props: { alt: string }) => <img alt={props.alt} /> }))
vi.mock('@/components/create-league-v2/CreateLeagueVideoTile', () => ({
  CreateLeagueVideoTile: ({ testId, title }: { testId: string; title: string }) => <button data-testid={testId}>{title}</button>,
}))

import {
  BEST_BALL_POSITION_POOL,
  checkBestBallPoolCapacity,
  checkNewBestBallLeaguePool,
  newLeagueBestBallSlots,
} from '@/lib/bestball/poolCapacity'
import { checkLeagueBestBallPool } from '@/lib/bestball/leaguePoolCheck'
import { LeagueBasicsStep, nextStateForLeagueType, nextStateForSport } from '@/components/create-league-v2/CreateLeagueWizard'
import { DEFAULT_V2_STATE, SUPPORTED_SPORTS, type CreateLeagueV2State } from '@/lib/create-league-v2/state'
import { analyzeCreateLeagueCompletion } from '@/lib/create-league-v2/form-completion'
import { submitCreateLeagueV2 } from '@/lib/create-league-v2/submit'
import { validateCreatePayload } from '@/lib/league-creation/canonical/validateCreateLeague'

const NFL_K = { slot: 'K', eligible: ['K'], count: 1 }

describe('the pool check', () => {
  it('refuses a seat the pool cannot fill for every team, and names the seat', () => {
    const r = checkBestBallPoolCapacity({ sport: 'NFL', teamCount: 33, slots: [NFL_K] })
    expect(r.verified).toBe(true)
    expect(r.refusals).toHaveLength(1)
    expect(r.refusals[0]!.message).toBe(
      'A 33-team league starts 33 players in its K seat every week, but the NFL has only about 32 K players to draft. Use fewer teams or fewer of those seats.',
    )
  })

  it('exactly the pool is possible but tight: a warning, not a refusal', () => {
    const r = checkBestBallPoolCapacity({ sport: 'NFL', teamCount: 32, slots: [NFL_K] })
    expect(r.refusals).toEqual([])
    expect(r.warnings.map((w) => w.code)).toEqual(['pool_tight'])
  })

  it('a roomy pool says nothing', () => {
    expect(checkBestBallPoolCapacity({ sport: 'NFL', teamCount: 20, slots: [NFL_K] })).toEqual({ verified: true, refusals: [], warnings: [] })
  })

  it('checks seats TOGETHER: each fits alone, but two seats drawing on one position do not (Hall)', () => {
    // 17 teams: K alone 17 <= 32, a K-only flex alone 17 <= 32, both 34 > 32.
    const slots = [NFL_K, { slot: 'KFLEX', eligible: ['K'], count: 1 }]
    const r = checkBestBallPoolCapacity({ sport: 'NFL', teamCount: 17, slots })
    expect(r.refusals.map((x) => x.slots)).toEqual([['K', 'KFLEX']])
    expect(r.refusals[0]!.seats).toBe(34)
    // A flex that can also take a deep position relieves it.
    const relieved = checkBestBallPoolCapacity({ sport: 'NFL', teamCount: 17, slots: [NFL_K, { slot: 'KFLEX', eligible: ['K', 'WR'], count: 1 }] })
    expect(relieved.refusals).toEqual([])
  })

  it('a seat no position fills is reported every week, whatever the size, and never refused', () => {
    const r = checkBestBallPoolCapacity({ sport: 'SOCCER', teamCount: 4, slots: [{ slot: 'FLX', eligible: ['FLX'], count: 1 }] })
    expect(r.refusals).toEqual([])
    expect(r.warnings.map((w) => w.code)).toEqual(['seat_unfillable'])
  })

  it('a sport with no pool estimate is not verified and nothing is refused', () => {
    expect(checkBestBallPoolCapacity({ sport: 'CRICKET', teamCount: 99, slots: [NFL_K] })).toEqual({ verified: false, refusals: [], warnings: [] })
  })

  it('every sport has a pool, and every template seat position is in it (or reported unfillable)', () => {
    for (const sport of SUPPORTED_SPORTS) {
      expect(BEST_BALL_POSITION_POOL[sport], sport).toBeTruthy()
      for (const type of ['best_ball', 'guillotine']) expect(newLeagueBestBallSlots(sport, type)?.length, `${sport}/${type}`).toBeGreaterThan(0)
    }
  })

  it('NFL Guilly with best ball: 33 to 35 teams cannot fill K and DEF; 32 can, tightly', () => {
    for (const teams of [33, 34, 35]) {
      const r = checkNewBestBallLeaguePool({ sport: 'NFL', leagueType: 'guillotine', teamCount: teams })
      expect(r.refusals.map((x) => x.slots.join('+')).sort(), String(teams)).toEqual(['DEF', 'K'])
    }
    const at32 = checkNewBestBallLeaguePool({ sport: 'NFL', leagueType: 'guillotine', teamCount: 32 })
    expect(at32.refusals).toEqual([])
    expect(at32.warnings.map((w) => w.slots.join('+')).sort()).toEqual(['DEF', 'K'])
  })

  it('no Classic Best Ball size the wizard offers (4–16) is refused in any sport', () => {
    for (const sport of SUPPORTED_SPORTS) {
      for (const teams of [4, 8, 12, 16]) {
        expect(checkNewBestBallLeaguePool({ sport, leagueType: 'best_ball', teamCount: teams }).refusals, `${sport}/${teams}`).toEqual([])
      }
    }
  })
})

function guillyState(teamCount: number, bestBall: boolean): CreateLeagueV2State {
  const base: CreateLeagueV2State = {
    ...DEFAULT_V2_STATE,
    name: 'Pool Check League',
    nameTouched: true,
    draftDate: '2026-10-19',
    draftTime: '20:00',
    timezone: 'America/New_York',
  }
  const nfl = { ...base, ...nextStateForSport(base, 'NFL') }
  return { ...nfl, ...nextStateForLeagueType(nfl, 'guillotine'), teamCount, guillotineBestBall: bestBall }
}

describe('creation refuses it, in the wizard and on the server', () => {
  let bodies: Record<string, unknown>[] = []
  beforeEach(() => {
    bodies = []
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-18T12:00:00Z') })
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
      return { ok: true, json: async () => ({ success: true, league: { id: 'l1' }, homepageUrl: '/league/l1' }) } as Response
    }))
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('a 35-team NFL Guilly league with best ball lineups: the wizard blocks it and the server refuses it', async () => {
    const state = guillyState(35, true)
    const issues = analyzeCreateLeagueCompletion(state)
    expect(issues.map((i) => i.code)).toEqual(['best_ball_pool', 'best_ball_pool'])
    expect(issues[0]!.message).toContain('K seat')

    // The server is the last word: the same body, sent past the wizard, is refused.
    await submitCreateLeagueV2(state)
    const validated = validateCreatePayload(bodies.at(-1)!)
    expect(validated.ok).toBe(false)
    if (validated.ok) return
    expect(validated.status).toBe(400)
    expect(validated.errors?.map((e) => e.code)).toEqual(['BEST_BALL_POOL_EXHAUSTED', 'BEST_BALL_POOL_EXHAUSTED'])
  })

  it('the same league with lineups set by managers is untouched (this check is best ball only)', async () => {
    const state = guillyState(35, false)
    expect(analyzeCreateLeagueCompletion(state).map((i) => i.code)).not.toContain('best_ball_pool')
    await submitCreateLeagueV2(state)
    expect(validateCreatePayload(bodies.at(-1)!).ok).toBe(true)
  })

  it('32 teams creates, and the wizard shows the tight-pool warning instead', async () => {
    const state = guillyState(32, true)
    expect(analyzeCreateLeagueCompletion(state)).toEqual([])
    await submitCreateLeagueV2(state)
    expect(validateCreatePayload(bodies.at(-1)!).ok).toBe(true)

    render(<LeagueBasicsStep state={state} onChange={vi.fn()} fieldErrors={null} />)
    expect(screen.getByTestId('g30-best-ball-pool-warning').textContent).toContain('32 of the about 32 K players')
    expect(screen.queryByTestId('g30-best-ball-pool-refused')).toBeNull()
  })

  it('the basics step shows the refusal in plain words', () => {
    render(<LeagueBasicsStep state={guillyState(35, true)} onChange={vi.fn()} fieldErrors={null} />)
    const note = screen.getByTestId('g30-best-ball-pool-refused')
    expect(note.getAttribute('role')).toBe('alert')
    expect(note.textContent).toContain('but the NFL has only about 32 K players to draft')
    expect(note.textContent).toContain('DEF seat')
  })

  it('the legacy create body (Guilly setup -> /api/league/create) is refused by the same validator', async () => {
    const { buildLegacyManualCanonicalCreatePayload } = await import('@/lib/league-creation/canonical/legacyManualToCanonicalCreateBody')
    const { stripForbiddenCreateLeagueFields } = await import('@/lib/league-creation/canonical/validateCreateLeague')
    const legacy = (teamCount: number, rosterMode: string) =>
      stripForbiddenCreateLeagueFields(
        buildLegacyManualCanonicalCreatePayload({
          sport: 'NFL',
          leagueName: 'Legacy Guilly',
          teamCount,
          requestedLeagueType: 'guillotine',
          requestedDraftType: 'snake',
          scoringPresetIdInput: undefined,
          soccerPipelineInput: undefined,
          settingsWizard: { roster_mode: rosterMode },
          isIdpRequested: false,
          legacyScoringLabel: 'PPR',
          preferDynastyConcept: false,
        }),
      ).body
    const refused = validateCreatePayload(legacy(35, 'best_ball'))
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.errors?.[0]?.code).toBe('BEST_BALL_POOL_EXHAUSTED')
    // Positive control: the same legacy body with managed lineups passes, so the refusal is the pool check.
    const validated = validateCreatePayload(legacy(35, 'redraft'))
    expect(validated.ok).toBe(true)
  })
})

describe('commissioner saves', () => {
  const nflGuillyBestBall = (slots: Record<string, number>) => ({
    sport: 'NFL',
    settings: { best_ball: true, roster: { config: { sections: [{ slots }] } } },
    leagueType: 'guillotine',
    guillotineMode: true,
  })

  it('a best ball league adding a second DEF seat at 20 teams is refused (40 > 32)', () => {
    const league = nflGuillyBestBall({ QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, DEF: 1, BN: 4 })
    const r = checkLeagueBestBallPool(league, { teamCount: 20, rosterSlots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, DEF: 2, BN: 4 } })
    expect(r?.refusals.map((x) => x.slots)).toEqual([['DEF']])
    expect(checkLeagueBestBallPool(league, { teamCount: 20 })?.refusals).toEqual([])
  })

  it('a lineup league is never checked, unless the save is switching best ball on', () => {
    const lineupLeague = { ...nflGuillyBestBall({ K: 1, BN: 4 }), settings: { roster: { config: { sections: [{ slots: { K: 1, BN: 4 } }] } } } }
    expect(checkLeagueBestBallPool(lineupLeague, { teamCount: 35 })).toBeNull()
    expect(checkLeagueBestBallPool(lineupLeague, { teamCount: 35, assumeBestBall: true })?.refusals).toHaveLength(1)
  })
})
