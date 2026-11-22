/**
 * The rookie draft order seats EVERY team, including one nobody has claimed.
 *
 * An unclaimed team still holds a draft slot. Dropping it left the Draft tab previewing a league of 4
 * as a single team labelled "Champion", and gave the draft an order that could not seat every roster.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ leagueFindUnique: vi.fn(), rosterFindMany: vi.fn(async () => []), loadInput: vi.fn(async () => null) }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: m.leagueFindUnique }, roster: { findMany: m.rosterFindMany } } }))
vi.mock('@/lib/rookie-order/loadRookieOrderInput', () => ({ loadRookieOrderInput: m.loadInput }))

import { computeRookieDraftOrder } from '@/lib/league/rookieDraftOrder'

const team = (id: string, wins: number, pointsFor: number, over: Record<string, unknown> = {}) => ({
  id, teamName: id, ownerName: id, avatarUrl: null, wins, losses: 22 - wins, ties: 0, pointsFor,
  currentRank: null, isOrphan: false, claimedByUserId: `u-${id}`, externalId: `r-${id}`, platformUserId: `u-${id}`, ...over,
})
const orphan = (id: string, wins: number, pointsFor: number) => team(id, wins, pointsFor, { isOrphan: true, claimedByUserId: null, ownerName: 'Open team' })

beforeEach(() => {
  vi.clearAllMocks()
  m.loadInput.mockResolvedValue(null)
  m.leagueFindUnique.mockResolvedValue({
    id: 'L', season: 2026, leagueSize: 4, settings: { playoff_teams: 2 },
    // No season to read here, so the fallback sort runs: the playoff teams go by their stored rank.
    teams: [team('Claimed', 15, 2519, { currentRank: 1 }), { ...orphan('Open 2', 15, 2451), currentRank: 2 }, orphan('Open 4', 8, 2311), orphan('Open 3', 6, 2269)],
  })
})

describe('computeRookieDraftOrder with unclaimed teams', () => {
  it('seats all four teams, worst record first, with the unclaimed ones in their places', async () => {
    const order = await computeRookieDraftOrder('L', 'worst_to_first')
    expect(order.slots.map((s) => s.teamName)).toEqual(['Open 3', 'Open 4', 'Open 2', 'Claimed'])
    expect(order.slots.map((s) => s.slot)).toEqual([1, 2, 3, 4])
    expect(order).toMatchObject({ nonPlayoffTeamCount: 2, playoffTeamCount: 2 })
  })

  it('a league of nothing but unclaimed teams still has an order', async () => {
    m.leagueFindUnique.mockResolvedValue({ id: 'L', season: 2026, leagueSize: 2, settings: {}, teams: [orphan('A', 9, 100), orphan('B', 3, 90)] })
    const order = await computeRookieDraftOrder('L', 'worst_to_first')
    expect(order.slots).toHaveLength(2)
    expect(order.warning).toBeNull()
  })
})
