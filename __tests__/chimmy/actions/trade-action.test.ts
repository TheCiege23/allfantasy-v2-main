import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * "Send this trade" for a native league. Proposing builds a card and sends NOTHING; executing goes
 * through `createAfLeagueTrade`, the Trade Center's own service, with the league's week so the
 * deadline check actually applies.
 */

const h = vi.hoisted(() => ({
  membership: vi.fn(),
  leagueFindUnique: vi.fn(),
  rosterFindFirst: vi.fn(),
  rosterFindMany: vi.fn(),
  appUser: vi.fn(),
  leagueTeam: vi.fn(async () => ({ teamName: 'Jordan’s Juggernauts' })),
  resolveNames: vi.fn(async () => new Map()),
  create: vi.fn(async () => ({ id: 'T1' })),
  validate: vi.fn(() => ({ ok: true })),
  deadline: vi.fn(() => false),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: h.leagueFindUnique },
    roster: { findFirst: h.rosterFindFirst, findMany: h.rosterFindMany },
    appUser: { findUnique: h.appUser },
    leagueTeam: { findFirst: h.leagueTeam },
  },
}))
vi.mock('@/lib/league-access', () => ({ resolveLeagueMembership: h.membership }))
vi.mock('@/lib/ai-payload/resolveAiTeamContext', () => ({ resolveNames: h.resolveNames }))
vi.mock('@/lib/league-trade-engine/tradeService', () => ({ createAfLeagueTrade: h.create }))
vi.mock('@/lib/league-trade-engine/tradeSettingsResolver', () => ({
  resolveLeagueTradeSettings: () => ({ tradeReviewMode: 'commissioner', tradesAllowed: true }),
  isPastTradeDeadline: h.deadline,
}))
vi.mock('@/lib/league-trade-engine/tradeValidationService', () => ({ validateTradeAssets: h.validate }))
vi.mock('@/lib/sports-evidence/tradeIntegration', () => ({
  CertifiedTradeIntegrationService: class {
    evaluateTradeProposalSafety = vi.fn(async () => ({ block: false, reason: 'ok' }))
  },
  extractTradePlayerRefs: () => [],
}))

import { executeTradeAction, proposeTrade } from '@/lib/chimmy/actions/tradeAction'
import { verifyChimmyActionToken } from '@/lib/chimmy/actions/actionToken'

const NOW = new Date('2026-09-25T15:00:00Z')
const pd = (rows: Array<[string, string, string]>) => ({
  players: rows.map((r) => r[0]),
  lineup_sections: { starters: rows.map(([id, name, position]) => ({ id, name, position, team: 'KC' })), bench: [], ir: [], taxi: [], devy: [] },
})

const MINE = { id: 'r1', platformUserId: 'u1', playerData: pd([['p1', "Ja'Marr Chase", 'WR'], ['p2', 'Tony Pollard', 'RB']]) }
const THEIRS = { id: 'r2', platformUserId: 'u2', playerData: pd([['p9', 'Justin Jefferson', 'WR']]) }
const OPEN = { id: 'r3', platformUserId: 'orphan-3', playerData: pd([['p7', 'Travis Kelce', 'TE']]) }
const LEAGUE = { id: 'L1', name: 'KBFL', sport: 'NFL', season: 2026, platform: 'allfantasy', settings: { currentWeek: 5 } }
const prevSecret = process.env.NEXTAUTH_SECRET

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = 'test-secret'
  vi.clearAllMocks()
  h.membership.mockResolvedValue({ ok: true })
  h.leagueFindUnique.mockResolvedValue(LEAGUE)
  h.rosterFindFirst.mockImplementation(async ({ where }: { where: { id?: string; platformUserId?: string } }) => {
    if (where.platformUserId === 'u1') return MINE
    return [MINE, THEIRS, OPEN].find((r) => r.id === where.id) ?? null
  })
  h.rosterFindMany.mockResolvedValue([MINE, THEIRS, OPEN])
  h.appUser.mockImplementation(async ({ where }: { where: { id: string } }) => (where.id.startsWith('u') ? { id: where.id } : null))
  h.validate.mockReturnValue({ ok: true })
  h.deadline.mockReturnValue(false)
})
afterEach(() => {
  if (prevSecret === undefined) delete process.env.NEXTAUTH_SECRET
  else process.env.NEXTAUTH_SECRET = prevSecret
})

