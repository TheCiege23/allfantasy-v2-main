// @vitest-environment node
/**
 * One league, read once per render (item 3 of the `/core?league=` brief, "load one shared league
 * context").
 *
 * The page creates one `LeagueContext` per render and hands it to whichever screen loader runs.
 * These pin the three properties that make that worth anything:
 *   1. the context reads each thing once, however many callers ask;
 *   2. every league screen loader USES a context it is handed, instead of reading the row itself;
 *   3. a context for another league or viewer is never used (item 6, cross-league leakage).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Call = { model: string; method: string; args: unknown }

const db = vi.hoisted(() => ({
  calls: [] as Array<{ model: string; method: string; args: unknown }>,
  // Per-call answers; anything unlisted gets an empty-but-valid default.
  answers: {} as Record<string, (args: unknown) => unknown>,
}))

/**
 * A prisma double that answers every model and method, and records each call. The loaders under
 * test touch dozens of tables; a permissive double lets each test state only the reads it is about.
 */
vi.mock('@/lib/prisma', () => {
  const fallback = (method: string) =>
    method === 'count' ? 0 : method === 'findMany' || method.startsWith('$query') ? [] : null
  const modelProxy = (model: string) =>
    new Proxy(
      {},
      {
        get: (_t, method: string) =>
          vi.fn(async (args: unknown) => {
            db.calls.push({ model, method, args })
            const answer = db.answers[`${model}.${method}`]
            return answer ? answer(args) : fallback(method)
          }),
      },
    )
  const prisma = new Proxy(
    {},
    {
      get: (_t, key: string) => {
        if (key.startsWith('$query') || key.startsWith('$execute')) {
          return vi.fn(async () => {
            db.calls.push({ model: '$', method: key, args: null })
            return []
          })
        }
        if (key === '$transaction') return vi.fn(async (ops: unknown) => (Array.isArray(ops) ? Promise.all(ops) : null))
        if (key === 'then') return undefined
        return modelProxy(key)
      },
    },
  )
  return { prisma, default: prisma }
})

import {
  CLAIMED_TEAM_SELECT,
  createLeagueContext,
  LEAGUE_CONTEXT_SELECT,
  leagueContextFor,
  type LeagueContext,
} from '@/lib/core-app/leagueContext'

const L = 'league-1'
const U = 'user-1'

const reads = (model: string, method?: string): Call[] =>
  db.calls.filter((c) => c.model === model && (method == null || c.method === method))

beforeEach(() => {
  db.calls = []
  db.answers = {}
})

describe('createLeagueContext', () => {
  it('reads the row, the claimed team and the claimed teams once each, however often asked', async () => {
    db.answers['league.findUnique'] = () => ({ id: L, name: 'Kings' })
    db.answers['leagueTeam.findFirst'] = () => ({ externalId: '3' })
    db.answers['leagueTeam.findMany'] = () => [{ externalId: '3' }]
    const ctx = createLeagueContext(L, U)

    const [a, b] = await Promise.all([ctx.league(), ctx.league()])
    await ctx.league()
    expect(a).toEqual({ id: L, name: 'Kings' })
    expect(b).toBe(a)
    await Promise.all([ctx.claimedTeam(), ctx.claimedTeam(), ctx.claimedTeams(), ctx.claimedTeams()])

    expect(reads('league')).toEqual([
      { model: 'league', method: 'findUnique', args: { where: { id: L }, select: LEAGUE_CONTEXT_SELECT } },
    ])
    expect(reads('leagueTeam')).toEqual([
      {
        model: 'leagueTeam',
        method: 'findFirst',
        args: { where: { leagueId: L, claimedByUserId: U }, select: CLAIMED_TEAM_SELECT },
      },
      {
        model: 'leagueTeam',
        method: 'findMany',
        args: { where: { leagueId: L, claimedByUserId: U }, select: CLAIMED_TEAM_SELECT },
      },
    ])
  })

  it('reads nothing until asked', () => {
    createLeagueContext(L, U)
    expect(db.calls).toEqual([])
  })

  it('a failed read fails every caller, and is not retried behind their backs', async () => {
    db.answers['league.findUnique'] = () => {
      throw new Error('db down')
    }
    const ctx = createLeagueContext(L, U)
    await expect(ctx.league()).rejects.toThrow('db down')
    await expect(ctx.league()).rejects.toThrow('db down')
    expect(reads('league')).toHaveLength(1)
  })
})

