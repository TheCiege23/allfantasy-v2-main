/**
 * @vitest-environment node
 *
 * 🛑 A foreign league's roster ids must never be looked up as Sleeper ids by the trade notes.
 *
 * A Fleaflicker / MFL / Fantrax / Yahoo roster holds that provider's own ids — short numbers that
 * collide with real Sleeper ids (51 of 248 on the one production Fleaflicker league). Read as Sleeper
 * ids, the viewer's roster became a stranger's positions, injuries and FantasyCalc prices, and every
 * note built on it — byes, roster need, league scale, format rules — described somebody else's team.
 * The control proves the same id IS looked up in a Sleeper league, so a pass is not blindness.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = { platform: 'fleaflicker', sleeperIdsAsked: [] as string[][] }

vi.mock('@/lib/prisma', () => {
  const emptyDelegate = new Proxy(
    {},
    {
      get: (_t, method: string) => {
        if (method === 'findMany' || method === 'groupBy') return async () => []
        if (method === 'count') return async () => 0
        return async () => null
      },
    },
  )
  const overrides: Record<string, Record<string, unknown>> = {
    league: {
      findUnique: async () => ({
        id: 'L1',
        starters: ['QB', 'RB', 'WR', 'TE', 'FLEX'],
        season: 2026,
        sport: 'NFL',
        settings: {},
        leagueType: 'redraft',
        isDynasty: false,
        keeperCount: null,
        keeperCostSystem: null,
        keeperRoundPenalty: null,
        platform: state.platform,
      }),
    },
    leagueTeam: {
      findFirst: async () => ({ platformUserId: 'owner-1', externalId: '1' }),
      findMany: async () => [],
      count: async () => 0,
    },
    roster: {
      findFirst: async () => ({ id: 'r1', playerData: { players: ['6038'], starters: ['6038'] } }),
      findMany: async () => [],
    },
    sportsPlayer: {
      findMany: async (arg: { where?: { sleeperId?: { in?: string[] } } }) => {
        const asked = arg?.where?.sleeperId?.in ?? []
        state.sleeperIdsAsked.push(asked)
        return asked.includes('6038') ? [{ sleeperId: '6038', position: 'TE', team: 'KC', name: 'Wrong Player' }] : []
      },
    },
  }
  const prisma = new Proxy(
    {},
    {
      get: (_t, model: string) => {
        const override = overrides[model]
        if (!override) return emptyDelegate
        return new Proxy(override, {
          get: (t, method: string) =>
            (t as Record<string, unknown>)[method] ?? (emptyDelegate as Record<string, unknown>)[method],
        })
      },
    },
  )
  return { prisma, default: prisma }
})

const load = async () => (await import('@/lib/trade-intel/tradeContextNotes')).buildTradeContextNotes

const ARGS = {
  leagueId: 'L1',
  userId: 'u1',
  give: [{ name: 'Give Guy', position: 'WR', team: 'DAL' }],
  get: [{ name: 'Get Guy', position: 'RB', team: 'PHI' }],
}

const askedFor6038 = () => state.sleeperIdsAsked.some((ids) => ids.includes('6038'))

beforeEach(() => {
  state.platform = 'fleaflicker'
  state.sleeperIdsAsked = []
})

describe('buildTradeContextNotes — a foreign league’s roster ids', () => {
  it('🛑 a Fleaflicker roster id that equals a Sleeper id is never looked up as one', async () => {
    const buildTradeContextNotes = await load()
    await buildTradeContextNotes(ARGS)
    expect(askedFor6038()).toBe(false)
  })

  it('🛑 the same for MFL, Fantrax and Yahoo', async () => {
    const buildTradeContextNotes = await load()
    for (const platform of ['mfl', 'fantrax', 'yahoo']) {
      state.platform = platform
      await buildTradeContextNotes(ARGS)
    }
    expect(askedFor6038()).toBe(false)
  })

  it('CONTROL: in a Sleeper league the same id IS looked up', async () => {
    state.platform = 'sleeper'
    const buildTradeContextNotes = await load()
    await buildTradeContextNotes(ARGS)
    expect(askedFor6038()).toBe(true)
  })
})
