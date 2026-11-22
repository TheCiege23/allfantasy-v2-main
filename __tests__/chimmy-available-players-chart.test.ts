/**
 * "Who's available" ranks on the league's own value chart first (Player Value OS, 2026-11-20 re-score push).
 *
 * It ranked on the AllFantasy house set (165 rows, all dynasty), so a value quoted in the list was a different number
 * from the one the player card, get_player_value and the trade screens show — all of which read the league's chart
 * (`valueBookFor`). Pinned: the chart is used, ranked by its value, rostered players removed; a redraft chart is not
 * called "long-term asset worth"; with no chart (or too few free players) the existing house/FantasyCalc paths answer.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({
  leagueFind: vi.fn(),
  rosterFindMany: vi.fn(),
  valueFindMany: vi.fn(),
  chartFirst: vi.fn(),
  chartMany: vi.fn(),
  fantasyCalc: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: h.leagueFind },
    roster: { findMany: h.rosterFindMany },
    allFantasyMarketPlayerValue: { findMany: h.valueFindMany },
    playerValueSnapshot: { findFirst: h.chartFirst, findMany: h.chartMany },
  },
}))
vi.mock('@/lib/fantasycalc-db', () => ({ getFantasyCalcValuesDbFirst: h.fantasyCalc }))
vi.mock('@/lib/chimmy/tools/availablePlayersOtherSports', () => ({ buildOtherSportAvailableContext: vi.fn() }))
vi.mock('@/lib/decision-os/waiver/pool', () => ({
  excludeUntranslatedEspn: async () => ({ hides: () => false, summary: () => null }),
}))

import { buildAvailablePlayersContext } from '@/lib/chimmy/tools/availablePlayersTool'

const CAPTURED = new Date('2026-11-19T06:00:00Z')
const chartRow = (sleeperId: string, name: string, position: string, value: number) => ({ sleeperId, name, position, value })
const CHART = [
  chartRow('9488', 'Jaxon Smith-Njigba', 'WR', 9100),
  chartRow('12527', 'Ashton Jeanty', 'RB', 8800),
  chartRow('500', 'Free Agent One', 'WR', 4200),
  chartRow('501', 'Free Agent Two', 'RB', 3900),
  chartRow('502', 'Free Agent Three', 'TE', 3100),
  chartRow('503', 'Free Agent Four', 'QB', 2800),
  chartRow('504', 'Free Agent Five', 'WR', 2500),
]

beforeEach(() => {
  vi.resetAllMocks()
  h.leagueFind.mockResolvedValue({ name: 'Sunday League', sport: 'NFL', isDynasty: false, leagueType: 'redraft', settings: {} })
  h.rosterFindMany.mockResolvedValue([{ playerData: { players: ['9488', '12527'] } }])
  h.valueFindMany.mockResolvedValue([])
  h.fantasyCalc.mockResolvedValue([])
  h.chartFirst.mockResolvedValue({ capturedAt: CAPTURED })
  h.chartMany.mockResolvedValue(CHART)
})

describe("who's available, on the league's chart", () => {
  it("ranks unrostered players by the league's chart value — the number the player card shows", async () => {
    const out = await buildAvailablePlayersContext('L1', 'U1')
    expect(out).toContain("highest value on this league's chart (redraft, one-QB) first — the same values the player card shows")
    expect(out).toContain('Free Agent One (WR) — value 4200')
    expect(out.indexOf('Free Agent One')).toBeLessThan(out.indexOf('Free Agent Two'))
    expect(out).not.toContain('Jaxon Smith-Njigba')
    expect(out).not.toContain('Ashton Jeanty')
    expect(out).toContain('5 of the 7 players on the chart')
    // The house set is never read when the chart answers.
    expect(h.valueFindMany).not.toHaveBeenCalled()
  })

  it('reads the chart this league prices on, at its latest capture', async () => {
    await buildAvailablePlayersContext('L1', 'U1')
    expect(h.chartFirst.mock.calls[0]![0].where).toEqual({ source: 'FANTASYCALC', format: 'REDRAFT', qbFormat: 'ONE_QB' })
    expect(h.chartMany.mock.calls[0]![0].where).toMatchObject({ capturedAt: CAPTURED })
  })

  it('a redraft chart is not described as long-term asset worth', async () => {
    const out = await buildAvailablePlayersContext('L1', 'U1')
    expect(out).toContain('3. These are this-season (redraft) chart values')
    expect(out).not.toContain('long-term asset worth')
  })

  it('no chart capture falls back to the existing paths', async () => {
    h.chartFirst.mockResolvedValue(null)
    h.valueFindMany.mockResolvedValue([{ playerId: '777', playerName: 'House Player', position: 'WR', marketValue: 5000, leagueConcept: 'dynasty' }])
    const out = await buildAvailablePlayersContext('L1', 'U1')
    expect(h.valueFindMany).toHaveBeenCalled()
    expect(out).not.toContain("on this league's chart")
  })

  it('too few free players on the chart falls back too, rather than a two-name list', async () => {
    h.chartMany.mockResolvedValue(CHART.slice(0, 3))
    await buildAvailablePlayersContext('L1', 'U1')
    expect(h.valueFindMany).toHaveBeenCalled()
  })
})