describe('leagueContextFor', () => {
  const passed = createLeagueContext(L, U)

  it('uses the passed context when it is for this league and viewer', () => {
    expect(leagueContextFor(L, U, passed)).toBe(passed)
  })

  it('🛑 never uses a context for another league or another viewer', () => {
    for (const [leagueId, userId] of [
      ['league-2', U],
      [L, 'user-2'],
    ]) {
      const ctx = leagueContextFor(leagueId, userId, passed)
      expect(ctx).not.toBe(passed)
      expect([ctx.leagueId, ctx.userId]).toEqual([leagueId, userId])
    }
  })

  it('makes its own when none is passed', () => {
    for (const none of [undefined, null]) {
      const ctx = leagueContextFor(L, U, none)
      expect([ctx.leagueId, ctx.userId]).toEqual([L, U])
    }
  })
})

/**
 * 🛑 EVERY LEAGUE SCREEN LOADER USES THE CONTEXT IT IS HANDED. A loader that keeps its own read
 * still works — which is exactly why nothing else would notice it had stopped sharing. Each is
 * handed a context whose league does not exist, so each returns early, and the only question is
 * whether it asked the context or the database.
 */
describe('the league screen loaders', () => {
  function fakeContext(leagueId = L, userId = U) {
    return {
      leagueId,
      userId,
      league: vi.fn(async () => null),
      claimedTeam: vi.fn(async () => null),
      claimedTeams: vi.fn(async () => []),
    } satisfies LeagueContext
  }

  const loaders: Array<[string, (ctx: LeagueContext, leagueId: string) => Promise<unknown>]> = [
    ['getLeagueHomeData', async (ctx, id) => (await import('@/lib/core-app/leagueHome')).getLeagueHomeData(id, U, null, ctx)],
    ['getMyTeamData', async (ctx, id) => (await import('@/lib/core-app/myTeam')).getMyTeamData(id, U, ctx)],
    ['getMatchupData', async (ctx, id) => (await import('@/lib/core-app/matchup')).getMatchupData(id, U, null, ctx)],
    ['getTradesData', async (ctx, id) => (await import('@/lib/core-app/trades')).getTradesData(id, U, ctx)],
    ['getWaiversData', async (ctx, id) => (await import('@/lib/core-app/waivers')).getWaiversData(id, U, ctx)],
    ['getDraftHqData', async (ctx, id) => (await import('@/lib/core-app/draftHq')).getDraftHqData(id, U, ctx)],
    ['getDraftBoardData', async (ctx, id) => (await import('@/lib/core-app/draftBoard')).getDraftBoardData(id, U, ctx)],
    ['getScoutData', async (ctx, id) => (await import('@/lib/core-app/scout')).getScoutData(id, U, ctx)],
    ['getLeagueCareer', async (ctx, id) => (await import('@/lib/core-app/leagueCareer')).getLeagueCareer(id, U, ctx)],
    ['getLeagueSync', async (ctx, id) => (await import('@/lib/core-app/leagueSync')).getLeagueSync(id, U, undefined, ctx)],
    [
      'getLeagueStandings',
      async (ctx, id) => (await import('@/lib/core-app/leagueStandings')).getLeagueStandings(id, U, ctx),
    ],
    [
      'readLeagueStandingsSummary',
      async (ctx, id) =>
        (await import('@/lib/core-app/leagueStandingsSummary')).readLeagueStandingsSummary(id, U, ctx),
    ],
    [
      'getPlayerLeagueView',
      async (ctx, id) =>
        (await import('@/lib/core-app/playerLeagueView')).getPlayerLeagueView(id, 'p-1', U, undefined, ctx),
    ],
    [
      'getPlayerTradeVisual',
      async (ctx, id) => (await import('@/lib/core-app/playerTradeVisual')).getPlayerTradeVisual(id, 'p-1', U, ctx),
    ],
  ]

  it.each(loaders)('%s reads the row through the context it is handed', { timeout: 60_000 }, async (_name, run) => {
    const ctx = fakeContext()
    await run(ctx, L)
    expect(ctx.league).toHaveBeenCalled()
    expect(reads('league'), 'read the League row itself').toEqual([])
  })

  it('the Player Finder league card, signed out, reads the row itself and touches no context', async () => {
    const { getPlayerLeagueView } = await import('@/lib/core-app/playerLeagueView')
    const ctx = fakeContext()
    await getPlayerLeagueView(L, 'p-1', null, undefined, ctx)
    expect(ctx.league).not.toHaveBeenCalled()
    expect(reads('league', 'findUnique').map((c) => (c.args as { where: unknown }).where)).toEqual([{ id: L }])
  })

  it.each(loaders)('🛑 %s ignores a context for another league', { timeout: 60_000 }, async (_name, run) => {
    const foreign = fakeContext('some-other-league')
    await run(foreign, L)
    expect(foreign.league).not.toHaveBeenCalled()
    expect(foreign.claimedTeam).not.toHaveBeenCalled()
    expect(foreign.claimedTeams).not.toHaveBeenCalled()
    // …and reads its own league instead: the positive control for the assertion above.
    expect(reads('league', 'findUnique').map((c) => (c.args as { where: unknown }).where)).toContainEqual({ id: L })
  })
})

