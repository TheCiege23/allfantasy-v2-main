// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ order: [] as Array<{ slot: number; rosterId: string; displayName: string }> }))
vi.mock('@/lib/live-draft-engine/DraftSessionService', () => ({ buildSlotOrderForLeague: async () => mocks.order }))
vi.mock('@/lib/redraft/offseason/carryDynastyRosters', async original => ({ ...await original<typeof import('@/lib/redraft/offseason/carryDynastyRosters')>(), carryDynastyRostersForward: async () => ({ playersCopied: 0 }) }))
vi.mock('@/lib/rookie-order/automaticRookieOrder', () => ({ automaticRookieOrderMethod: async () => null }))
vi.mock('@/lib/rookie-order/liveRookieOrderService', () => ({ resolveLiveRookieDraftSlots: async () => null }))
vi.mock('@/lib/draft-lottery/rookieDraftLottery', () => ({ ensureRookieDraftLottery: async () => null }))
vi.mock('@/server/services/auditService', () => ({ logAction: async () => null }))
import { prisma } from '@/lib/prisma'
import { createNextLeagueDraft } from '@/lib/live-draft-engine/createNextLeagueDraft'
import { consumeNativeFuturePicksForDraft, lockNativeFuturePicks, transferNativeFuturePick } from '@/lib/league-trade-engine/nativeFuturePicks'
import { planRookieAuction } from '@/lib/live-draft-engine/auction/rookieAuctionPickPolicy'

