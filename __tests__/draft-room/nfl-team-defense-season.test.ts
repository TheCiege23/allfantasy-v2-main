/**
 * Team defense (DEF) stats for the NFL draft pool (2026-11-20): SACK / INT / TD summed from the
 * team's defenders, PA/G from stored regular-season scores. Fumble recoveries stay empty on purpose.
 */
import { describe, expect, it } from 'vitest'
import { attachTeamDefenseStats, summarizeTeamDefense } from '@/lib/draft-room/nflTeamDefenseSeason'
import { getDraftStatColumnsForSport, getStatValueForDraftPlayer, formatDraftStatDisplay } from '@/lib/draft-room/draftSportStatColumns'
import { mockPoolPhoneStatLine, mockPoolStatCells } from '@/components/mock-draft/MockDraftSleeperRoomClient'

const defenders = [
  { team: 'LAR', stats: { sacks: 23, tackles: 60, interceptions: 1 } },
  { team: 'LAR', stats: { sacks: 7.5, interceptions: 4, interception_touchdowns: 1, defense_fumble_recoveries: 9 } },
  { team: 'Los Angeles Rams', stats: { sacks: 2, fumble_return_touchdowns: 1 } }, // a full name meets the code
  { team: 'BUF', stats: { sacks: 4 } },
  { team: null, stats: { sacks: 99 } }, // no team: ignored, never guessed
]
const games = [
  { homeTeam: 'Los Angeles Rams', awayTeam: 'Buffalo Bills', homeScore: 24, awayScore: 17, startTime: '2025-09-07T20:00:00Z' },
  // The same game from a second feed: counted once.
  { homeTeam: 'LAR', awayTeam: 'BUF', homeScore: 24, awayScore: 17, startTime: '2025-09-07T23:00:00Z' },
  { homeTeam: 'Buffalo Bills', awayTeam: 'Los Angeles Rams', homeScore: 30, awayScore: 10, startTime: '2025-09-14T20:00:00Z' },
  { homeTeam: 'Buffalo Bills', awayTeam: 'Miami Dolphins', homeScore: null, awayScore: null, startTime: '2025-09-21T20:00:00Z' }, // unplayed
]

describe('summarizeTeamDefense', () => {
  it('sums defenders by team and takes points allowed per game from the scores', () => {
    const out = summarizeTeamDefense(defenders, games)
    expect(out.get('LAR')).toEqual({ dst_sacks: 32.5, dst_interceptions: 5, dst_td: 2, dst_points_allowed_per_game: 23.5, games: 2 })
    expect(out.get('BUF')).toEqual({ dst_sacks: 4, dst_interceptions: 0, dst_td: 0, dst_points_allowed_per_game: 17, games: 2 })
    expect(out.has('MIA')).toBe(false)
  })
})

describe('attachTeamDefenseStats', () => {
  const byTeam = summarizeTeamDefense(defenders, games)

  it('fills the DEF columns on a defense row and leaves everyone else alone', () => {
    const def = { name: 'Rams D/ST', position: 'DEF', team: 'LAR', display: { stats: { fantasyPointsPerGame: null } } }
    const qb = { name: 'Josh Allen', position: 'QB', team: 'BUF', display: { stats: {} } }
    const [defOut, qbOut] = attachTeamDefenseStats([def, qb], byTeam)
    expect(qbOut).toBe(qb)
    const cols = getDraftStatColumnsForSport('NFL', { position: 'DEF' })
    const shown = Object.fromEntries(cols.map((c) => [c.label, formatDraftStatDisplay(getStatValueForDraftPlayer(defOut as never, c), c)]))
    expect(shown).toEqual({ PTS: '—', AVG: '—', SACK: '32.5', INT: '5', FR: '—', TD: '2', 'PA/G': '23.5' })
  })

  it('a defense whose team is unknown keeps its dashes', () => {
    const def = { position: 'DEF', team: 'XYZ', display: { stats: {} } }
    expect(attachTeamDefenseStats([def], byTeam)[0]).toBe(def)
  })
})

describe('the mock pool row for a defense', () => {
  const row = attachTeamDefenseStats(
    [{ position: 'DEF', team: 'LAR', adp: 150, display: { stats: {} }, nflDraftProjectionSplits: null }],
    summarizeTeamDefense(defenders, games),
  )[0]!

  it('leads with SACK and INT, not empty fantasy points', () => {
    expect(mockPoolStatCells(row as never, 'NFL').map((c) => `${c.label} ${c.value}`)).toEqual(['SACK 32.5', 'INT 5', 'TD 2', 'PA/G 23.5'])
    expect(mockPoolPhoneStatLine(row as never, 'NFL')).toBe('SACK 32.5 · INT 5')
  })
})
