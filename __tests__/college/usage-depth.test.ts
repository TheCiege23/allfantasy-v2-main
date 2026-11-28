// @vitest-environment node
/**
 * College football has no published depth charts from either provider (Rolling Insights 404, CFBD has no
 * endpoint; probed 2026-11-26), so a player's place comes from his school's box scores
 * (lib/college/usageDepth.ts). Names and numbers below are Ohio State's last four games, read from
 * production the same day.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { rankSchoolUsage, usageDepthNote, usageNameKey, usageStatForPosition, type UsageGameRow } from '@/lib/college/usageDepth'
import { bridgeRiToCfbd, indexUsageDepthRows, usageForSchool } from '@/lib/college/usageDepthStore'

const game = (name: string, gameDate: string, s: Partial<UsageGameRow> = {}): UsageGameRow => ({ school: 'Ohio State', name, gameDate, att: 0, car: 0, rec: 0, ...s })
const dates = ['2026-10-31', '2026-11-07', '2026-11-14', '2026-11-21']
const rows: UsageGameRow[] = [
  ...dates.map((d) => game('Luke Fahey', d, { att: 36, car: 5 })),
  ...dates.map((d) => game('Bo Jackson', d, { car: 16, rec: 4 })),
  ...dates.map((d) => game('Jeremiah Smith', d, { rec: 8 })),
  game('Isaiah West', '2026-11-21', { car: 29 }), // one big game
  game('Devin McCuin', '2026-11-14', { rec: 13 }),
  // A game outside the last four does not count.
  game('Old Starter', '2026-10-24', { car: 40 }),
]

describe('ranking a school by usage', () => {
  const usage = rankSchoolUsage(rows).get('Ohio State')!

  it('uses the school\'s last four games', () => {
    expect(usage.games).toBe(4)
    expect(usage.byStat.car.map((r) => r.name)).not.toContain('Old Starter')
  })

  it('ranks carries, catches and pass attempts separately, and a missed game counts as zero', () => {
    expect(usage.byStat.att.map((r) => [r.name, r.rank, r.total])).toEqual([['Luke Fahey', 1, 144]])
    expect(usage.byStat.car.map((r) => [r.name, r.rank])).toEqual([['Bo Jackson', 1], ['Isaiah West', 2], ['Luke Fahey', 3]])
    expect(usage.byStat.rec.map((r) => [r.name, r.rank, r.perGame])).toEqual([['Jeremiah Smith', 1, 8], ['Bo Jackson', 2, 4], ['Devin McCuin', 3, 3.3]])
  })

  it('gives each player his share of the school total', () => {
    const smith = usage.byStat.rec[0]!
    expect(smith.share).toBeCloseTo(32 / (32 + 16 + 13))
  })
})

describe('the card line', () => {
  const usage = rankSchoolUsage(rows).get('Ohio State')!

  it('names the place, the stat, the window and the share, by position', () => {
    expect(usageDepthNote({ position: 'QB', name: 'Luke Fahey', schoolLabel: 'Ohio State', usage })).toBe('QB1 at Ohio State: 1st in pass attempts, last 4 games (36 a game, 100%)')
    expect(usageDepthNote({ position: 'RB', name: 'Isaiah West', schoolLabel: 'Ohio State', usage })).toBe('RB2 at Ohio State: 2nd in carries, last 4 games (7.3 a game, 26%)') // 29 of 113
    expect(usageDepthNote({ position: 'WR', name: 'Jeremiah Smith', schoolLabel: 'Ohio State', usage })).toBe('1st at Ohio State in catches, last 4 games (8 a game, 52%)')
  })

  it('matches names through case, accents and suffixes', () => {
    expect(usageNameKey('Chris Henry Jr.')).toBe(usageNameKey('chris henry'))
    expect(usageDepthNote({ position: 'WR', name: 'devin mccuin', schoolLabel: 'Ohio State', usage })).toMatch(/^3rd at Ohio State/)
  })

  it('says nothing for a player with no usage, a position with no usage stat, or no school data', () => {
    expect(usageDepthNote({ position: 'WR', name: 'Nobody', schoolLabel: 'Ohio State', usage })).toBeNull()
    expect(usageDepthNote({ position: 'K', name: 'Luke Fahey', schoolLabel: 'Ohio State', usage })).toBeNull()
    expect(usageDepthNote({ position: 'QB', name: 'Luke Fahey', schoolLabel: 'Ohio State', usage: null })).toBeNull()
    expect(usageStatForPosition('TE')).toBe('rec')
  })
})

describe('reading the stored rows and naming the school either way', () => {
  const stored = [...rankSchoolUsage(rows).entries()].flatMap(([team, u]) =>
    (['att', 'car', 'rec'] as const).map((position) => ({ team, position, players: { games: u.games, ranks: u.byStat[position] } })),
  )
  const index = {
    bySchool: indexUsageDepthRows([...stored, { team: 'Ohio State', position: 'junk', players: null }]),
    riToCfbd: bridgeRiToCfbd(
      [{ name: 'Ohio State University', shortName: 'OSU' }, { name: 'Boise State University', shortName: 'BSU' }],
      [{ name: 'Ohio State', shortName: 'OSU' }, { name: 'Boise State', shortName: 'BOIS' }],
    ),
  }

  it('round-trips what the writer stores', () => {
    expect(index.bySchool.get('ohio state')?.byStat.rec[0]?.name).toBe('Jeremiah Smith')
  })

  it("finds a school by CFBD's name or Rolling Insights' full name, by code first, then by name", () => {
    expect(usageForSchool(index, 'Ohio State')?.label).toBe('Ohio State')
    expect(usageForSchool(index, 'Ohio State University')?.label).toBe('Ohio State')
    expect(index.riToCfbd.get('boise state university')).toBe('Boise State') // codes differ (BSU / BOIS)
    expect(usageForSchool(index, 'Nowhere Tech')).toBeNull()
  })
})
