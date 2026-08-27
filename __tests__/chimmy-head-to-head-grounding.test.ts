import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  findUnique: vi.fn(),
  getLeagueH2H: vi.fn(),
  getImportedLeagueH2H: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: h.findUnique } } }))
vi.mock('@/lib/league-history/sleeperH2HService', () => ({ getLeagueH2H: h.getLeagueH2H }))
vi.mock('@/lib/league-history/importedFactsH2HService', () => ({
  getImportedLeagueH2H: h.getImportedLeagueH2H,
}))

import { buildHeadToHeadGrounding } from '@/lib/chimmy/headToHeadGrounding'

function payload(over: Record<string, unknown> = {}) {
  return {
    version: 2,
    fetchedAt: '2026-08-25T00:00:00.000Z',
    staleAsOf: null,
    sleeperLeagueId: 'sl-1',
    seasons: ['2024', '2025'],
    totalGames: 40,
    records: {},
    latestWeekAwards: null,
    missing: [],
    managers: [
      {
        ownerId: 'a',
        name: 'Casey',
        avatar: null,
        teamName: 'Team Casey',
        games: 20,
        avgPoints: 118.4,
        high: 160,
        low: 70,
        stdev: 20,
        topHalfPct: 0.5,
        trend: 'up',
        byOpponent: [
          { opponentOwnerId: 'b', wins: 3, losses: 1, ties: 0, avgMargin: 12, closest: null },
          { opponentOwnerId: 'c', wins: 1, losses: 1, ties: 1, avgMargin: 2, closest: null },
        ],
      },
      {
        ownerId: 'b',
        name: 'Jordan',
        avatar: null,
        teamName: null,
        games: 18,
        avgPoints: 110,
        high: 150,
        low: 60,
        stdev: 18,
        topHalfPct: 0.4,
        trend: 'flat',
        byOpponent: [
          { opponentOwnerId: 'a', wins: 1, losses: 3, ties: 0, avgMargin: -12, closest: null },
        ],
      },
    ],
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.findUnique.mockResolvedValue({ platform: 'sleeper', platformLeagueId: 'sl-1' })
  h.getLeagueH2H.mockResolvedValue(payload())
  h.getImportedLeagueH2H.mockResolvedValue(null)
})

describe('buildHeadToHeadGrounding', () => {
  it('names both managers and their record', async () => {
    const out = await buildHeadToHeadGrounding('l1')

    expect(out?.text).toContain('Casey')
    expect(out?.text).toContain('Jordan 3-1')
    expect(out?.source).toBe('sleeper')
  })

  it('writes a tie into the record rather than dropping it', async () => {
    const out = await buildHeadToHeadGrounding('l1')
    expect(out?.text).toMatch(/1-1-1/)
  })

  /*
   * A Sleeper league walks the live chain; everything else reads the imported
   * facts. Getting this backwards returns an empty record for a league with
   * years of history.
   */
  it('reads the imported facts for a non-Sleeper league', async () => {
    h.findUnique.mockResolvedValue({ platform: 'yahoo', platformLeagueId: null })
    h.getImportedLeagueH2H.mockResolvedValue(payload())

    const out = await buildHeadToHeadGrounding('l1')

    expect(out?.source).toBe('imported-facts')
    expect(h.getLeagueH2H).not.toHaveBeenCalled()
  })

  it('uses the imported facts when a sleeper league has no platform id', async () => {
    h.findUnique.mockResolvedValue({ platform: 'sleeper', platformLeagueId: null })
    h.getImportedLeagueH2H.mockResolvedValue(payload())

    expect((await buildHeadToHeadGrounding('l1'))?.source).toBe('imported-facts')
  })

  /*
   * Roughly half the leagues in production have no matchup facts. A fabricated
   * 0-0 about a real rivalry is exactly what this grounding exists to prevent.
   */
  it('returns nothing at all when the league has no history', async () => {
    h.findUnique.mockResolvedValue({ platform: 'yahoo', platformLeagueId: null })
    h.getImportedLeagueH2H.mockResolvedValue(null)

    expect(await buildHeadToHeadGrounding('l1')).toBeNull()
  })

  it('returns nothing when the payload has no managers', async () => {
    h.getLeagueH2H.mockResolvedValue(payload({ managers: [] }))
    expect(await buildHeadToHeadGrounding('l1')).toBeNull()
  })

  it('returns nothing for a league that does not exist', async () => {
    h.findUnique.mockResolvedValue(null)
    expect(await buildHeadToHeadGrounding('l1')).toBeNull()
  })

  /* A record built from a partial history is useful; pretending it is complete is not. */
  it('says so when the service could not resolve everything', async () => {
    h.getLeagueH2H.mockResolvedValue(payload({ missing: ['2023', '2022'] }))

    const out = await buildHeadToHeadGrounding('l1')

    expect(out?.text).toContain('INCOMPLETE')
    expect(out?.text).toContain('2 season')
  })

  it('forbids extrapolating a pairing it did not list', async () => {
    const out = await buildHeadToHeadGrounding('l1')
    expect(out?.text).toMatch(/Do not extrapolate/i)
  })

  it('names the person asking when it knows', async () => {
    const out = await buildHeadToHeadGrounding('l1', 'Casey')
    expect(out?.text).toContain('The person asking is Casey.')
  })

  /* "Who you play most" is the rivalry; "who you beat" is a different question. */
  it('puts the most-played opponent first', async () => {
    const out = await buildHeadToHeadGrounding('l1')
    const caseyLine = out!.text.split('\n').find((l) => l.startsWith('- Casey'))!
    expect(caseyLine.indexOf('Jordan')).toBeLessThan(caseyLine.indexOf('Unknown'))
  })

  it('survives the history service throwing', async () => {
    h.getLeagueH2H.mockRejectedValue(new Error('sleeper down'))
    h.getImportedLeagueH2H.mockResolvedValue(null)

    expect(await buildHeadToHeadGrounding('l1')).toBeNull()
  })

  it('ignores an empty league id', async () => {
    expect(await buildHeadToHeadGrounding('')).toBeNull()
    expect(h.findUnique).not.toHaveBeenCalled()
  })
})
