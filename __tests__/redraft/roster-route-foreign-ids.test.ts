/**
 * 🛑 `/api/redraft/roster` keyed weekly scores, provider projections, the AF snapshot and the canonical
 * NFL context on the RAW roster id. An imported ESPN / Fleaflicker roster holds that platform's ids, and
 * the same digits are a different man in Sleeper's space: ESPN 12483 (Matthew Stafford) read Jack Bech's
 * 4.4-pt projection; Fleaflicker 12892 (Christian McCaffrey) is Sleeper's Da'Quan Felton.
 *
 * The prisma fake EVALUATES the `where` it is given, so a query asked with the raw roster id gets the
 * stranger's row back — exactly as production did.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockNextRequest } from '../helpers/createMockNextRequest'

type Row = Record<string, unknown>

const h = vi.hoisted(() => ({
  platform: 'espn' as string,
  rosterPlayers: [] as Row[],
  identity: [] as Row[],
  weeklyScores: [] as Row[],
  projections: [] as Row[],
  afSnapshots: [] as Row[],
  canonicalById: {} as Record<string, Row>,
  unified: [] as Row[],
}))

const fake = vi.hoisted(() => {
  type R = Record<string, unknown>
  /** Minimal Prisma `where` evaluator: equality, `{ in }`, `{ not }`, and `OR` / `AND`. */
  function matches(row: R, where: R | undefined): boolean {
    if (!where) return true
    return Object.entries(where).every(([key, cond]) => {
      if (key === 'OR') return (cond as R[]).some((w) => matches(row, w))
      if (key === 'AND') return (cond as R[]).every((w) => matches(row, w))
      const value = row[key]
      if (cond && typeof cond === 'object' && !Array.isArray(cond) && !(cond instanceof Date)) {
        const c = cond as R
        if ('in' in c && !(c.in as unknown[]).includes(value)) return false
        if ('not' in c && value === c.not) return false
        return true
      }
      return value === cond
    })
  }
  return {
    findManyOver: (rows: () => R[]) => async (args: { where?: R } = {}) => rows().filter((r) => matches(r, args.where)),
  }
})

const projectionSpy = vi.hoisted(() => vi.fn())
const canonicalSpy = vi.hoisted(() => vi.fn())

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'user-1' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    redraftRoster: {
      findFirst: vi.fn(async () => ({
        id: 'r1',
        leagueId: 'L',
        ownerId: 'user-1',
        players: h.rosterPlayers.map((p) => ({ ...p })),
        season: { season: 2026, sport: 'NFL', currentWeek: 6, totalWeeks: 17 },
      })),
    },
    league: { findUnique: vi.fn(async () => ({ settings: {}, platform: h.platform })) },
    playerIdentityMap: { findMany: fake.findManyOver(() => h.identity) },
    playerWeeklyScore: { findMany: fake.findManyOver(() => h.weeklyScores) },
    fantasyProjection: { findMany: fake.findManyOver(() => h.projections) },
    aFProjectionSnapshot: { findMany: fake.findManyOver(() => h.afSnapshots) },
    playerSeasonStats: { findMany: vi.fn(async () => []) },
    allFantasyAdpSnapshot: { findMany: vi.fn(async () => []) },
    sportsInjury: { findMany: vi.fn(async () => []) },
  },
}))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMember: vi.fn().mockResolvedValue({ ok: true, status: 200 }) }))
vi.mock('@/lib/redraft/projectionEngine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/redraft/projectionEngine')>()
  return {
    ...actual,
    buildAllFantasyProjection: (input: Parameters<typeof actual.buildAllFantasyProjection>[0]) => {
      projectionSpy(input)
      return actual.buildAllFantasyProjection(input)
    },
  }
})
vi.mock('@/lib/redraft/scoringEngine', () => ({ calculateScoreFromSportConfig: vi.fn(async () => 21.5) }))
vi.mock('@/lib/redraft/lineupValidation', () => ({
  applyRedraftLineupMoves: vi.fn(),
  validateRedraftLineup: vi.fn(() => ({ ok: true, issues: [], errorCount: 0, warningCount: 0 })),
}))
vi.mock('@/lib/redraft/lineupLock', () => ({
  hydrateRedraftLineupLocks: vi.fn(async (_db: unknown, args: { players: unknown[] }) => ({ players: args.players, warnings: [] })),
}))
vi.mock('@/lib/redraft/rosterConfigResolver', () => ({ resolveRedraftRosterConfig: vi.fn(() => null) }))
vi.mock('@/lib/nfl-data-foundation', () => ({
  getCanonicalNflPlayerContext: vi.fn(async (id: string) => {
    canonicalSpy(id)
    return h.canonicalById[id] ?? null
  }),
  getCanonicalNflPlayerByNameTeam: vi.fn(async () => null),
}))
vi.mock('@/lib/player-data/getNormalizedPlayerData', () => ({ getNormalizedPlayerData: vi.fn(async () => h.unified) }))
vi.mock('@/lib/player-data/serializeUnifiedPlayerForApi', () => ({ serializeUnifiedPlayerForApi: vi.fn((r: unknown) => r) }))
vi.mock('@/lib/players/getTeamLogo', () => ({ getTeamLogo: vi.fn(() => null) }))
vi.mock('@/lib/redraft/redraftRosterIdentity', () => ({
  resolveRedraftRosterLookup: vi.fn(async () => ({ season: { id: 's1', leagueId: 'L' }, roster: { id: 'r1', ownerId: 'user-1' } })),
}))
vi.mock('@/lib/redraft/rosterMoveHistory', () => ({ recordRedraftRosterMoveHistory: vi.fn() }))

