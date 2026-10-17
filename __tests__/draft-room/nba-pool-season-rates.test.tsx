import { describe, expect, it } from 'vitest'
import { extractNbaDraftSeasonRates } from '@/lib/draft-room/sportsPlayerRecordDraftEnrichment'
import { normalizeDraftPlayer } from '@/lib/draft-sports-models/normalize-draft-player'
import { dedupeEnrichedRawRows } from '@/lib/draft-room/getResolvedDraftPoolForLeague'
import { render, screen } from '@testing-library/react'
import { DraftPlayerCard } from '@/components/app/draft-room/DraftPlayerCard'

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

  it('reads documented season-stat labels without mistaking totals for rates', () => {
    expect(extractNbaDraftSeasonRates({ season_stats: {
      'Games Played': '72', Points: '1800', 'Total Rebounds': '576', 'Minutes Played': '2304',
    } })).toEqual({ pointsPerGame: 25, reboundsPerGame: 8, minutesPerGame: 32 })
  })

  it('offers a dual-position NBA player once while preserving namesakes on other clubs', () => {
    const rows = dedupeEnrichedRawRows([
      { name: 'Example Forward', position: 'C', team: 'DEN', adp: null, nbaDraftStats: { pointsPerGame: 20, reboundsPerGame: 8, minutesPerGame: 30 } },
      { name: 'Example Forward', position: 'PF', team: 'DEN', adp: 40 },
      { name: 'Example Forward', position: 'PF', team: 'BOS', adp: null },
    ], 'NBA')
    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.team === 'DEN')?.adp).toBe(40)
    expect(rows.find((row) => row.team === 'DEN')?.nbaDraftStats?.reboundsPerGame).toBe(8)
    expect(rows.find((row) => row.team === 'DEN')?.secondaryPositions).toContain('C')
  })

  it('shows cached NBA box-score rates on the compact player card', () => {
    const player = normalizeDraftPlayer({
      name: 'Example Guard', position: 'PG', team: 'BOS',
      nbaDraftStats: { pointsPerGame: 25, reboundsPerGame: 6.5, minutesPerGame: 34.2 },
    }, 'NBA')
    render(<DraftPlayerCard name="Example Guard" position="PG" team="BOS" draftSport="NBA" variant="card" display={player.display} />)
    expect(screen.getByText('PPG 25.0 · RPG 6.5 · MPG 34.2')).toBeInTheDocument()
  })
})
