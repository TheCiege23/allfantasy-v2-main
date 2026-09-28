import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 🛑 THE LEAGUE ROSTER API ON A FOREIGN LEAGUE (`lib/data/league-home.ts` → `resolvePlayerIndex`).
 *
 * The index matched every roster id against `PlayerIdentityMap.sleeperId`, `SportsPlayer.sleeperId`
 * / `externalId` and the Sleeper-keyed media batch, last write winning. A Fleaflicker id is a short
 * number that collides with real Sleeper ids, so the roster rows named strangers — and for MFL, a
 * correct `mflId` hit was OVERWRITTEN by a SportsPlayer row whose Sleeper id happened to equal it.
 *
 * The provider-column matches (`mflId`) must survive; only the Sleeper-vocabulary matches stop.
 * The same roster in a Sleeper league is the CONTROL: the harness can see names at all.
 */

type Row = Record<string, unknown>
type Where = { OR?: Array<Record<string, { in: string[] }>> }
const state = vi.hoisted(() => ({
  platform: 'sleeper',
  pim: [] as Row[],
  sportsPlayers: [] as Row[],
  media: vi.fn(),
}))

/* Honours `OR: [{ col: { in } }]` the way Postgres would, so a dropped clause really drops the hit. */
function byOr(rows: Row[], where: Where): Row[] {
  const clauses = where?.OR ?? []
  return rows.filter((r) =>
    clauses.some((c) => Object.entries(c).some(([col, cond]) => r[col] != null && cond.in.includes(String(r[col])))),
  )
}

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => {
  const defaults = (method: string) => async () =>
    method === 'findMany' || method === 'groupBy' ? [] : method === 'count' ? 0 : null
  const override: Record<string, Record<string, (...a: any[]) => any>> = {
    league: {
      findUnique: async () => ({
        id: 'L1',
        name: 'The League',
        sport: 'NFL',
        season: 2026,
        leagueSize: 2,
        avatarUrl: null,
        leagueVariant: null,
        leagueType: 'redraft',
        settings: {},
        scoring: null,
        isDynasty: false,
        platform: state.platform,
        platformLeagueId: 'P1',
        lifecycleState: 'in_season',
        locked: false,
        emergencyPaused: false,
      }),
    },
    roster: {
      findFirst: async () => ({
        id: 'r-me',
        platformUserId: 'u1',
        playerData: { players: ['6038', '9001'], starters: ['6038'] },
        faabRemaining: null,
        waiverPriority: null,
      }),
    },
    playerIdentityMap: { findMany: async (a: { where: Where }) => byOr(state.pim, a.where) },
    sportsPlayer: { findMany: async (a: { where: Where }) => byOr(state.sportsPlayers, a.where) },
  }
  const model = (name: string) =>
    new Proxy({}, { get: (_t, method: string) => override[name]?.[method] ?? defaults(method) })
  return { prisma: new Proxy({}, { get: (_t, name: string) => (name.startsWith('$') ? async () => [] : model(name)) }) }
})
vi.mock('@/lib/league-access', () => ({ resolveLeagueAccess: vi.fn(async () => ({ isMember: true, isCommissioner: false })) }))
vi.mock('@/lib/devy/DevyLeagueConfig', () => ({ getDevyConfig: vi.fn(async () => null) }))
vi.mock('@/lib/merged-devy-c2c/C2CLeagueConfig', () => ({ getC2CConfig: vi.fn(async () => null) }))
vi.mock('@/lib/multi-sport/MultiSportRosterService', () => ({ getRosterTemplateForLeague: vi.fn(async () => null) }))
vi.mock('@/lib/player-media', () => ({ attachPlayerMediaBatch: (...a: unknown[]) => state.media(...a) }))
vi.mock('@/server/services/leagueLifecycleService', () => ({ getAllowedActions: vi.fn(() => []) }))

import { getLeagueRosterView } from '@/lib/data/league-home'

const pimRow = (canonicalName: string, cols: Row): Row => ({
  canonicalName,
  position: 'WR',
  currentTeam: 'KC',
  sleeperId: null,
  rollingInsightsId: null,
  apiSportsId: null,
  clearSportsId: null,
  espnId: null,
  mflId: null,
  ...cols,
})

beforeEach(() => {
  state.pim = [
    // '6038' IS a Sleeper id — a stranger to any foreign league that uses 6038 for someone else.
    pimRow('Wrong Player', { sleeperId: '6038' }),
    // MFL's '9001' is correctly bridged through `mflId`; his own Sleeper id is unrelated.
    pimRow('Right MFL Man', { sleeperId: '4046', mflId: '9001' }),
  ]
  state.sportsPlayers = [
    { externalId: '6038', sleeperId: '6038', name: 'Wrong Player', position: 'WR', team: 'KC', imageUrl: null },
    // Sleeper's '9001' — a DIFFERENT man from MFL's '9001'.
    { externalId: '9001', sleeperId: '9001', name: 'Sleeper Stranger', position: 'RB', team: 'NYJ', imageUrl: null },
  ]
  state.media.mockReset().mockResolvedValue(new Map())
})

async function names(platform: string): Promise<Record<string, string>> {
  state.platform = platform
  const view = await getLeagueRosterView('L1', 'u1')
  expect(view).not.toBeNull()
  const out: Record<string, string> = {}
  for (const s of view!.sections) for (const item of s.items) out[item.player.id] = item.player.name
  return out
}

describe('resolvePlayerIndex — foreign roster ids never match a Sleeper-vocabulary key', () => {
  it('[control] a Sleeper league names its ids through the Sleeper columns', async () => {
    const n = await names('sleeper')
    expect(n['6038']).toBe('Wrong Player')
    expect(n['9001']).toBe('Sleeper Stranger')
  })

  it('🛑 a Fleaflicker league does not name a stranger for a colliding id', async () => {
    const n = await names('fleaflicker')
    expect(n['6038']).toBe('Player 6038')
    expect(n['9001']).not.toBe('Sleeper Stranger')
    expect(state.media).not.toHaveBeenCalled()
  })

  it('🛑 an MFL league keeps its correct `mflId` hit, and a Sleeper-id row no longer overwrites it', async () => {
    const n = await names('mfl')
    expect(n['9001']).toBe('Right MFL Man')
    expect(n['6038']).toBe('Player 6038')
  })
})