import { GET } from '@/app/api/redraft/roster/route'

const rp = (playerId: string, playerName: string, position = 'QB', team = 'LAR') => ({
  playerId,
  playerName,
  position,
  team,
  sport: 'NFL',
  slotType: position,
  isLocked: false,
  injuryStatus: null,
  byeWeek: null,
})

/** One full set of Sleeper-keyed rows for `sleeperId`, every one of them carrying `points`. */
function sleeperRowsFor(sleeperId: string, points: number, name: string) {
  h.weeklyScores.push({ playerId: sleeperId, sport: 'NFL', season: 2026, week: 6, stats: { name }, fantasyPts: points, isFinalized: false })
  h.projections.push({ playerId: sleeperId, sport: 'NFL', season: '2026', week: 6, source: 'sleeper', projectedPoints: points, stats: {}, fetchedAt: new Date('2026-10-10T00:00:00Z') })
  h.afSnapshots.push({ playerId: sleeperId, sport: 'NFL', season: 2026, week: 6, afProjection: points + 1, confidenceLevel: 'high', computedAt: new Date('2026-10-10T00:00:00Z') })
  h.canonicalById[sleeperId] = {
    playerId: sleeperId,
    providerIds: {},
    projection: null,
    injuryStatus: `${name} injury`,
    byeWeek: 6,
    depthChartRole: `${name} depth`,
    dataSources: [],
    staleDataWarnings: [],
  }
}

type Out = {
  playerId: string
  weeklyScore: { playerId: string; stats: unknown } | null
  canonicalNfl?: { playerId: string; injuryStatus: string | null; depthChartRole: string | null }
  injuryStatus: string | null
}
type EngineInput = { playerId: string; providerWeeklyProjection: number | null; allFantasyWeeklyProjection: number | null; injuryStatus: string | null; byeWeek: number | null }

async function read() {
  const res = await GET(createMockNextRequest('http://localhost/api/redraft/roster?rosterId=r1&week=6'))
  expect(res.status).toBe(200)
  const body = (await res.json()) as { roster: { players: Out[] } }
  const inputs = Object.fromEntries(projectionSpy.mock.calls.map(([i]) => [(i as EngineInput).playerId, i as EngineInput]))
  const out = Object.fromEntries(body.roster.players.map((p) => [p.playerId, p]))
  return { inputs, out }
}

