/**
 * `voidPendingRedraftTradesForRoster` (lib/redraft/voidPendingTradesForElimination.ts) — when a team is
 * eliminated (Survivor, Guillotine and the like) its pending offers are cancelled. Every OTHER team in each
 * cancelled offer is told why; the eliminated team and the person who eliminated it are not.
 *
 *   - two teams: one in-app notice to the other team, and the DM card's `cancelled` line
 *   - three or four teams: every other team, with every team named, and no DM card (there is none)
 *   - only the proposals THIS call cancelled are told (read back by its own `cancelledAt` stamp)
 *   - a failed notice never fails the void or changes the count it returns
 *
 * The voiding itself (which rows, which statuses, the legacy mirror) is pinned by multi-team-trade-core
 * and trade-canonicalization, which run unchanged.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = {
  id: string
  leagueId: string
  seasonId: string
  proposerRosterId: string
  receiverRosterId: string
  additionalRosterIds: string[]
  status: string
  cancelledAt: Date | null
}

const h = vi.hoisted(() => ({
  proposals: [] as Row[],
  dispatch: vi.fn(async (_input: unknown) => undefined),
  dm: vi.fn(),
  rosters: vi.fn(),
  findManyCalls: 0,
  notify: vi.fn(),
}))

const ROSTERS = [
  { id: 'rA', ownerId: 'uA', teamName: 'Alpha', ownerName: 'Ann' },
  { id: 'rB', ownerId: 'uB', teamName: 'Bravo', ownerName: 'Ben' },
  { id: 'rC', ownerId: 'uC', teamName: null, ownerName: 'Cat' },
  { id: 'rD', ownerId: 'uD', teamName: 'Delta', ownerName: 'Dan' },
]

type Where = {
  seasonId?: string
  status?: string
  cancelledAt?: Date
  OR?: Array<Record<string, unknown>>
}
const touches = (row: Row, or: Where['OR']) =>
  !or ||
  or.some(
    (c) =>
      ('proposerRosterId' in c && row.proposerRosterId === c.proposerRosterId) ||
      ('receiverRosterId' in c && row.receiverRosterId === c.receiverRosterId) ||
      ('additionalRosterIds' in c && row.additionalRosterIds.includes((c.additionalRosterIds as { has: string }).has)),
  )
const matches = (row: Row, w: Where) =>
  (w.seasonId === undefined || row.seasonId === w.seasonId) &&
  (w.status === undefined || row.status === w.status) &&
  (w.cancelledAt === undefined || (row.cancelledAt !== null && row.cancelledAt.getTime() === w.cancelledAt.getTime())) &&
  touches(row, w.OR)

vi.mock('@/lib/prisma', () => ({
  prisma: {
    redraftSeason: { findFirst: vi.fn(async () => ({ id: 'S' })) },
    redraftTradeProposal: {
      updateMany: vi.fn(async (args: { where: Where; data: { status: string; cancelledAt: Date } }) => {
        const hit = h.proposals.filter((r) => matches(r, args.where))
        for (const r of hit) Object.assign(r, args.data)
        return { count: hit.length }
      }),
      findMany: vi.fn(async (args: { where: Where }) => {
        h.findManyCalls += 1
        return h.proposals.filter((r) => matches(r, args.where)).map((r) => ({ ...r }))
      }),
    },
    redraftLeagueTrade: { updateMany: vi.fn(async () => ({ count: 0 })) },
    redraftRoster: { findMany: h.rosters },
  },
}))
vi.mock('@/lib/chat-notifications/tradeOfferDm', () => ({ queueTradeStatusInDm: h.dm }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: h.dispatch }))
// The REAL helper, watched: what reaches the dispatcher is still the helper's own work.
vi.mock('@/lib/redraft/multiTeamTradeNotices', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/redraft/multiTeamTradeNotices')>()
  h.notify.mockImplementation(real.notifyMultiTeamTradeParties)
  return { ...real, notifyMultiTeamTradeParties: h.notify }
})

import { voidPendingRedraftTradesForRoster } from '@/lib/redraft/voidPendingTradesForElimination'

const row = (id: string, over: Partial<Row> = {}): Row => ({
  id,
  leagueId: 'L',
  seasonId: 'S',
  proposerRosterId: 'rA',
  receiverRosterId: 'rB',
  additionalRosterIds: [],
  status: 'pending',
  cancelledAt: null,
  ...over,
})

/** The dispatcher is reached through a dynamic import; let it settle before reading or ruling it out. */
const flush = () => new Promise((r) => setTimeout(r, 25))
type Sent = { userIds: string[]; title: string; body: string; dedupePrefix: string; category: string }
async function sent(): Promise<Sent[]> {
  await flush()
  return h.dispatch.mock.calls.map((c) => c[0] as Sent)
}

beforeEach(() => {
  vi.clearAllMocks()
  h.findManyCalls = 0
  h.rosters.mockImplementation(async (args: { where: { id: { in: string[] } } }) => ROSTERS.filter((r) => args.where.id.in.includes(r.id)))
})