describe('proposeTrade', () => {
  it('builds a card for the offer and sends NOTHING', async () => {
    const out = await proposeTrade({ leagueId: 'L1', userId: 'u1', give: ["ja'marr chase"], get: ['Justin Jefferson'], now: NOW })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.card.trade).toMatchObject({
      partnerTeamName: 'Jordan’s Juggernauts',
      youGive: [{ name: "Ja'Marr Chase" }],
      youGet: [{ name: 'Justin Jefferson' }],
      reviewNote: expect.stringMatching(/commissioner reviews/),
    })
    expect(out.card.warnings.join(' ')).toMatch(/has to accept/)
    expect(out.text).toMatch(/NOTHING HAS BEEN SENT/)
    const v = verifyChimmyActionToken(out.card.token, NOW)
    expect(v.ok && v.payload.spec).toEqual({
      kind: 'trade',
      proposerRosterId: 'r1',
      receiverRosterId: 'r2',
      week: 5,
      season: 2026,
      assets: [
        { playerId: 'p1', fromRosterId: 'r1', toRosterId: 'r2' },
        { playerId: 'p9', fromRosterId: 'r2', toRosterId: 'r1' },
      ],
    })
    expect(h.create).not.toHaveBeenCalled()
  })

  it('refuses an imported league and points to the platform', async () => {
    h.leagueFindUnique.mockResolvedValue({ ...LEAGUE, platform: 'sleeper' })
    const out = await proposeTrade({ leagueId: 'L1', userId: 'u1', give: ["Ja'Marr Chase"], get: ['Justin Jefferson'], now: NOW })
    expect(out).toMatchObject({ ok: false, text: expect.stringMatching(/Send the offer in Sleeper/) })
    expect(h.create).not.toHaveBeenCalled()
  })

  it('refuses a team with no manager to receive it', async () => {
    const out = await proposeTrade({ leagueId: 'L1', userId: 'u1', give: ["Ja'Marr Chase"], get: ['Travis Kelce'], now: NOW })
    expect(out).toMatchObject({ ok: false, text: expect.stringMatching(/no AllFantasy manager/) })
  })

  it('refuses past the trade deadline', async () => {
    h.deadline.mockReturnValue(true)
    const out = await proposeTrade({ leagueId: 'L1', userId: 'u1', give: ["Ja'Marr Chase"], get: ['Justin Jefferson'], now: NOW })
    expect(out).toMatchObject({ ok: false, text: expect.stringMatching(/deadline has passed/) })
  })

  it("relays the engine validator's refusal", async () => {
    h.validate.mockReturnValue({ ok: false, code: 'TRADES_DISABLED', message: 'Trades are disabled for this league format or settings.' })
    const out = await proposeTrade({ leagueId: 'L1', userId: 'u1', give: ["Ja'Marr Chase"], get: ['Justin Jefferson'], now: NOW })
    expect(out).toMatchObject({ ok: false, text: expect.stringMatching(/Trades are disabled/) })
  })

  it('refuses picks — players only through Chimmy', async () => {
    const out = await proposeTrade({ leagueId: 'L1', userId: 'u1', give: ['2027 1st'], get: ['Justin Jefferson'], now: NOW })
    expect(out).toMatchObject({ ok: false, text: expect.stringMatching(/Trade Center/) })
    expect(h.leagueFindUnique).not.toHaveBeenCalled()
  })

  it('refuses players that come from more than one team', async () => {
    h.rosterFindMany.mockResolvedValue([MINE, THEIRS, { ...OPEN, platformUserId: 'u3' }])
    const out = await proposeTrade({ leagueId: 'L1', userId: 'u1', give: ["Ja'Marr Chase"], get: ['Justin Jefferson', 'Travis Kelce'], now: NOW })
    expect(out).toMatchObject({ ok: false, text: expect.stringMatching(/ONE other team/) })
  })
})

describe('executeTradeAction', () => {
  async function payload() {
    const out = await proposeTrade({ leagueId: 'L1', userId: 'u1', give: ["Ja'Marr Chase"], get: ['Justin Jefferson'], now: NOW })
    if (!out.ok) throw new Error(out.text)
    const v = verifyChimmyActionToken(out.card.token, NOW)
    if (!v.ok) throw new Error('token')
    return v.payload
  }

  it("creates the offer through the Trade Center's service, as the user, with the league week", async () => {
    const p = await payload()
    const r = await executeTradeAction(p, 'u1')
    expect(r).toEqual({ ok: true, tradeId: 'T1', message: expect.any(String) })
    expect(h.create).toHaveBeenCalledWith({
      leagueId: 'L1',
      proposedByUserId: 'u1',
      proposerRosterId: 'r1',
      receiverRosterId: 'r2',
      assets: [
        { itemType: 'player', itemReference: 'p1', fromRosterId: 'r1', toRosterId: 'r2' },
        { itemType: 'player', itemReference: 'p9', fromRosterId: 'r2', toRosterId: 'r1' },
      ],
      currentWeek: 5,
      metadata: { source: 'chimmy', chimmyActionId: p.actionId },
    })
  })

  it("relays the service's refusal and says nothing was sent", async () => {
    const p = await payload()
    h.create.mockRejectedValueOnce(new Error('Trade deadline has passed.'))
    expect(await executeTradeAction(p, 'u1')).toEqual({ ok: false, message: 'Nothing was sent: Trade deadline has passed.' })
  })

  it('refuses when the card is not for this user’s team', async () => {
    const p = await payload()
    h.rosterFindFirst.mockImplementation(async ({ where }: { where: { platformUserId?: string } }) =>
      where.platformUserId === 'u2' ? THEIRS : null,
    )
    expect(await executeTradeAction(p, 'u2')).toMatchObject({ ok: false })
    expect(h.create).not.toHaveBeenCalled()
  })
})