beforeEach(() => {
  projectionSpy.mockClear()
  canonicalSpy.mockClear()
  h.platform = 'espn'
  h.rosterPlayers = []
  h.identity = []
  h.weeklyScores = []
  h.projections = []
  h.afSnapshots = []
  h.canonicalById = {}
  h.unified = []
})

describe('/api/redraft/roster — a foreign roster id is never read as a Sleeper id', () => {
  it('🛑 ESPN 12483 (Matthew Stafford), unmapped: NOTHING from Sleeper 12483 (Jack Bech)', async () => {
    h.rosterPlayers = [rp('12483', 'Matthew Stafford')]
    sleeperRowsFor('12483', 4.4, 'Jack Bech')

    const { inputs, out } = await read()
    expect(inputs['12483']!.providerWeeklyProjection).toBeNull()
    expect(inputs['12483']!.allFantasyWeeklyProjection).toBeNull()
    expect(inputs['12483']!.injuryStatus).toBeNull()
    expect(out['12483']!.weeklyScore).toBeNull()
    expect(out['12483']!.canonicalNfl).toBeUndefined()
    expect(canonicalSpy).not.toHaveBeenCalledWith('12483')
  })

  it('ESPN 12483 mapped through the crosswalk gets STAFFORD\'s rows, keyed back on the roster id', async () => {
    h.rosterPlayers = [rp('12483', 'Matthew Stafford')]
    h.identity = [{ sport: 'NFL', espnId: '12483', sleeperId: '4881', canonicalName: 'Matthew Stafford' }]
    sleeperRowsFor('12483', 4.4, 'Jack Bech')
    sleeperRowsFor('4881', 17.2, 'Matthew Stafford')

    const { inputs, out } = await read()
    expect(inputs['12483']!.providerWeeklyProjection).toBe(17.2)
    expect(inputs['12483']!.allFantasyWeeklyProjection).toBe(18.2)
    expect(inputs['12483']!.injuryStatus).toBe('Matthew Stafford injury')
    expect(out['12483']!.weeklyScore?.stats).toEqual({ name: 'Matthew Stafford' })
    expect(out['12483']!.weeklyScore?.playerId).toBe('12483')
    expect(out['12483']!.canonicalNfl?.depthChartRole).toBe('Matthew Stafford depth')
    expect(canonicalSpy).toHaveBeenCalledWith('4881')
    expect(canonicalSpy).not.toHaveBeenCalledWith('12483')
  })

  it('🛑 Fleaflicker 12892 (Christian McCaffrey), unmapped: nothing from Sleeper 12892 (Da\'Quan Felton)', async () => {
    h.platform = 'fleaflicker'
    h.rosterPlayers = [rp('12892', 'Christian McCaffrey', 'RB', 'SF')]
    sleeperRowsFor('12892', 3.1, "Da'Quan Felton")

    const { inputs, out } = await read()
    expect(inputs['12892']!.providerWeeklyProjection).toBeNull()
    expect(inputs['12892']!.allFantasyWeeklyProjection).toBeNull()
    expect(out['12892']!.weeklyScore).toBeNull()
    expect(out['12892']!.canonicalNfl).toBeUndefined()
  })

  it('Fleaflicker reads its own identity column (fleaflickerId), not espnId', async () => {
    h.platform = 'fleaflicker'
    h.rosterPlayers = [rp('12892', 'Christian McCaffrey', 'RB', 'SF')]
    h.identity = [
      { sport: 'NFL', espnId: '12892', sleeperId: '9999', canonicalName: 'Wrong Column' },
      { sport: 'NFL', fleaflickerId: '12892', sleeperId: '4034', canonicalName: 'Christian McCaffrey' },
    ]
    sleeperRowsFor('9999', 1, 'Wrong Column')
    sleeperRowsFor('4034', 19.9, 'Christian McCaffrey')

    const { inputs } = await read()
    expect(inputs['12892']!.providerWeeklyProjection).toBe(19.9)
  })

  it('a Sleeper league is untouched: the roster id IS the Sleeper id, no crosswalk needed', async () => {
    h.platform = 'sleeper'
    h.rosterPlayers = [rp('6794', 'Justin Jefferson', 'WR', 'MIN')]
    sleeperRowsFor('6794', 15.3, 'Justin Jefferson')

    const { inputs, out } = await read()
    expect(inputs['6794']!.providerWeeklyProjection).toBe(15.3)
    expect(out['6794']!.weeklyScore?.stats).toEqual({ name: 'Justin Jefferson' })
    expect(canonicalSpy).toHaveBeenCalledWith('6794')
  })
})