describe('voidPendingRedraftTradesForRoster tells the other teams', () => {
  it('two teams: the other team is told who was eliminated, and the DM card gets its cancelled line', async () => {
    h.proposals = [row('p-2')]
    const n = await voidPendingRedraftTradesForRoster('L', 'rB')
    expect(n).toBe(1)
    expect(h.proposals[0]!.status).toBe('cancelled')
    const all = await sent()
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({
      userIds: ['uA'],
      category: 'trade_proposals',
      title: 'Trade cancelled',
      body: 'The trade offer between Alpha and Bravo was cancelled because Bravo was eliminated, so it will not go through.',
      dedupePrefix: 'redraft_trade:p-2:voided_eliminated',
    })
    expect(h.dm.mock.calls).toEqual([
      [
        {
          source: 'redraft',
          tradeId: 'p-2',
          status: 'cancelled',
          actorName: 'The league',
          detail: 'Bravo was eliminated, so the offer was cancelled.',
        },
      ],
    ])
  })

  it('a multi-team trade: every other team is told, every team is named, and there is no DM card', async () => {
    h.proposals = [row('p-4', { additionalRosterIds: ['rC', 'rD'] })]
    await voidPendingRedraftTradesForRoster('L', 'rC')
    const all = await sent()
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({
      userIds: ['uA', 'uB', 'uD'],
      title: 'Trade cancelled',
      body: 'The multi-team trade between Alpha, Bravo, Cat and Delta was cancelled because Cat was eliminated, so it will not go through.',
      dedupePrefix: 'redraft_trade:p-4:voided_eliminated',
    })
    expect(h.dm).not.toHaveBeenCalled()
  })

  it('each voided offer is told once, under its own key; the eliminated proposer is never told', async () => {
    h.proposals = [row('p-2'), row('p-3', { receiverRosterId: 'rC', additionalRosterIds: ['rD'] })]
    const n = await voidPendingRedraftTradesForRoster('L', 'rA')
    expect(n).toBe(2)
    /*
     * Read at the helper, not the dispatcher. ⚠ Under this vitest, two same-tick `import()`s of a
     * vi.mock'd module resolve only the FIRST (measured: one `.then` of two ran, no rejection), so the
     * dispatcher mock sees one notice of two. Node resolves both; it is a harness artifact, not the code.
     */
    await flush()
    const calls = h.notify.mock.calls.map((c) => c[0] as { proposalId: string; key: string; userIds: unknown[] })
    expect(calls.map((c) => [c.proposalId, c.key, c.userIds.filter(Boolean)])).toEqual([
      ['p-2', 'voided_eliminated', ['uB']],
      ['p-3', 'voided_eliminated', ['uC', 'uD']],
    ])
    expect(calls.flatMap((c) => c.userIds)).not.toContain('uA')
    // One roster read for every voided offer, not one per offer.
    expect(h.rosters).toHaveBeenCalledTimes(1)
  })

  it('never tells the person who eliminated the team about their own action', async () => {
    h.proposals = [row('p-4', { additionalRosterIds: ['rC', 'rD'] })]
    await voidPendingRedraftTradesForRoster('L', 'rC', { actorUserId: 'uD' })
    const all = await sent()
    expect(all[0]!.userIds).toEqual(['uA', 'uB'])
  })

  it('only offers this call cancelled are told: an offer someone else already cancelled is not', async () => {
    h.proposals = [row('p-old', { status: 'cancelled', cancelledAt: new Date('2026-10-01T00:00:00Z') }), row('p-2')]
    await voidPendingRedraftTradesForRoster('L', 'rB')
    const all = await sent()
    expect(all.map((s) => s.dedupePrefix)).toEqual(['redraft_trade:p-2:voided_eliminated'])
  })

  it('nothing voided: no read-back, no roster read, no notice', async () => {
    h.proposals = [row('p-other', { proposerRosterId: 'rC', receiverRosterId: 'rD' })]
    const n = await voidPendingRedraftTradesForRoster('L', 'rA')
    expect(n).toBe(0)
    expect(h.findManyCalls).toBe(0)
    expect(h.rosters).not.toHaveBeenCalled()
    expect(await sent()).toEqual([])
    expect(h.dm).not.toHaveBeenCalled()
  })

  it('a failed notice never fails the void: the roster read throws, the count is unchanged', async () => {
    h.proposals = [row('p-2'), row('p-4', { additionalRosterIds: ['rC'] })]
    h.rosters.mockRejectedValue(new Error('roster read failed'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(voidPendingRedraftTradesForRoster('L', 'rB')).resolves.toBe(2)
    expect(h.proposals.map((p) => p.status)).toEqual(['cancelled', 'cancelled'])
    expect(await sent()).toEqual([])
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })

  it('a dispatcher that rejects does not fail the void either', async () => {
    h.proposals = [row('p-4', { additionalRosterIds: ['rC'] })]
    h.dispatch.mockRejectedValueOnce(new Error('dispatch failed'))
    await expect(voidPendingRedraftTradesForRoster('L', 'rC')).resolves.toBe(1)
    await flush()
    expect(h.dispatch).toHaveBeenCalledTimes(1)
  })
})
