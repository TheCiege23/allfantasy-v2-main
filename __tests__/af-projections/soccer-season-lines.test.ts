import { describe, expect, it } from 'vitest'

import { soccerSeasonLines, type SoccerGameRow } from '@/lib/af-projections/soccerSeasonLines'
import { extractSeasonAggregate, perGameRatesFor } from '@/lib/af-projections/core'
import { getCategoryScoringRules, scoreCategoryComponents } from '@/lib/af-projections/categoryScoring'

/**
 * Soccer season lines built from per-match rows (2026-10-09). The `normalizedStatMap` payloads are
 * verbatim production rows (player ids replaced): a substitute defender's clean sheet, a keeper, a
 * scoring forward, and a 0-minute row that still carries fouls.
 */
const row = (playerId: string, team: string, day: string, m: Record<string, unknown>): SoccerGameRow => ({
  playerId, team, gameDate: new Date(`${day}T04:00:00Z`), normalizedStatMap: m,
})
const fielder = (position: string, stats: Record<string, number>) => ({ group: 'fielders', position, positionCategory: null, scored: false, status: null, stats })
const DEF_SUB_CLEAN_SHEET = fielder('Defender', { goals: 0, assists: 0, player_id: 2290, red_cards: 0, fouls_drawn: 1, clean_sheets: 1, yellow_cards: 0, shots_on_goal: 0, free_kicks_won: 1, minutes_played: 19, fouls_committed: 0, shots_attempted: 0, penalties_scored: 0, penalty_attempts: 0 })
const DEF_FULL_CLEAN_SHEET = { ...DEF_SUB_CLEAN_SHEET, stats: { ...DEF_SUB_CLEAN_SHEET.stats, minutes_played: 94 } }
const KEEPER = { group: 'goalkeepers', position: 'Goalkeeper', positionCategory: null, scored: false, status: null, stats: { goals: 0, saves: 3, assists: 0, player_id: 1151, red_cards: 0, fouls_drawn: 0, clean_sheets: 0, yellow_cards: 0, shots_on_goal: 0, free_kicks_won: 0, goals_conceded: 2, minutes_played: 99, fouls_committed: 0, penalties_faced: 0, penalties_saved: 0, shots_attempted: 0, penalties_scored: 0, penalty_attempts: 0 } }
const FWD_GOAL = fielder('Forward', { goals: 1, assists: 0, player_id: 2105, red_cards: 0, fouls_drawn: 3, yellow_cards: 0, shots_on_goal: 2, free_kicks_won: 0, minutes_played: 97, fouls_committed: 0, shots_attempted: 3, penalties_scored: 0, penalty_attempts: 0 })
const ZERO_MINUTES = fielder('Defender', { goals: 0, assists: 0, player_id: 4259, red_cards: 0, fouls_drawn: 1, clean_sheets: 1, yellow_cards: 0, shots_on_goal: 0, free_kicks_won: 0, minutes_played: 0, fouls_committed: 2, shots_attempted: 0, penalties_scored: 0, penalty_attempts: 0 })

const names = new Map([['def', 'A Defender'], ['gk', 'A Keeper'], ['fwd', 'A Forward']])
const line = (rows: SoccerGameRow[], id: string) => soccerSeasonLines(rows, names, 2026).find((l) => l.playerId === id)

describe('soccerSeasonLines', () => {
  it('builds the season-line shape the projection writer reads, in the engine’s keys', () => {
    const l = line([row('fwd', 'RAC', '2026-09-05', FWD_GOAL), row('fwd', 'RAC', '2026-09-12', FWD_GOAL)], 'fwd')!
    expect(l).toMatchObject({ season: '2026', stats: { riTeam: 'RAC', position: 'FWD', riPlayerName: 'A Forward' } })
    expect(l.stats.regular_season).toMatchObject({ games_played: 2, goals: 2, shots_on_target: 4, shots: 6, minutes_played: 194 })
    // The same aggregate every other sport's line yields: per-appearance rates in engine keys.
    const rates = perGameRatesFor('SOCCER', extractSeasonAggregate(l.stats)!)!
    expect(rates).toMatchObject({ goals: 1, shots_on_target: 2, minutes_played: 97 })
    expect(rates).not.toHaveProperty('appearance')
    expect(rates).not.toHaveProperty('games_played')
  })

  it('counts only appearances — an unused or 0-minute row is not a game played', () => {
    const l = line([row('def', 'ATA', '2026-08-24', DEF_FULL_CLEAN_SHEET), row('def', 'ATA', '2026-08-31', ZERO_MINUTES)], 'def')!
    expect(l.stats.regular_season.games_played).toBe(1)
    expect(l.stats.regular_season.fouls_committed).toBe(0)
  })

  it('gives a defender his clean sheet only at 60 minutes, and a keeper his saves', () => {
    const def = line([row('def', 'ATA', '2026-08-24', DEF_FULL_CLEAN_SHEET), row('def', 'ATA', '2026-08-31', DEF_SUB_CLEAN_SHEET)], 'def')!
    expect(def.stats.regular_season).toMatchObject({ games_played: 2, clean_sheet_def: 1 })
    expect(def.stats.regular_season).not.toHaveProperty('saves')
    const gk = line([row('gk', 'BAR', '2026-08-31', KEEPER)], 'gk')!
    expect(gk.stats).toMatchObject({ position: 'GK', regular_season: { saves: 3, gk_goals_against: 2, clean_sheet_gk: 0 } })
  })

  it('files a player at the position his rows give most, and at his latest club', () => {
    const asMid = { ...FWD_GOAL, position: 'Midfielder' }
    const l = line([
      row('fwd', 'OLD', '2026-08-24', FWD_GOAL),
      row('fwd', 'NEW', '2026-09-12', asMid),
      row('fwd', 'NEW', '2026-09-19', asMid),
    ], 'fwd')!
    expect(l.stats).toMatchObject({ position: 'MID', riTeam: 'NEW' })
  })

  it('drops a row whose group cannot be told — a keeper’s clean sheet is not a defender’s', () => {
    expect(line([row('def', 'ATA', '2026-08-31', { ...DEF_FULL_CLEAN_SHEET, group: 'unknown' })], 'def')).toBeUndefined()
  })

  it('scores to points on what an unsaved soccer league scores, through the same category scorer', () => {
    const l = line([row('fwd', 'RAC', '2026-09-05', FWD_GOAL)], 'fwd')!
    const scored = scoreCategoryComponents({ components: extractSeasonAggregate(l.stats)!.components, rules: getCategoryScoringRules('SOCCER')! })!
    // A goal (6), two shots on target (1), three shots (0.6) and 97 minutes (1.94); fouls score 0.
    expect(scored.points).toBeCloseTo(6 + 1 + 0.6 + 1.94, 9)
  })
})
