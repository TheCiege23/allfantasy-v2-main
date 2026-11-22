import { describe, expect, it } from 'vitest'
import { NBA_VERIFIED_BOX_SOURCE, pickNbaVerifiedSeasonLines, readVerifiedNbaInactiveSince } from '@/lib/af-projections/nbaVerifiedSeasonLines'

const line = (playerId: string, source: string, gamesPlayed: number, minutes: number, providerSeconds?: number) => ({
  playerId, source, stats: {
    regular_season: { games_played: gamesPlayed, minutes, points: 148 },
    ...(providerSeconds === undefined ? {} : { providerAtVerification: { seconds: providerSeconds } }),
  },
})

describe('reviewed NBA season lines', () => {
  const reviewed = line('wesley', NBA_VERIFIED_BOX_SOURCE, 31, 21649.1, 21650)
  const original = line('wesley', 'rolling_insights', 32, 21650)

  it('uses the official count when the vendor counted an extra DNP', () => {
    expect(pickNbaVerifiedSeasonLines([original, reviewed])).toEqual([reviewed])
    expect(pickNbaVerifiedSeasonLines([reviewed, original])).toEqual([reviewed])
  })

  it('keeps a verified inactive date through DNP refreshes and drops it after NBA play resumes', () => {
    const current = line('wesley', NBA_VERIFIED_BOX_SOURCE, 2, 566, 566)
    const reviewed = { ...current, stats: { ...current.stats, verifiedNbaInactiveSince: '2026-11-09' } }
    const dnp = line('wesley', 'rolling_insights', 3, 566)
    expect(readVerifiedNbaInactiveSince(pickNbaVerifiedSeasonLines([dnp, reviewed])[0]?.stats)).toBe('2026-11-09')
    const resumed = line('wesley', 'rolling_insights', 3, 720)
    expect(readVerifiedNbaInactiveSince(pickNbaVerifiedSeasonLines([resumed, reviewed])[0]?.stats)).toBeUndefined()
  })

  it('lets actual new playing time replace an older review', () => {
    const later = line('wesley', 'rolling_insights', 32, 21900)
    const unchanged = line('unreviewed', 'rolling_insights', 8, 1500)
    expect(pickNbaVerifiedSeasonLines([reviewed, later, unchanged, original])).toEqual([unchanged, later])
  })

  it('ignores malformed or zero-minute official rows', () => {
    const invalid = line('wesley', NBA_VERIFIED_BOX_SOURCE, 31, 0, 21650)
    expect(pickNbaVerifiedSeasonLines([invalid, original])).toEqual([original])
  })
})
