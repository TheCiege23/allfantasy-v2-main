/**
 * Edit Rosters. What matters beyond "the list changed":
 *   - a native roster lives in TWO stores (`Roster.playerData` for the UI/waivers/trades, and
 *     `RedraftRosterPlayer` rows for scoring); every edit must move both, or a player scores for a
 *     team he is not on;
 *   - a player can never be on two teams; an imported league and a chopped Guillotine team refuse;
 *   - only the commish or a co-commish can do it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type RosterRow = { id: string; leagueId: string; playerData: unknown; redraftRosterId: string | null }
type RrpRow = { rosterId: string; playerId: string; playerName: string; position: string; team: string | null; droppedAt: Date | null; acquisitionType?: string; slotType?: string }

const h = vi.hoisted(() => {
  const state = {
    role: 'co_commissioner' as string | null,
    platform: 'allfantasy',
    rosters: [] as RosterRow[],
    rrp: [] as RrpRow[],
    chopped: [] as string[],
    txLog: [] as Array<{ rosterId: string; type: string }>,
    audit: [] as Array<Record<string, unknown>>,
  }
  const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
  const inList = (v: string, w: unknown) =>
    typeof w === 'string' ? v === w : Array.isArray((w as { in?: string[] })?.in) ? (w as { in: string[] }).in.includes(v) : true
  const prisma: Record<string, any> = {
    league: { findUnique: vi.fn(async () => ({ platform: state.platform, sport: 'NFL' })) },
    guillotineRosterState: {
      findMany: vi.fn(async ({ where }: { where: { rosterId: { in: string[] } } }) =>
        state.chopped.filter((id) => where.rosterId.in.includes(id)).map((rosterId) => ({ rosterId })),
      ),
    },
    roster: {
      findMany: vi.fn(async () => clone(state.rosters)),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { playerData: unknown } }) => {
        state.rosters.find((r) => r.id === where.id)!.playerData = clone(data.playerData)
      }),
    },
    redraftRoster: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map((id) => ({ id, seasonId: 'S1' }))),
    },
    redraftRosterPlayer: {
      findMany: vi.fn(async () => state.rrp.filter((r) => !r.droppedAt)),
      createMany: vi.fn(async ({ data }: { data: RrpRow[] }) => {
        state.rrp.push(...data.map((d) => ({ ...d, droppedAt: null })))
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { rosterId: string; playerId: unknown }; data: Partial<RrpRow> }) => {
        for (const r of state.rrp) {
          if (r.rosterId === where.rosterId && inList(r.playerId, where.playerId) && !r.droppedAt) Object.assign(r, data)
        }
      }),
    },
    redraftLeagueTransaction: {
      create: vi.fn(async ({ data }: { data: { rosterId: string; type: string } }) => {
        state.txLog.push({ rosterId: data.rosterId, type: data.type })
      }),
    },
  }
  prisma.$transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma))
  return { state, prisma }
})

vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u-co' } })) }))
vi.mock('@/lib/league/permissions', () => ({
  getLeagueRole: vi.fn(async () => h.state.role),
  isCommissionerRole: (r: string | null) => r === 'commissioner' || r === 'co_commissioner',
}))
vi.mock('@/server/services/auditService', () => ({
  logAction: vi.fn(async (i: Record<string, unknown>) => {
    h.state.audit.push(i)
    return { id: 'a' }
  }),
}))
vi.mock('@/lib/league-events/publisher', () => ({ publishLeagueFanoutEvent: vi.fn(async () => undefined) }))
vi.mock('@/lib/scoring-engine/resolveTeamLabels', () => ({
  buildRosterLabelMap: vi.fn(async () => new Map([['A', 'Aces'], ['B', 'Bees'], ['C', 'Cees']])),
}))
vi.mock('@/lib/league-trade-engine/nativeFuturePicks', () => ({
  loadNativeFuturePicks: vi.fn(async () => null),
  parseInventoryPickId: (ref: string) => (/^fdp:\d{4}:\d{1,2}:.+$/.test(ref) ? { season: 2027, round: 1, originalRosterId: 'x' } : null),
}))
// The real mover is covered by the trade-processor suites; here it only has to move playerData.
vi.mock('@/lib/league-trade-engine/tradeProcessor', async () => {
  const utils = await import('@/lib/waiver-wire/roster-utils')
  return {
    applyTradeAssetsInTransaction: vi.fn(async (_tx: unknown, input: { assets: Array<{ itemType: string; itemReference: string; fromRosterId: string; toRosterId: string }> }) => {
      for (const a of input.assets) {
        if (a.itemType !== 'player') continue
        const from = h.state.rosters.find((r) => r.id === a.fromRosterId)!
        const to = h.state.rosters.find((r) => r.id === a.toRosterId)!
        if (!utils.rosterContainsPlayer(from.playerData, a.itemReference)) throw new Error('Player is no longer on that roster.')
        from.playerData = utils.removePlayerFromRosterData(from.playerData, a.itemReference)
        to.playerData = utils.addPlayerToRosterData(to.playerData, a.itemReference)
      }
    }),
  }
})

import { validateCommishRosterEdit, executeCommishRosterEdit } from '@/lib/league/commishRosterEdits'
import { GET, POST, parseCommishRosterEdit } from '@/app/api/leagues/[leagueId]/commish-rosters/handler'
import { removePlayerFromRosterData } from '@/lib/waiver-wire/roster-utils'

const ctx = { params: { leagueId: 'L1' } }
const post = (body: unknown) =>
  POST(
    new Request('http://localhost/api/leagues/L1/commish-rosters', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }) as never,
    ctx,
  )
const ids = (rosterId: string) => {
  const pd = h.state.rosters.find((r) => r.id === rosterId)!.playerData as { players: string[] }
  return pd.players
}
const scoring = (rr: string) => h.state.rrp.filter((r) => r.rosterId === rr && !r.droppedAt).map((r) => r.playerId).sort()

beforeEach(() => {
  h.state.role = 'co_commissioner'
  h.state.platform = 'allfantasy'
  h.state.chopped = []
  h.state.txLog = []
  h.state.audit = []
  h.state.rosters = [
    { id: 'A', leagueId: 'L1', redraftRosterId: 'rA', playerData: { players: ['p1', 'p2'], starters: ['p1'], lineup_sections: { starters: ['p1'], bench: ['p2'] } } },
    { id: 'B', leagueId: 'L1', redraftRosterId: 'rB', playerData: { players: ['p3'], lineup_sections: { starters: [], bench: ['p3'] } } },
    { id: 'C', leagueId: 'L1', redraftRosterId: null, playerData: { players: [] } },
  ]
  h.state.rrp = [
    { rosterId: 'rA', playerId: 'p1', playerName: 'One', position: 'QB', team: 'KC', droppedAt: null },
    { rosterId: 'rA', playerId: 'p2', playerName: 'Two', position: 'RB', team: 'SF', droppedAt: null },
    { rosterId: 'rB', playerId: 'p3', playerName: 'Three', position: 'WR', team: 'DAL', droppedAt: null },
  ]
})

describe('shape checks', () => {
  it('refuses empty, duplicate, self-moves and non-future picks', () => {
    expect(validateCommishRosterEdit({ action: 'add', rosterId: 'A', players: [] })).toMatch(/between 1/)
    expect(validateCommishRosterEdit({ action: 'add', rosterId: 'A', players: [{ id: 'x' }, { id: 'x' }] })).toMatch(/once/)
    expect(validateCommishRosterEdit({ action: 'drop', rosterId: '', playerIds: ['p1'] })).toMatch(/team/)
    expect(validateCommishRosterEdit({ action: 'move', moves: [{ fromRosterId: 'A', toRosterId: 'A', playerIds: ['p1'] }] })).toMatch(/different/)
    expect(validateCommishRosterEdit({ action: 'move', moves: [{ fromRosterId: 'A', toRosterId: 'B', pickRefs: ['2026-1'] }] })).toMatch(/future/)
    expect(validateCommishRosterEdit({ action: 'move', moves: [{ fromRosterId: 'A', toRosterId: 'B', pickRefs: ['fdp:2027:1:A'] }] })).toBeNull()
    expect(validateCommishRosterEdit({ action: 'drop', rosterId: 'A', playerIds: Array.from({ length: 26 }, (_, i) => `p${i}`) })).toMatch(/between 1/)
  })
  it('parses bodies and rejects unknown actions', () => {
    expect(parseCommishRosterEdit({ action: 'drop', rosterId: 'A', playerIds: [' p1 ', '', null] })).toEqual({ action: 'drop', rosterId: 'A', playerIds: ['p1'] })
    expect(parseCommishRosterEdit({ action: 'nuke' })).toBeNull()
    expect(parseCommishRosterEdit(null)).toBeNull()
  })
})

describe('add', () => {
  it('writes playerData AND a scoring row, on the bench', async () => {
    const r = await executeCommishRosterEdit('L1', { action: 'add', rosterId: 'B', players: [{ id: 'p9', name: 'Nine', position: 'TE', team: 'BUF' }] })
    expect(r.added).toEqual(['p9'])
    expect(ids('B')).toEqual(['p3', 'p9'])
    expect(scoring('rB')).toEqual(['p3', 'p9'])
    expect(h.state.rrp.find((x) => x.playerId === 'p9')).toMatchObject({ slotType: 'BENCH', acquisitionType: 'free_agent', position: 'TE' })
    expect(h.state.txLog).toEqual([{ rosterId: 'rB', type: 'commissioner_add' }])
  })
  it('refuses a player already on any team and writes nothing', async () => {
    const before = JSON.stringify([h.state.rosters, h.state.rrp])
    await expect(executeCommishRosterEdit('L1', { action: 'add', rosterId: 'B', players: [{ id: 'p1', name: 'One' }] })).rejects.toMatchObject({ status: 409 })
    expect(JSON.stringify([h.state.rosters, h.state.rrp])).toBe(before)
  })
  it('reports a team with no scoring row instead of hiding it', async () => {
    const r = await executeCommishRosterEdit('L1', { action: 'add', rosterId: 'C', players: [{ id: 'p9' }] })
    expect(ids('C')).toEqual(['p9'])
    expect(r.rostersWithoutScoringRow).toEqual(['C'])
  })
})

describe('drop', () => {
  it('removes the player from every lineup array and stops him scoring', async () => {
    await executeCommishRosterEdit('L1', { action: 'drop', rosterId: 'A', playerIds: ['p1'] })
    const pd = h.state.rosters[0]!.playerData as Record<string, any>
    expect(pd.players).toEqual(['p2'])
    expect(pd.starters).toEqual([])
    expect(pd.lineup_sections.starters).toEqual([])
    expect(scoring('rA')).toEqual(['p2'])
  })
  it('refuses a player who is not on that team', async () => {
    await expect(executeCommishRosterEdit('L1', { action: 'drop', rosterId: 'A', playerIds: ['p3'] })).rejects.toMatchObject({ status: 409 })
    expect(scoring('rB')).toEqual(['p3'])
  })
})

describe('move', () => {
  it('a switch moves both players in both stores', async () => {
    const r = await executeCommishRosterEdit('L1', {
      action: 'move',
      moves: [
        { fromRosterId: 'A', toRosterId: 'B', playerIds: ['p1'] },
        { fromRosterId: 'B', toRosterId: 'A', playerIds: ['p3'] },
      ],
    })
    expect(ids('A').sort()).toEqual(['p2', 'p3'])
    expect(ids('B')).toEqual(['p1'])
    expect(scoring('rA')).toEqual(['p2', 'p3'])
    expect(scoring('rB')).toEqual(['p1'])
    expect(r.moved).toHaveLength(2)
    expect(h.state.txLog.map((t) => t.type)).toEqual(['commissioner_move_out', 'commissioner_move_in', 'commissioner_move_out', 'commissioner_move_in'])
  })
  it('moving to a team with no scoring row stops the old team scoring him', async () => {
    await executeCommishRosterEdit('L1', { action: 'move', moves: [{ fromRosterId: 'A', toRosterId: 'C', playerIds: ['p2'] }] })
    expect(ids('C')).toEqual(['p2'])
    expect(scoring('rA')).toEqual(['p1'])
  })
})

describe('refusals', () => {
  it('an imported league is edited on its host', async () => {
    h.state.platform = 'sleeper'
    await expect(executeCommishRosterEdit('L1', { action: 'drop', rosterId: 'A', playerIds: ['p1'] })).rejects.toMatchObject({ status: 409 })
    expect(ids('A')).toEqual(['p1', 'p2'])
  })
  it('a chopped Guillotine team cannot change', async () => {
    h.state.chopped = ['B']
    await expect(
      executeCommishRosterEdit('L1', { action: 'move', moves: [{ fromRosterId: 'A', toRosterId: 'B', playerIds: ['p1'] }] }),
    ).rejects.toMatchObject({ status: 409 })
    expect(ids('A')).toEqual(['p1', 'p2'])
  })
})

describe('route', () => {
  it('refuses a member on GET and POST', async () => {
    h.state.role = 'member'
    expect((await GET(new Request('http://localhost/x') as never, ctx)).status).toBe(403)
    expect((await post({ action: 'drop', rosterId: 'A', playerIds: ['p1'] })).status).toBe(403)
    expect(ids('A')).toEqual(['p1', 'p2'])
  })
  it('GET names players from scoring rows', async () => {
    const body = await (await GET(new Request('http://localhost/x') as never, ctx)).json()
    expect(body.picksSupported).toBe(false)
    expect(body.teams.find((t: { rosterId: string }) => t.rosterId === 'A').players[0]).toEqual({ id: 'p1', name: 'One', position: 'QB', team: 'KC' })
  })
  it('POST edits, audits, and returns the refreshed teams; a bad edit is a 400 with its reason', async () => {
    const res = await post({ action: 'drop', rosterId: 'A', playerIds: ['p2'] })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.dropped).toEqual(['p2'])
    expect(body.teams.find((t: { rosterId: string }) => t.rosterId === 'A').players.map((p: { id: string }) => p.id)).toEqual(['p1'])
    expect(h.state.audit[0]).toMatchObject({ actionType: 'commish_roster_drop', userId: 'u-co' })

    const bad = await post({ action: 'drop', rosterId: 'A', playerIds: [] })
    expect(bad.status).toBe(400)
    expect((await bad.json()).error).toMatch(/between 1/)
    expect((await post({ action: 'nuke' })).status).toBe(400)
  })
})

describe('removePlayerFromRosterData flat-array scrub', () => {
  it('cleans flat lineup arrays on the AllFantasy shape', () => {
    const out = removePlayerFromRosterData(
      { players: ['a', 'b'], starters: ['a'], reserve: [{ id: 'a' }], taxi: ['a', 'b'], lineup_sections: { starters: ['a'], bench: ['b'] } },
      'a',
    ) as Record<string, unknown>
    expect(out).toMatchObject({ players: ['b'], starters: [], reserve: [], taxi: ['b'] })
  })
  it('leaves a positional Sleeper starters array alone', () => {
    const out = removePlayerFromRosterData({ players: ['a', 'b'], starters: ['a', 'b'] }, 'a') as Record<string, unknown>
    expect(out.starters).toEqual(['a', 'b'])
  })
})
