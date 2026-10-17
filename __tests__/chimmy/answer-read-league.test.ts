// @vitest-environment node
/**
 * 🛑 "Read from <league>" was shown whenever a league was SELECTED — on answers where no tool ran,
 * or only a stats lookup did. The line is earned by a league-reading tool now.
 */
import { describe, expect, it } from 'vitest'

import { answerReadLeague, WORLD_ONLY_TOOLS } from '@/lib/chimmy/tools/answerReadLeague'
import { CHIMMY_TOOL_SPECS } from '@/lib/chimmy/tools/chimmyTools'

describe('answerReadLeague', () => {
  it('no tool ran: the league was not read', () => {
    expect(answerReadLeague([])).toBe(false)
  })

  it('only real-world lookups ran: the league was not read', () => {
    expect(answerReadLeague(['get_player_season_stats', 'get_upcoming_games', 'find_league_by_name'])).toBe(false)
  })

  it('any league lookup earns the line', () => {
    expect(answerReadLeague(['get_player_season_stats', 'get_my_roster'])).toBe(true)
    expect(answerReadLeague(['optimize_my_lineup'])).toBe(true)
  })

  it('an unknown (future) tool counts as league-reading — it never silently loses the line', () => {
    expect(answerReadLeague(['some_tool_added_later'])).toBe(true)
  })

  it('every world-only name is a real tool, so a rename cannot quietly widen the badge', () => {
    const real = new Set(CHIMMY_TOOL_SPECS.map((t) => t.function.name))
    for (const name of WORLD_ONLY_TOOLS) expect(real.has(name), name).toBe(true)
  })
})
