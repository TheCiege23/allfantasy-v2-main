/**
 * Guilly + Best Ball, from both creation paths, saves ONE shape: `settings.best_ball === true` on a
 * guillotine league (lib/guillotine/guillotineBestBall.ts) — never `bestBallMode`, which would turn it
 * into a Best Ball league everywhere.
 *
 *  - the main wizard sends `conceptSetup.guillotineBestBall` to POST /api/leagues;
 *  - the NBA Guilly setup screen (lib/guilly/setup.ts) posts `roster_mode: 'best_ball'` to the legacy
 *    POST /api/league/create, whose manual branch translates through
 *    `buildLegacyManualCanonicalCreatePayload`.
 *
 * Before: GuillySetup refused best ball and double-chop weeks with stale reasons, and the legacy
 * translation dropped `roster_mode: 'best_ball'`, so that path made a managed-lineup league.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ prisma: { league: { findUnique: vi.fn(), create: vi.fn() } } }))
vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))

import {
  GUILLY_DEFAULTS, buildGuillyCreateBody, buildGuillyFollowUps, isGuillyOptionSupported, summarizeGuilly, validateGuillySetup,
} from '@/lib/guilly/setup'
import { buildLegacyManualCanonicalCreatePayload } from '@/lib/league-creation/canonical/legacyManualToCanonicalCreateBody'
import { validateCreatePayload } from '@/lib/league-creation/canonical/validateCreateLeague'
import { createCanonicalLeagueInTransaction } from '@/lib/league-creation/canonical/createCanonicalLeagueInTransaction'
import { runPresetEngine } from '@/lib/league-creation/preset-engine/runPresetEngine'
import { submitCreateLeagueV2 } from '@/lib/create-league-v2/submit'
import { DEFAULT_V2_STATE, type CreateLeagueV2State } from '@/lib/create-league-v2/state'
import { normalizeAdvanced } from '@/lib/guillotine/chopSchedule'

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

/** Validate and create a canonical body exactly as POST /api/leagues does; returns League.create data. */
async function createFromCanonicalBody(raw: unknown): Promise<Obj> {
  const validated = validateCreatePayload(raw)
  if (!validated.ok) throw new Error(`refused: ${validated.error}`)
  const tx = buildTx()
  await createCanonicalLeagueInTransaction(tx as any, 'u1', validated.data as any, runPresetEngine({ ...(validated.data as any), commissionerId: 'u1' }))
  return tx.league.create.mock.calls[0][0].data as Obj
}

/** The legacy route's manual branch, from the body GuillySetup posts. */
function legacyCanonicalBodyFrom(body: ReturnType<typeof buildGuillyCreateBody>) {
  return buildLegacyManualCanonicalCreatePayload({
    sport: body.sport,
    leagueName: body.name,
    teamCount: body.leagueSize,
    requestedLeagueType: body.leagueType,
    requestedDraftType: body.draftType,
    scoringPresetIdInput: undefined,
    soccerPipelineInput: undefined,
    settingsWizard: body.settings,
    isIdpRequested: false,
  })
}

const named = { ...GUILLY_DEFAULTS, name: 'Chop Night', draft: 'snake' as const, leagueSize: 14 as const }

afterEach(() => vi.unstubAllGlobals())

describe('GuillySetup: best ball and double chops are offered', () => {
  it('accepts best ball lineups and double-chop weeks', () => {
    expect(isGuillyOptionSupported('bestball')).toBe(true)
    expect(isGuillyOptionSupported('doubleChop')).toBe(true)
    expect(validateGuillySetup({ ...named, lineups: 'bestball' })).toEqual([])
    expect(validateGuillySetup({ ...named, doubleChop: true })).toEqual([])
  })

  it('posts roster_mode best_ball for best ball lineups (and redraft otherwise)', () => {
    expect(buildGuillyCreateBody({ ...named, lineups: 'bestball' }).settings).toEqual({ teamCount: 14, roster_mode: 'best_ball' })
    expect(buildGuillyCreateBody(named).settings).toEqual({ teamCount: 14, roster_mode: 'redraft' })
  })

  it('a double-chop week is saved after the first chop week, as a schedule the engine accepts', () => {
    const steps = buildGuillyFollowUps('L1', { ...named, firstChopWeek: 2, doubleChop: true })
    expect(steps.map((s) => s.label)).toEqual(['First chop week', 'Double-chop week (AF Commissioner)', 'Season FAAB'])
    const advanced = (steps[1].body as Obj).advanced
    expect(normalizeAdvanced(advanced)).toEqual({ ok: true, value: { steps: [], overrides: { 2: 2 }, immunity: 'off' } })
  })

  it('a double-chop week ends the blade a week sooner', () => {
    expect(summarizeGuilly({ leagueSize: 18, firstChopWeek: 1, doubleChop: true })).toMatchObject({ chops: 17, lastChopWeek: 16 })
    expect(summarizeGuilly({ leagueSize: 18, firstChopWeek: 1 })).toMatchObject({ chops: 17, lastChopWeek: 17 })
  })
})

describe('both creation paths save the same Guilly best ball league', () => {
  it('legacy /api/league/create carries roster_mode best_ball through to settings.best_ball', async () => {
    const canonical = legacyCanonicalBodyFrom(buildGuillyCreateBody({ ...named, lineups: 'bestball' }))
    expect((canonical.conceptSetup as Obj | undefined)?.guillotineBestBall).toBe(true)
    const data = await createFromCanonicalBody(canonical)
    expect(data.leagueType).toBe('guillotine')
    expect(data.settings.best_ball).toBe(true)
    expect(data.bestBallMode).not.toBe(true)
  })

  it('[control] managed lineups stay managed on the legacy path', async () => {
    const data = await createFromCanonicalBody(legacyCanonicalBodyFrom(buildGuillyCreateBody(named)))
    expect(data.settings.best_ball).toBeUndefined()
  })

  it('the main wizard and the Guilly screen agree on every best ball field', async () => {
    let wizardBody: Obj | null = null
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
      wizardBody = JSON.parse(init.body)
      return new Response(JSON.stringify({ ok: true, league: { id: 'x' } }), { status: 200 })
    }))
    const state: CreateLeagueV2State = {
      ...DEFAULT_V2_STATE, sport: 'NBA', leagueType: 'guillotine', leagueTypeTouched: true, teamCount: 14,
      draftType: 'snake', scoringPresetId: 'nba_points', name: 'Chop Night', guillotineBestBall: true,
    }
    await submitCreateLeagueV2(state)
    expect(wizardBody).not.toBeNull()
    const fromWizard = await createFromCanonicalBody(wizardBody)
    const fromGuilly = await createFromCanonicalBody(legacyCanonicalBodyFrom(buildGuillyCreateBody({ ...named, lineups: 'bestball' })))
    const shape = (d: Obj) => ({ leagueType: d.leagueType, bestBallMode: d.bestBallMode ?? null, best_ball: d.settings.best_ball, roster_mode: d.settings.roster_mode ?? null })
    expect(shape(fromGuilly)).toEqual(shape(fromWizard))
    expect(shape(fromWizard).best_ball).toBe(true)
  })
})