describe('/api/redraft/roster — the unified row\'s stored injury column never outranks the live read', () => {
  it('🛑 a unified `injuryStatus: Out` snapshot does not override "no live designation"', async () => {
    h.platform = 'sleeper'
    h.rosterPlayers = [rp('6794', 'Justin Jefferson', 'WR', 'MIN')]
    h.unified = [{ id: '6794', injuryStatus: 'Out' }]

    const { out } = await read()
    expect(out['6794']!.injuryStatus).toBeNull()
    expect((out['6794'] as unknown as { providerInjuryLabel: unknown }).providerInjuryLabel).toBeNull()
  })
})

/*
 * Owner decision 2026-10-13: score foreign team defences. Sleeper's id for a defence is its club code (`KC`),
 * so an imported D/ST reads that defence's rows — including a projection, which production holds under the
 * bare code (34 `fantasy_projections` rows) and never under the ESPN or Fleaflicker id.
 */
describe('/api/redraft/roster — an imported team defence reads Sleeper\'s defence for its club', () => {
  it('ESPN -16012 (Chiefs D/ST) reads KC\'s week, keyed back on the roster id', async () => {
    h.rosterPlayers = [rp('-16012', 'Chiefs D/ST', 'D/ST', 'KC')]
    sleeperRowsFor('KC', 9, 'Kansas City Chiefs')

    const { inputs, out } = await read()
    expect(out['-16012']!.weeklyScore?.stats).toEqual({ name: 'Kansas City Chiefs' })
    expect(out['-16012']!.weeklyScore?.playerId).toBe('-16012')
    expect(inputs['-16012']!.providerWeeklyProjection).toBe(9)
    expect(canonicalSpy).toHaveBeenCalledWith('KC')
  })

  it('Fleaflicker 2343 ("Kansas City Chiefs", team "Chiefs") reads KC\'s week — its id names nothing', async () => {
    h.platform = 'fleaflicker'
    h.rosterPlayers = [rp('2343', 'Kansas City Chiefs', 'D/ST', 'Chiefs')]
    sleeperRowsFor('2343', 3.1, 'Whoever holds 2343 in Sleeper')
    sleeperRowsFor('KC', 9, 'Kansas City Chiefs')

    const { out } = await read()
    expect(out['2343']!.weeklyScore?.stats).toEqual({ name: 'Kansas City Chiefs' })
    expect(canonicalSpy).not.toHaveBeenCalledWith('2343')
  })

  it('🛑 a Fleaflicker "D/ST" row named for a person reads nothing — a position is not proof of a defence', async () => {
    h.platform = 'fleaflicker'
    h.rosterPlayers = [rp('2343', 'Travis Kelce', 'D/ST', 'Chiefs')]
    sleeperRowsFor('KC', 9, 'Kansas City Chiefs')

    const { out } = await read()
    expect(out['2343']!.weeklyScore).toBeNull()
    expect(canonicalSpy).not.toHaveBeenCalledWith('KC')
  })
})
