import { describe, expect, it } from 'vitest'
import { rosterLabel } from '@/lib/core-app/managerName'

/*
 * One label for an opposing roster on every Core surface. Before: "vs Roster 8" (home), "vs
 * Unknown" (Matchup board) and "opponent not named" (Your Week) for the same unowned Sleeper roster
 * on the App Review account, 2026-09-29.
 */
describe('rosterLabel', () => {
  it('takes the first real name, team before person', () => {
    expect(rosterLabel(['Gridiron Ghosts', 'Pat'], 8)).toBe('Gridiron Ghosts')
    expect(rosterLabel([null, 'Pat'], 8)).toBe('Pat')
  })

  it('skips the importer placeholders — "Unknown" is not a name', () => {
    expect(rosterLabel(['Unknown', 'Unknown'], 8)).toBe('Team 8')
    expect(rosterLabel(['unknown team', '  '], '8')).toBe('Team 8')
    expect(rosterLabel(['Unknown', 'Pat'], 8)).toBe('Pat')
  })

  it('falls back to the platform’s own "Team N", never an invented manager', () => {
    expect(rosterLabel([], 12)).toBe('Team 12')
    expect(rosterLabel([null, undefined], null)).toBe('Opponent')
  })
})
