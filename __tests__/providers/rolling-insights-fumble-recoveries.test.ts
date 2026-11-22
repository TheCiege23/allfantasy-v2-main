/**
 * Rolling Insights fumble recoveries (GAPS N-23, 2026-11-20): one count per player, the documented
 * player field first, the games-played echo in `defense_fumble_recoveries` dropped, never both added.
 */
import { describe, expect, it } from 'vitest'
import { isGamesPlayedEcho, playerFumbleRecoveries } from '@/lib/providers/rollingInsightsFumbleRecoveries'
import { extractIdpComponents } from '@/lib/af-projections/idpScoring'

describe('playerFumbleRecoveries', () => {
  it('prefers the player field and never adds the team-named copy', () => {
    expect(playerFumbleRecoveries({ fumbles_recoveries: 1, defense_fumble_recoveries: 1 })).toBe(1)
    expect(playerFumbleRecoveries({ fumbles_recoveries: 2, defense_fumble_recoveries: 1 })).toBe(2)
  })

  it('drops the games-played echo (value = games, no defensive snaps)', () => {
    const echo = { games_played: 16, snap_count_defense: 0, defense_fumble_recoveries: 16 }
    expect(isGamesPlayedEcho(echo)).toBe(true)
    expect(playerFumbleRecoveries(echo)).toBeNull()
    expect(playerFumbleRecoveries({ defense_fumble_recoveries: 5, snap_count_defense: 0 }, 5)).toBeNull()
  })

  it('keeps a real value carried only in the team-named field (2026 rows)', () => {
    expect(playerFumbleRecoveries({ games_played: 9, snap_count_defense: 410, defense_fumble_recoveries: 2 })).toBe(2)
    // Same number as games played, but he played defensive snaps: a real count.
    expect(playerFumbleRecoveries({ games_played: 1, snap_count_defense: 60, defense_fumble_recoveries: 1 })).toBe(1)
  })

  it('has no value when neither field is there', () => {
    expect(playerFumbleRecoveries({ sacks: 3 })).toBeNull()
    expect(playerFumbleRecoveries(null)).toBeNull()
  })
})

describe('IDP scoring from a Rolling Insights season row', () => {
  it('scores one fumble recovery once, not twice', () => {
    const { components } = extractIdpComponents({ sacks: 4, fumbles_recoveries: 1, defense_fumble_recoveries: 1 }, 'ri_season', 17)
    expect(components.fumbleRecovery).toBe(1)
    expect(components.sack).toBe(4)
  })

  it('does not score the games-played echo as recoveries', () => {
    const { components } = extractIdpComponents({ sacks: 0, games_played: 16, snap_count_defense: 0, defense_fumble_recoveries: 16 }, 'ri_season', 16)
    expect(components.fumbleRecovery).toBeUndefined()
  })
})
