import { describe, expect, it } from 'vitest'
import { extractNbaDraftSeasonRates } from '@/lib/draft-room/sportsPlayerRecordDraftEnrichment'
import { normalizeDraftPlayer } from '@/lib/draft-sports-models/normalize-draft-player'

describe('NBA draft season rates', () => {
  it('divides season totals by games before displaying per-game values', () => {
    const rates = extractNbaDraftSeasonRates({
      games_played: 80,
      points: 2080,
      total_rebounds: 640,
      minutes: 2560,
    })
    expect(rates).toEqual({ pointsPerGame: 26, reboundsPerGame: 8, minutesPerGame: 32 })
    const player = normalizeDraftPlayer({
      name: 'Example Player', position: 'PG', team: 'BOS', nbaDraftStats: rates,
    }, 'NBA')
    expect(player.display.stats.pointsPerGame).toBe(26)
    expect(player.display.stats.reboundsPerGame).toBe(8)
    expect(player.display.stats.minutesPerGame).toBe(32)
  })

  it('uses explicit rates and refuses totals without a games denominator', () => {
    expect(extractNbaDraftSeasonRates({ points_per_game: 24.6, rebounds_per_game: 6.4, minutes_per_game: 31.2 }))
      .toEqual({ pointsPerGame: 24.6, reboundsPerGame: 6.4, minutesPerGame: 31.2 })
    expect(extractNbaDraftSeasonRates({ points: 2200, total_rebounds: 500, minutes: 2400 })).toBeNull()
  })
})