const pilot = process.env.ROOKIE_AUCTION_PILOT === '1' ? describe : describe.skip
pilot('rookie auction pick settlement on isolated Postgres', () => {
  it('rolls back a blocked draft and commits a budget conversion without losing the pick', async () => {
    const target = new URL(process.env.DATABASE_URL!)
    expect(target.hostname).toBe('ep-billowing-shadow-ado0fgzv-pooler.c-2.us-east-1.aws.neon.tech')
    expect(target.pathname).toBe('/neondb')
    const id = `auction-pilot-${randomUUID()}`
    const userId = `${id}-owner`
    const order = [{ slot: 1, rosterId: `${id}-a`, displayName: 'A' }, { slot: 2, rosterId: `${id}-b`, displayName: 'B' }]
    try {
      await prisma.appUser.create({ data: { id: userId, email: `${id}@example.invalid`, username: id } })
      await prisma.league.create({ data: { id, userId, platform: 'manual', platformLeagueId: id, leagueType: 'dynasty', isDynasty: true, settings: {} } })
      const pick = await prisma.futureDraftPick.create({ data: { leagueId: id, pickSeason: 2028, round: 1, originalRosterId: order[0]!.rosterId, currentOwnerId: order[1]!.rosterId, traded: true } })
      const attempt = (policy: 'block' | 'budget') => prisma.$transaction(async tx => {
        const draft = await tx.draftSession.create({ data: { leagueId: id, draftType: 'auction', rounds: 2, teamCount: 2, slotOrder: order, auctionBudgetPerTeam: 20 } })
        const trades = await consumeNativeFuturePicksForDraft(tx, { leagueId: id, season: 2028, draftSessionId: draft.id, rounds: 2, slotOrder: order })
        const plan = planRookieAuction({ policy, slotOrder: order, rounds: 2, budgetPerTeam: 20, valuesByRound: { '1': 6 }, trades })
        await tx.draftSession.update({ where: { id: draft.id }, data: { auctionBudgets: plan.budgets, tradedPicks: trades as any } })
        return { draft, plan }
      }, { timeout: 30000 })
      await expect(attempt('block')).rejects.toThrow(/resolved/)
      expect((await prisma.futureDraftPick.findUniqueOrThrow({ where: { id: pick.id } })).status).toBe('active')
      expect(await prisma.draftSession.count({ where: { leagueId: id } })).toBe(0)
      const { draft, plan } = await attempt('budget')
      expect(plan.budgets).toEqual({ [order[0]!.rosterId]: 14, [order[1]!.rosterId]: 26 })
      expect(await prisma.futureDraftPick.findUniqueOrThrow({ where: { id: pick.id } })).toMatchObject({ status: 'used', usedInDraftSessionId: draft.id })
    } finally {
      await prisma.league.deleteMany({ where: { id } })
      await prisma.appUser.deleteMany({ where: { id: userId } })
    }
  }, 90000)

  it('creates a future rookie auction through the real service and rolls back its default block', async () => {
    const target = new URL(process.env.DATABASE_URL!)
    expect(target.hostname).toBe('ep-billowing-shadow-ado0fgzv-pooler.c-2.us-east-1.aws.neon.tech')
    expect(target.pathname).toBe('/neondb')
    const id = `auction-service-${randomUUID()}`
    const userId = `${id}-owner`
    const order = [{ slot: 1, rosterId: `${id}-a`, displayName: 'A' }, { slot: 2, rosterId: `${id}-b`, displayName: 'B' }]
    mocks.order = order
    try {
      await prisma.appUser.create({ data: { id: userId, email: `${id}@example.invalid`, username: id } })
      await prisma.league.create({ data: { id, userId, platform: 'manual', platformLeagueId: id, leagueType: 'dynasty', isDynasty: true, settings: {}, season: 2027 } })
      await prisma.roster.createMany({ data: order.map(team => ({ id: team.rosterId, leagueId: id, platformUserId: team.rosterId, playerData: {} })) })
      await prisma.redraftSeason.createMany({ data: [
        { leagueId: id, sport: 'NFL', season: 2027, status: 'complete', totalWeeks: 14, playoffStartWeek: 15 },
        { leagueId: id, sport: 'NFL', season: 2028, status: 'setup', totalWeeks: 14, playoffStartWeek: 15 },
      ] })
      await prisma.dynastyLeagueConfig.create({ data: { leagueId: id, rookieDraftType: 'auction', rookieDraftRounds: 2, rookiePickOrderMethod: 'commissioner' } })
      await prisma.draftSession.create({ data: { leagueId: id, status: 'completed', draftType: 'snake', rounds: 2, teamCount: 2, slotOrder: order, completedAt: new Date('2027-01-01') } })
      const pick = await prisma.futureDraftPick.create({ data: { leagueId: id, pickSeason: 2028, round: 1, originalRosterId: order[0]!.rosterId, currentOwnerId: order[1]!.rosterId, traded: true } })
      expect(await createNextLeagueDraft(id, userId)).toMatchObject({ ok: false, code: 'ROOKIE_AUCTION_PICKS_UNRESOLVED' })
      expect((await prisma.futureDraftPick.findUniqueOrThrow({ where: { id: pick.id } })).status).toBe('active')
      expect(await prisma.draftSession.count({ where: { leagueId: id } })).toBe(1)
      await prisma.league.update({ where: { id }, data: { settings: { rookie_auction: { policy: 'budget', budgetPerTeam: 20, valuesByRound: { '1': 6 } } } } })
      const result = await createNextLeagueDraft(id, userId)
      expect(result).toMatchObject({ ok: true, kind: 'rookie', tradedPicksApplied: 1 })
      if (!result.ok) throw new Error(result.message)
      const created = await prisma.draftSession.findUniqueOrThrow({ where: { id: result.sessionId } })
      expect(created).toMatchObject({ draftType: 'auction', playerPool: 'rookies_only', auctionBudgetPerTeam: 20 })
      expect(created.auctionState).toMatchObject({ rookieAuction: { policy: 'budget', trades: [{ originalRosterId: order[0]!.rosterId, newRosterId: order[1]!.rosterId }] } })
      expect(await prisma.futureDraftPick.findUniqueOrThrow({ where: { id: pick.id } })).toMatchObject({ status: 'used', usedInDraftSessionId: created.id })
    } finally {
      await prisma.league.deleteMany({ where: { id } })
      await prisma.appUser.deleteMany({ where: { id: userId } })
    }
  }, 90000)

  it('serializes a pick trade behind auction creation and refuses the stale trade', async () => {
    const target = new URL(process.env.DATABASE_URL!)
    expect(target.hostname).toBe('ep-billowing-shadow-ado0fgzv-pooler.c-2.us-east-1.aws.neon.tech')
    const id = `auction-race-${randomUUID()}`
    const userId = `${id}-owner`
    const order = [{ slot: 1, rosterId: `${id}-a`, displayName: 'A' }, { slot: 2, rosterId: `${id}-b`, displayName: 'B' }]
    try {
      await prisma.appUser.create({ data: { id: userId, email: `${id}@example.invalid`, username: id } })
      await prisma.league.create({ data: { id, userId, platform: 'manual', platformLeagueId: id, leagueType: 'dynasty', isDynasty: true, settings: {}, season: 2027 } })
      await prisma.roster.createMany({ data: order.map(team => ({ id: team.rosterId, leagueId: id, platformUserId: team.rosterId, playerData: {} })) })
      await prisma.redraftSeason.create({ data: { leagueId: id, sport: 'NFL', season: 2028, status: 'setup', totalWeeks: 14, playoffStartWeek: 15 } })
      await prisma.dynastyLeagueConfig.create({ data: { leagueId: id, rookieDraftType: 'auction', rookieDraftRounds: 2 } })
      const pick = await prisma.futureDraftPick.create({ data: { leagueId: id, pickSeason: 2028, round: 1, originalRosterId: order[0]!.rosterId, currentOwnerId: order[0]!.rosterId } })
      let unlock!: () => void
      let signalLocked!: () => void
      const gate = new Promise<void>(resolve => { unlock = resolve })
      const locked = new Promise<void>(resolve => { signalLocked = resolve })
      const create = prisma.$transaction(async tx => {
        await lockNativeFuturePicks(tx, id)
        await tx.draftSession.create({ data: { leagueId: id, draftType: 'auction', status: 'pre_draft', rounds: 2, teamCount: 2, slotOrder: order } })
        signalLocked()
        await gate
      }, { timeout: 30000 })
      await locked
      let tradeSettled = false
      const trade = prisma.$transaction(tx => transferNativeFuturePick(tx, { leagueId: id, ref: `fdp:2028:1:${order[0]!.rosterId}`, fromRosterId: order[0]!.rosterId, toRosterId: order[1]!.rosterId }), { timeout: 30000 })
        .then(() => { tradeSettled = true; return 'moved' }, error => { tradeSettled = true; return String(error) })
      await new Promise(resolve => setTimeout(resolve, 300))
      const settledBeforeCommit = tradeSettled
      unlock()
      await create
      expect(settledBeforeCommit).toBe(false)
      expect(await trade).toContain('no longer tradeable')
      expect(await prisma.futureDraftPick.findUniqueOrThrow({ where: { id: pick.id } })).toMatchObject({ currentOwnerId: order[0]!.rosterId, status: 'active' })
    } finally {
      await prisma.league.deleteMany({ where: { id } })
      await prisma.appUser.deleteMany({ where: { id: userId } })
    }
  }, 90000)
})
