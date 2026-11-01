import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The Exile Island row's status line (lib/core-app/survivorExileStatus.ts): your tokens and the way
 * back while you are on the island, otherwise how many castaways are out there. It replaces
 * "Matchup not available yet", which an island always said because it has no head-to-head.
 */

vi.mock('server-only', () => ({}))
const db = vi.hoisted(() => ({
  links: [] as Array<{ mainLeagueId: string; exileLeagueId: string }>,
  players: [] as Array<{ leagueId: string; userId: string; playerState: string; tokenBalance: number }>,
  leagues: [] as Array<{ id: string; settings: unknown }>,
  returns: [] as Array<{ leagueId: string }>,
  fail: false,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    survivorExileLeague: { findMany: vi.fn(async () => db.links) },
    survivorPlayer: {
      findMany: vi.fn(async ({ where }: { where: { OR: Array<{ userId?: string; playerState?: string }> } }) => {
        if (db.fail) throw new Error('read failed')
        const userId = where.OR.find((c) => c.userId)?.userId
        return db.players.filter((p) => p.userId === userId || p.playerState === 'exile')
      }),
    },
    league: { findMany: vi.fn(async () => db.leagues) },
    survivorAuditEntry: { findMany: vi.fn(async () => db.returns) },
  },
}))

import { exileRailStatus } from '@/lib/core-app/survivorExileStatus'
import { attachSurvivorExileLinks } from '@/lib/core-app/attachSurvivorExileLinks'

const base = { onIsland: 3, exileIslandEnabled: true, exileReturnWeek: 10, exileReturnTokens: 4, returnResolved: false }

describe('exileRailStatus', () => {
  it('on the island: your tokens, the tokens needed and the return week', () => {
    expect(exileRailStatus({ ...base, viewer: { playerState: 'exile', tokenBalance: 3 } }))
      .toEqual({ kind: 'island', tokens: 3, tokensToReturn: 4, returnWeek: 10 })
  })

  it('on the island after the season\'s one return: tokens only', () => {
    expect(exileRailStatus({ ...base, returnResolved: true, viewer: { playerState: 'exile', tokenBalance: 2 } }))
      .toEqual({ kind: 'island', tokens: 2, tokensToReturn: null, returnWeek: null })
  })

  it('still in the main game, or not playing: how many are on the island', () => {
    expect(exileRailStatus({ ...base, viewer: { playerState: 'active', tokenBalance: 0 } })).toEqual({ kind: 'watching', onIsland: 3 })
    expect(exileRailStatus({ ...base, viewer: null })).toEqual({ kind: 'watching', onIsland: 3 })
  })
})

describe('attachSurvivorExileLinks with a viewer', () => {
  beforeEach(() => {
    db.links = [{ mainLeagueId: 'survivor-a', exileLeagueId: 'exile-a' }]
    db.leagues = [{ id: 'survivor-a', settings: { exileReturnWeek: 8, exileReturnTokens: 5 } }]
    db.players = [
      { leagueId: 'survivor-a', userId: 'me', playerState: 'exile', tokenBalance: 2 },
      { leagueId: 'survivor-a', userId: 'other', playerState: 'exile', tokenBalance: 4 },
      { leagueId: 'survivor-a', userId: 'third', playerState: 'active', tokenBalance: 0 },
    ]
    db.returns = []
    db.fail = false
  })

  it('reads the league\'s own return rules for the island you are on', async () => {
    const rail: Array<{ id: string; exileOf?: string; exileStatus?: unknown }> = [{ id: 'survivor-a' }, { id: 'exile-a' }]
    await attachSurvivorExileLinks(rail, 'me')
    expect(rail[1]).toEqual({ id: 'exile-a', exileOf: 'survivor-a', exileStatus: { kind: 'island', tokens: 2, tokensToReturn: 5, returnWeek: 8 } })
    expect(rail[0].exileStatus).toBeUndefined()
  })

  it('counts the island for a manager still in the main game', async () => {
    const rail: Array<{ id: string; exileOf?: string; exileStatus?: unknown }> = [{ id: 'exile-a' }]
    await attachSurvivorExileLinks(rail, 'third')
    expect(rail[0].exileStatus).toEqual({ kind: 'watching', onIsland: 2 })
  })

  it('a failed read keeps the pairing and adds no line', async () => {
    db.fail = true
    const rail: Array<{ id: string; exileOf?: string; exileStatus?: unknown }> = [{ id: 'exile-a' }]
    await attachSurvivorExileLinks(rail, 'me')
    expect(rail[0]).toEqual({ id: 'exile-a', exileOf: 'survivor-a' })
  })

  it('without a viewer only the link is read', async () => {
    const rail: Array<{ id: string; exileOf?: string; exileStatus?: unknown }> = [{ id: 'exile-a' }]
    await attachSurvivorExileLinks(rail)
    expect(rail[0]).toEqual({ id: 'exile-a', exileOf: 'survivor-a' })
  })
})
