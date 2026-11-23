/**
 * get_player_value / explain_value in an NFL league quote the PLAYER CARD's number (2026-11-23).
 *
 * The in-league branch used to read `loadLeaguePlayerMetrics`, whose NFL value is the house trade-market table
 * (`allFantasyMarketPlayerValue`, 5+ fresh completed trades). The card shows `playerValueSnapshot` on the league's
 * chart. Here both books AND the house table hold a different number for one player, so only the card's read on
 * the league's own book can produce the expected figure.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const CAPTURED = new Date('2026-11-20T00:00:00Z')
const SNAPSHOTS = [
  // The league's book (redraft, one-QB) — the number the card shows in this league.
  { sleeperId: '4984', name: 'Josh Allen', position: 'QB', source: 'FANTASYCALC', format: 'REDRAFT', qbFormat: 'ONE_QB', value: 7111, overallRank: 3, positionRank: 1, capturedAt: CAPTURED },
  // The cross-league book (dynasty, superflex) — what a league-less read would quote instead.
  { sleeperId: '4984', name: 'Josh Allen', position: 'QB', source: 'FANTASYCALC', format: 'DYNASTY', qbFormat: 'SUPERFLEX', value: 9555, overallRank: 1, positionRank: 1, capturedAt: CAPTURED },
]
const HOUSE_VALUE = 4321

const h = vi.hoisted(() => ({ metrics: vi.fn(), league: vi.fn() }))

function matches(row: Record<string, unknown>, where: Record<string, unknown> = {}) {
  return Object.entries(where).every(([k, v]) =>
    v instanceof Date ? (row[k] as Date).getTime() === v.getTime() : row[k] === v)
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: h.league },
    playerValueSnapshot: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const hit = SNAPSHOTS.filter((r) => matches(r, where))
        return hit.length ? { capturedAt: hit[0]!.capturedAt } : null
      }),
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => SNAPSHOTS.filter((r) => matches(r, where))),
    },
    allFantasyMarketPlayerValue: {
      findMany: vi.fn(async () => [
        { playerId: 'p1', playerName: 'Josh Allen', position: 'QB', team: 'BUF', marketValue: HOUSE_VALUE, leagueConcept: 'redraft', scoringFormat: null, confidence: 0.8 },
      ]),
    },
  },
}))
vi.mock('@/lib/af-projections/leaguePlayerMetrics', () => ({ loadLeaguePlayerMetrics: h.metrics }))
vi.mock('@/lib/af-projections/readAfProjections', () => ({ findAfProjectionsByName: vi.fn(async () => ({ rows: [], season: null })) }))

import { executeChimmyTool, type ChimmyToolContext } from '@/lib/chimmy/tools/chimmyTools'
import { loadPlayerMarketValue } from '@/lib/core-app/playerMarketValue'
import { valueBookFor } from '@/lib/core-app/valueBook'

const LEAGUE = { sport: 'NFL', settings: {}, leagueType: 'redraft' }
const ctx = { leagueId: 'NFL-L1', userId: 'u1' } as ChimmyToolContext

beforeEach(() => {
  vi.clearAllMocks()
  h.league.mockResolvedValue(LEAGUE)
  // The old path: the house trade-market value, through the league metrics.
  h.metrics.mockResolvedValue({
    sport: 'NFL',
    rows: [{ playerName: 'Josh Allen', tradeValue: HOUSE_VALUE, dynastyTradeValue: null, tradeValueUnit: 'market points', completedTradeSample: 6 }],
  })
})

/** What the card shows for him in this league: its own reader, on the book it derives (playerCard.ts). */
async function cardValue(): Promise<number> {
  const market = await loadPlayerMarketValue('4984', 'QB', valueBookFor(LEAGUE.settings, LEAGUE.leagueType))
  if (!market.available) throw new Error('fixture: card has no value')
  return market.data.value
}

describe('an NFL league quotes the card’s number', () => {
  it('get_player_value equals the card reader’s value for the same player', async () => {
    const card = await cardValue()
    expect(card).toBe(7111)
    const out = await executeChimmyTool('get_player_value', { player: 'Josh Allen' }, ctx)
    expect(out).toContain(`market value on this league's chart (redraft, one-QB): ${card.toLocaleString()}`)
    expect(out).toContain('SAME number his player card shows')
    // Not the cross-league book, and the house value only as the separately-labelled second measure.
    expect(out).not.toContain((9555).toLocaleString())
    expect(out).not.toContain(`AF trade value of ${HOUSE_VALUE}`)
    expect(h.metrics).not.toHaveBeenCalled()
  })

  it('explain_value leads with the same card number, then the derivation labelled as a different thing', async () => {
    const card = await cardValue()
    const out = await executeChimmyTool('explain_value', { player: 'Josh Allen' }, ctx)
    expect(out.split('\n')[0]).toContain(`: ${card.toLocaleString()}`)
    expect(out).toContain('WHY — the AllFantasy engine')
    expect(out).toContain('Derivation for Josh Allen')
    expect(h.metrics).not.toHaveBeenCalled()
  })

  it('a sport asked for that is not the league’s is refused, not answered from another chart', async () => {
    const out = await executeChimmyTool('get_player_value', { player: 'Josh Allen', sport: 'NBA' }, ctx)
    expect(out).toBe('The requested sport differs from the connected league.')
  })

  it('a board-sport league still reads the league metrics', async () => {
    h.league.mockResolvedValue({ sport: 'NBA', settings: {}, leagueType: 'redraft' })
    h.metrics.mockResolvedValue({ sport: 'NBA', rows: [{ playerName: 'Nikola Jokic', tradeValue: 125, tradeValueUnit: 'fantasy points over replacement' }] })
    const out = await executeChimmyTool('get_player_value', { player: 'Nikola Jokic' }, { leagueId: 'NBA-L1', userId: 'u1' } as ChimmyToolContext)
    expect(out).toContain('AF trade value of 125.00 fantasy points over replacement')
    expect(h.metrics).toHaveBeenCalledTimes(1)
  })
})
