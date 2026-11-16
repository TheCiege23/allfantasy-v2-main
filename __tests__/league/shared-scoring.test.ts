// @vitest-environment node
/**
 * Shared scoring (lib/league/applySportScoring.ts + lib/league/sharedScoring.ts, 2026-11-16): one league's scoring
 * applied to a commissioner's other leagues, each league saved through the same save its own scoring tab uses — so
 * its commissioner check, lock, format guard, season-phase rule, premium gate and league log all hold.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

type Row = {
  id: string
  name: string
  sport: string
  platform: string
  leagueVariant: string | null
  leagueType: string | null
  settings: Record<string, unknown>
  userId: string
  lifecycleState: string
}

const h = vi.hoisted(() => ({
  leagues: new Map<string, Row>(),
  flaggedTeams: [] as Array<{ leagueId: string }>,
  commissionerOf: new Set<string>(),
  locked: new Set<string>(),
  scoring: new Map<string, { presetKey: string; rules: Record<string, number>; matchesPreset: boolean }>(),
  premium: true,
  saves: [] as Array<{ leagueId: string; presetKey: string; rules: Record<string, number> }>,
  logs: [] as Array<Record<string, unknown>>,
  evaluate: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => h.leagues.get(where.id) ?? null),
      findMany: vi.fn(async ({ where }: { where: { userId?: string; id?: { in: string[] }; sport?: string } }) =>
        [...h.leagues.values()].filter(
          (l) =>
            (where.userId === undefined || l.userId === where.userId) &&
            (where.id === undefined || where.id.in.includes(l.id)) &&
            (where.sport === undefined || l.sport === where.sport),
        ),
      ),
    },
    leagueTeam: { findMany: vi.fn(async () => h.flaggedTeams) },
  },
}))
vi.mock('@/lib/commissioner/leagueCommissionerAccount', () => ({
  isOwnerOrLeagueCommissioner: vi.fn(async (league: { userId: string }, leagueId: string, userId: string) =>
    league.userId === userId || h.commissionerOf.has(leagueId),
  ),
}))
vi.mock('@/lib/league/settingsLockGuard', () => ({
  settingsLockedResponse: vi.fn(async (leagueId: string) =>
    h.locked.has(leagueId) ? NextResponse.json({ error: 'Scoring settings are locked for the season', code: 'settings_locked' }, { status: 423 }) : null,
  ),
}))
vi.mock('@/lib/league/settingsLockService', () => ({
  lockedGroups: vi.fn(async (leagueId: string) => (h.locked.has(leagueId) ? ['scoring'] : [])),
}))
vi.mock('@/lib/league/settingsLifecycleGate', () => ({
  SETTINGS_EDIT_POLICY: { pre_draft: 'allowed', drafting: 'refused', in_season: 'confirm', offseason: 'allowed' },
  decideSettingsEdit: vi.fn(async (leagueId: string, _u: string, _s: string, body: Record<string, unknown>) => {
    const state = h.leagues.get(leagueId)!.lifecycleState
    if (state === 'drafting') return { ok: false, status: 409, body: { error: 'Scoring cannot change during the draft.', code: 'LIFECYCLE_BLOCKED' } }
    if (state === 'in_season' && body?.confirmMidSeasonChange !== true) {
      return { ok: false, status: 409, body: { error: 'confirm', message: 'confirm', code: 'mid_season_confirmation_required' } }
    }
    return { ok: true, state, midSeason: state === 'in_season' }
  }),
  recordMidSeasonSettingsChange: vi.fn(async (_d: unknown, args: Record<string, unknown>) => {
    h.logs.push(args)
  }),
}))
vi.mock('@/server/services/leagueLifecycleService', () => ({
  getLeagueLifecycleState: (l: { lifecycleState: string }) => l.lifecycleState,
}))
vi.mock('@/lib/subscription/FeatureGateService', () => ({
  FeatureGateService: class {
    evaluateUserFeatureAccess = h.evaluate
  },
}))
vi.mock('@/lib/nfl-scoring', () => ({
  buildFullNflScoringConfig: (k: string) => ({ rec: k === 'af_ppr' ? 1 : 0.5, pass_td: 4 }),
  getLeagueNflScoringConfig: vi.fn(async (id: string) => h.scoring.get(id) ?? { presetKey: 'af_default', rules: { rec: 0.5, pass_td: 4 }, matchesPreset: true }),
  saveLeagueNflScoringConfig: vi.fn(async (leagueId: string, c: { presetKey: string; rules: Record<string, number> }) => {
    h.saves.push({ leagueId, presetKey: c.presetKey, rules: c.rules })
    h.scoring.set(leagueId, { presetKey: c.presetKey, rules: c.rules, matchesPreset: c.presetKey !== 'custom' })
  }),
}))
vi.mock('@/lib/nba-scoring', () => ({
  buildFullScoringConfig: () => ({ pts: 1 }),
  getLeagueNbaScoringConfig: vi.fn(async () => ({ presetKey: 'af_default', rules: { pts: 1 }, matchesPreset: true })),
  saveLeagueNbaScoringConfig: vi.fn(async (leagueId: string, c: { presetKey: string; rules: Record<string, number> }) => {
    h.saves.push({ leagueId, presetKey: c.presetKey, rules: c.rules })
  }),
}))
vi.mock('@/lib/category-scoring/nativeCategoryScoringContext', () => ({
  nativeCategoryScoringContext: (settings: Record<string, unknown> | null) => (settings?.scoring_mode === 'categories' ? { mode: 'categories' } : null),
}))

import { applySportScoringToLeague } from '@/lib/league/applySportScoring'
import { applySharedScoring, getSharedScoringView, sharedScoringIncompatibility } from '@/lib/league/sharedScoring'

const league = (id: string, over: Partial<Row> = {}): Row => ({
  id,
  name: `League ${id}`,
  sport: 'NFL',
  platform: 'allfantasy',
  leagueVariant: null,
  leagueType: 'redraft',
  settings: {},
  userId: 'comm',
  lifecycleState: 'pre_draft',
  ...over,
})
const put = (...rows: Row[]) => rows.forEach((r) => h.leagues.set(r.id, r))

beforeEach(() => {
  h.leagues.clear()
  h.flaggedTeams = []
  h.commissionerOf.clear()
  h.locked.clear()
  h.scoring.clear()
  h.saves = []
  h.logs = []
  h.evaluate.mockReset()
  h.evaluate.mockImplementation(async () => ({ allowed: h.premium }))
  h.premium = true
})

describe('which leagues keep their own scoring', () => {
  it('imported, tournament, survivor guillotine, devy, category and carried-over leagues are not shared into', () => {
    expect(sharedScoringIncompatibility(league('a'))).toBeNull()
    expect(sharedScoringIncompatibility(league('a', { platform: 'sleeper' }))).toBe('imported')
    expect(sharedScoringIncompatibility(league('a', { leagueVariant: 'season_tournament' }))).toBe('tournament')
    expect(sharedScoringIncompatibility(league('a', { leagueVariant: 'survivor_guillotine' }))).toBe('survivor_guillotine')
    expect(sharedScoringIncompatibility(league('a', { leagueVariant: 'devy_dynasty' }))).toBe('devy')
    expect(sharedScoringIncompatibility(league('a', { leagueType: 'c2c' }))).toBe('devy')
    expect(sharedScoringIncompatibility(league('a', { settings: { scoring_mode: 'categories' } }))).toBe('category')
    expect(sharedScoringIncompatibility(league('a', { settings: { sportConfig: { categoryPoints: { rec: 1 } } } }))).toBe('carried_over')
    // MLB writes categoryPoints from its own scoring save, so it is not a carried-over table there.
    expect(sharedScoringIncompatibility(league('a', { sport: 'MLB', settings: { sportConfig: { categoryPoints: { hr: 4 } } } }))).toBeNull()
  })
})

describe('the one scoring save every route uses', () => {
  const save = (over: Partial<Parameters<typeof applySportScoringToLeague>[0]> = {}) =>
    applySportScoringToLeague({ leagueId: 'L1', userId: 'comm', sport: 'NFL', source: 'nfl-scoring', ...over })

  it('saves the preset table and records it in the league log', async () => {
    put(league('L1'))
    const res = await save({ presetKey: 'af_ppr' })
    expect(res).toEqual({ ok: true, outcome: 'saved', midSeason: false })
    expect(h.saves).toEqual([{ leagueId: 'L1', presetKey: 'af_ppr', rules: { rec: 1, pass_td: 4 } }])
    expect(h.logs[0]).toMatchObject({ alwaysLog: true, leagueId: 'L1', section: 'scoring', source: 'nfl-scoring', detail: { presetKey: 'af_ppr' } })
    // A preset without a table is not the premium feature, so nothing asked.
    expect(h.evaluate).not.toHaveBeenCalled()
  })

  it('refuses, and saves nothing, for each rule a league holds', async () => {
    put(league('L1', { userId: 'someone-else' }))
    expect(await save()).toMatchObject({ ok: false, outcome: 'forbidden', status: 403 })
    put(league('L1'))
    h.locked.add('L1')
    expect(await save()).toMatchObject({ ok: false, outcome: 'locked', status: 423, body: { code: 'settings_locked' } })
    h.locked.clear()
    expect(await save({ sport: 'NBA' })).toMatchObject({ ok: false, outcome: 'wrong_sport', status: 400 })
    put(league('L1', { lifecycleState: 'in_season' }))
    expect(await save()).toMatchObject({ ok: false, outcome: 'needs_confirmation', status: 409 })
    put(league('L1', { lifecycleState: 'drafting' }))
    expect(await save()).toMatchObject({ ok: false, outcome: 'refused', status: 409 })
    put(league('L1'))
    h.premium = false
    expect(await save({ presetKey: 'custom', rules: { rec: 2 } })).toMatchObject({ ok: false, outcome: 'premium_required', status: 403 })
    expect(h.saves).toEqual([])
  })

  it('an NBA category league refuses a points table', async () => {
    put(league('N1', { sport: 'NBA', settings: { scoring_mode: 'categories' } }))
    expect(await applySportScoringToLeague({ leagueId: 'N1', userId: 'comm', sport: 'NBA', source: 'nba-scoring' })).toMatchObject({
      ok: false,
      outcome: 'incompatible',
      status: 409,
    })
    expect(h.saves).toEqual([])
  })

  it('a confirmed in-season change saves and says so', async () => {
    put(league('L1', { lifecycleState: 'in_season' }))
    expect(await save({ confirmationBody: { confirmMidSeasonChange: true } })).toEqual({ ok: true, outcome: 'saved', midSeason: true })
  })
})

describe('sharing one league\'s scoring with the others', () => {
  beforeEach(() => {
    put(
      league('SRC', { name: 'Main league' }),
      league('A', { name: 'Alpha' }),
      league('B', { name: 'Bravo', lifecycleState: 'in_season' }),
      league('C', { name: 'Charlie', platform: 'sleeper' }),
      league('D', { name: 'Delta' }),
      league('X', { name: 'Not mine', userId: 'other' }),
    )
    h.locked.add('D')
    h.scoring.set('SRC', { presetKey: 'custom', rules: { rec: 1, pass_td: 6 }, matchesPreset: false })
  })

  it('lists the commissioner\'s other leagues of the sport, each with whether it can take the change', async () => {
    h.flaggedTeams = [{ leagueId: 'X' }]
    const view = await getSharedScoringView('comm', 'SRC')
    expect(view.ok).toBe(true)
    if (!view.ok) return
    expect(view.source).toMatchObject({ id: 'SRC', presetKey: 'custom', customTable: true, needsPremium: true })
    expect(view.leagues.map((l) => [l.id, l.status, l.incompatibility])).toEqual([
      ['A', 'ready', null],
      ['B', 'mid_season', null],
      ['D', 'locked', null],
      ['C', 'incompatible', 'imported'],
    ])
    // A league where the user's team carries a flag the commissioner check does not accept is not listed.
    expect(view.leagues.some((l) => l.id === 'X')).toBe(false)
  })

  it('a league already on this scoring says so', async () => {
    h.scoring.set('A', { presetKey: 'custom', rules: { rec: 1, pass_td: 6 }, matchesPreset: false })
    const view = await getSharedScoringView('comm', 'SRC')
    expect(view.ok && view.leagues.find((l) => l.id === 'A')?.status).toBe('matches')
  })

  it('saves the full custom table to each league through its own rules, asking about premium once', async () => {
    const out = await applySharedScoring({ userId: 'comm', sourceLeagueId: 'SRC', leagueIds: ['A', 'B', 'C', 'D', 'X', 'SRC'] })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.results.map((r) => [r.leagueId, r.outcome])).toEqual([
      ['A', 'saved'],
      ['B', 'needs_confirmation'],
      ['C', 'incompatible'],
      ['D', 'locked'],
      ['X', 'forbidden'],
    ])
    expect(out.saved).toBe(1)
    expect(h.saves).toEqual([{ leagueId: 'A', presetKey: 'custom', rules: { rec: 1, pass_td: 6 } }])
    expect(h.evaluate).toHaveBeenCalledTimes(1)
    // The league log names the source league by id only: this league's members are not that league's.
    expect(h.logs[0]).toMatchObject({ leagueId: 'A', source: 'shared-scoring', detail: { presetKey: 'custom', sharedFromLeagueId: 'SRC' } })
    expect(JSON.stringify(h.logs[0])).not.toContain('Main league')
  })

  it('an in-season league changes only once the commissioner confirms', async () => {
    const out = await applySharedScoring({ userId: 'comm', sourceLeagueId: 'SRC', leagueIds: ['B'], confirmMidSeasonChange: true })
    expect(out.ok && out.results).toEqual([{ leagueId: 'B', name: 'Bravo', outcome: 'saved', message: null }])
  })

  it('a custom table without AF Commissioner is refused before any league is touched', async () => {
    h.premium = false
    const out = await applySharedScoring({ userId: 'comm', sourceLeagueId: 'SRC', leagueIds: ['A'] })
    expect(out).toMatchObject({ ok: false, status: 403, code: 'premiumRequired' })
    expect(h.saves).toEqual([])
  })

  it('a plain preset travels as the preset, with no premium question', async () => {
    h.scoring.set('SRC', { presetKey: 'af_ppr', rules: { rec: 1, pass_td: 4 }, matchesPreset: true })
    const out = await applySharedScoring({ userId: 'comm', sourceLeagueId: 'SRC', leagueIds: ['A'] })
    expect(out.ok && out.saved).toBe(1)
    expect(h.saves).toEqual([{ leagueId: 'A', presetKey: 'af_ppr', rules: { rec: 1, pass_td: 4 } }])
    expect(h.evaluate).not.toHaveBeenCalled()
  })

  it('only the source league\'s commissioner can share it', async () => {
    expect(await applySharedScoring({ userId: 'stranger', sourceLeagueId: 'SRC', leagueIds: ['A'] })).toMatchObject({ ok: false, status: 403 })
    expect(await getSharedScoringView('stranger', 'SRC')).toMatchObject({ ok: false, status: 403 })
    expect(h.saves).toEqual([])
  })
})
