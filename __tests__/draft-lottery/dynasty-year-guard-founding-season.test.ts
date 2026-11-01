/**
 * The weighted rookie lottery is refused in a dynasty league's startup year. "Startup" compared the
 * league's season against `createdAt.getFullYear()` — but a league is stamped with the season it
 * will PLAY, so an MLB league created in November 2026 is season 2027 and its startup year read as
 * year 2 (lottery wrongly allowed). The guard now uses the league's first RedraftSeason.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique } } }))

import { checkDynastyLotteryEligibility } from '@/lib/draft-lottery/dynastyYearGuard'

const league = (over: Record<string, unknown>) => ({
  isDynasty: true,
  leagueVariant: null,
  sport: 'MLB',
  settings: {},
  _count: { redraftDrafts: 0 },
  ...over,
})

beforeEach(() => findUnique.mockReset())

describe('dynasty lottery startup year', () => {
  it('MLB created after the 2026 season ended (stamped 2027) is still a startup in 2027', async () => {
    findUnique.mockResolvedValue(league({
      season: 2027,
      createdAt: new Date('2026-11-10T12:00:00Z'),
      redraftSeasons: [{ season: 2027 }],
    }))
    const r = await checkDynastyLotteryEligibility('l1')
    expect(r).toMatchObject({ eligible: false, isStartupLeague: true })
  })

  it('…and with no RedraftSeason row, the founding season is re-derived from createdAt', async () => {
    findUnique.mockResolvedValue(league({
      season: 2027,
      createdAt: new Date('2026-11-10T12:00:00Z'),
      redraftSeasons: [],
    }))
    const r = await checkDynastyLotteryEligibility('l1')
    expect(r).toMatchObject({ eligible: false, isStartupLeague: true })
  })

  it('does not allow a startup-year lottery just because the startup draft finished', async () => {
    findUnique.mockResolvedValue(league({ season: 2027, createdAt: new Date('2026-11-10T12:00:00Z'), redraftSeasons: [{ season: 2027 }], _count: { redraftDrafts: 1 } }))
    expect(await checkDynastyLotteryEligibility('l1')).toMatchObject({ eligible: false, isStartupLeague: true })
    expect(await checkDynastyLotteryEligibility('l1', 2028)).toMatchObject({ eligible: true, isStartupLeague: false })
  })

  it('the same league in 2028 (year 2) is eligible', async () => {
    findUnique.mockResolvedValue(league({
      season: 2028,
      createdAt: new Date('2026-11-10T12:00:00Z'),
      redraftSeasons: [{ season: 2027 }],
    }))
    const r = await checkDynastyLotteryEligibility('l1')
    expect(r).toMatchObject({ eligible: true, isStartupLeague: false })
  })

  it('NBA founded in the in-progress 2026 season (created Feb 2027) is year 2 in 2027', async () => {
    findUnique.mockResolvedValue(league({
      sport: 'NBA',
      season: 2027,
      createdAt: new Date('2027-02-10T12:00:00Z'),
      redraftSeasons: [{ season: 2026 }],
    }))
    const r = await checkDynastyLotteryEligibility('l1')
    expect(r).toMatchObject({ eligible: true, isStartupLeague: false })
  })
})