/**
 * 🛑 THE WORST CASE, END TO END: `/core/draft-hq?league=` runs `getDraftHqData` and
 * `getDraftBoardData` in one render. Measured with this exact fixture on the base commit
 * (e7e7817d8), before the shared context: THREE reads of the League row and THREE of the viewer's
 * team (two `findFirst`, one `findMany`), on top of the shell's own row read. With no draft session
 * the loaders read the row four times.
 */
describe('Draft HQ and its board, in one render', () => {
  function liveDraftWithImportedBoard() {
    db.answers['league.findUnique'] = () => ({ id: L, name: 'Kings', platform: 'sleeper', platformLeagueId: 'p-1' })
    db.answers['draftSession.findFirst'] = () => ({
      id: 's-1',
      status: 'drafting',
      draftType: 'snake',
      rounds: 2,
      teamCount: 2,
      slotOrder: [{ slot: 1, rosterId: '3' }],
    })
    db.answers['draftFact.findMany'] = () => [{ season: 2025, round: 1, pickNumber: 1, playerId: 'p9', managerId: '3' }]
    db.answers['leagueTeam.findFirst'] = () => ({ externalId: '3', teamName: 'Mine' })
    db.answers['leagueTeam.findMany'] = (args) =>
      (args as { where: { claimedByUserId?: string } }).where.claimedByUserId
        ? [{ externalId: '3' }]
        : [{ externalId: '3', teamName: 'Mine', ownerName: 'me' }]
  }

  const claimedReads = () =>
    reads('leagueTeam').filter((c) => (c.args as { where?: { claimedByUserId?: string } })?.where?.claimedByUserId)

  it('reads the row once and the viewer’s team once per shape, with one shared context', { timeout: 60_000 }, async () => {
    liveDraftWithImportedBoard()
    const { getDraftHqData } = await import('@/lib/core-app/draftHq')
    const { getDraftBoardData } = await import('@/lib/core-app/draftBoard')
    const ctx = createLeagueContext(L, U)

    const [hq, board] = await Promise.all([getDraftHqData(L, U, ctx), getDraftBoardData(L, U, ctx)])
    expect(hq, 'draft HQ rendered').not.toBeNull()
    expect(board, 'draft board rendered').not.toBeNull()

    expect(reads('league')).toHaveLength(1)
    expect(claimedReads().map((c) => c.method).sort()).toEqual(['findFirst', 'findMany'])
  })

  /*
   * Positive control. Without a context each loader makes its own, so Draft HQ's helpers still share
   * within that loader (3 row reads became 2) — but the two loaders do not share with each other.
   */
  it('positive control: each loader on its own context reads them again', { timeout: 60_000 }, async () => {
    liveDraftWithImportedBoard()
    const { getDraftHqData } = await import('@/lib/core-app/draftHq')
    const { getDraftBoardData } = await import('@/lib/core-app/draftBoard')

    await Promise.all([getDraftHqData(L, U), getDraftBoardData(L, U)])

    expect(reads('league')).toHaveLength(2)
    expect(claimedReads().map((c) => c.method).sort()).toEqual(['findFirst', 'findFirst', 'findMany'])
  })
})
