import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 🛑 THE REDRAFT TRADE CENTER ENFORCED THE DEADLINE AND `lockAllMoves` ONLY FOR NFL (2026-10-19).
 *
 * `validateRedraftTradeProposalAtCreation` routes NFL redraft through the NFL runtime, which checks
 * both. Every other sport took the ownership fallback, which checked neither — an NBA league with
 * every move locked, or a deadline long passed, still accepted proposals.
 */

const h = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  seasonFindFirst: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: h.leagueFindUnique },
    redraftSeason: { findFirst: h.seasonFindFirst },
  },
}))
vi.mock('@/lib/trade-runtime', () => ({
  REDRAFT_DRAFT_PICK_REFUSAL: 'no picks',
  resolveNflRedraftTradeRuntime: vi.fn().mockResolvedValue({ ok: false, reason: 'not_nfl_redraft' }),
  validateNflRedraftTradeProposal: vi.fn(),
}))

import { validateRedraftTradeProposalAtCreation } from '@/lib/redraft/tradeProposalValidation'
import { buildEngineTestLeague } from '@/lib/engine-testing/fixtures/enginePayloadBuilders'

const db = {
  redraftRosterPlayer: {
    findMany: vi.fn().mockResolvedValue([
      { rosterId: 'ra', playerId: 'p1' },
      { rosterId: 'rb', playerId: 'p2' },
    ]),
  },
  redraftRoster: { findMany: vi.fn().mockResolvedValue([]) },
}

const input = {
  leagueId: 'l1',
  seasonId: 's1',
  proposerRosterId: 'ra',
  receiverRosterId: 'rb',
  assets: [
    { assetType: 'player', playerId: 'p1', fromRosterId: 'ra', toRosterId: 'rb' },
    { assetType: 'player', playerId: 'p2', fromRosterId: 'rb', toRosterId: 'ra' },
  ],
} as never

const nba = (over: Record<string, unknown> = {}) =>
  buildEngineTestLeague({ id: 'l1', sport: 'NBA', tradeDeadlineWeek: 10, lockAllMoves: false, ...over } as never)

beforeEach(() => {
  h.leagueFindUnique.mockResolvedValue(nba())
  h.seasonFindFirst.mockResolvedValue({ currentWeek: 6 })
})

describe('redraft proposal for a non-NFL sport', () => {
  it('control: an NBA proposal before the deadline is valid', async () => {
    await expect(validateRedraftTradeProposalAtCreation(input, db as never)).resolves.toMatchObject({ ok: true })
  })

  it('an NBA league with lockAllMoves refuses the proposal', async () => {
    h.leagueFindUnique.mockResolvedValue(nba({ lockAllMoves: true }))
    await expect(validateRedraftTradeProposalAtCreation(input, db as never)).resolves.toMatchObject({
      ok: false,
      code: 'MOVES_LOCKED',
    })
  })

  it('an NBA proposal after the deadline week (RedraftSeason.currentWeek) is refused', async () => {
    h.seasonFindFirst.mockResolvedValue({ currentWeek: 11 })
    const r = await validateRedraftTradeProposalAtCreation(input, db as never)
    expect(r).toMatchObject({ ok: false, code: 'TRADE_DEADLINE' })
    expect(h.seasonFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 's1', leagueId: 'l1' } }))
  })

  it('no deadline configured: no deadline applies', async () => {
    h.leagueFindUnique.mockResolvedValue(nba({ tradeDeadlineWeek: null }))
    h.seasonFindFirst.mockResolvedValue({ currentWeek: 30 })
    await expect(validateRedraftTradeProposalAtCreation(input, db as never)).resolves.toMatchObject({ ok: true })
  })
})
