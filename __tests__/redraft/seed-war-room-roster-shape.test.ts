/**
 * Regression lock for two `Roster.playerData` shape bugs found during the
 * NFL redraft local rehearsal: `seed-redraft-war-room-runtime.ts` seeds real
 * `RedraftRosterPlayer` rows directly (bypassing the live draft flow), so the
 * legacy `Roster.playerData` bridge a completed draft normally writes via
 * `finalizeRosterAssignments`/`buildPlayerDataFromSections` never runs.
 *
 * Two independent consumers read that JSON blob with two different shapes:
 *  - `/api/league/roster` (Roster tab, `TeamTab.tsx`) reads the FLAT
 *    `players`/`starters` keys via `getRosterPlayerIds`/`getStarterIds`.
 *    The seed previously wrote `playerIds` instead of `players`, so every
 *    slot rendered "Empty" despite the roster having real, active players.
 *  - The waiver add-drop legality gate (`evaluateFullRosterLegalityAsync`)
 *    reads the NESTED `lineup_sections.starters` block via
 *    `getNormalizedLineupSections`. The seed initially didn't write this
 *    block at all, so every waiver claim failed with
 *    "Not enough starters (0/9)" despite the Roster tab showing 9/9.
 */
import { describe, expect, it } from 'vitest'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import { getNormalizedLineupSections } from '@/lib/roster/LineupTemplateValidation'
import { buildLegacyPlayerData, memberPlayers, opponentPlayers } from '@/scripts/seed-redraft-war-room-runtime'

describe('seed-redraft-war-room-runtime legacy Roster.playerData shape', () => {
  it('produces a players[] array that getRosterPlayerIds (the real roster-tab reader) resolves to every seeded player', () => {
    const playerData = buildLegacyPlayerData(memberPlayers)
    const ids = getRosterPlayerIds(playerData)
    expect(ids).toEqual(memberPlayers.map((p) => p.playerId))
    expect(ids.length).toBeGreaterThan(0)
  })

  it('marks exactly the non-bench players as starters, matching the roster tab starter count', () => {
    const playerData = buildLegacyPlayerData(memberPlayers)
    const expectedStarters = memberPlayers.filter((p) => p.slotType !== 'bench').map((p) => p.playerId)
    expect(playerData.starters).toEqual(expectedStarters)
    expect(playerData.starters.length).toBe(9) // QB, RB, RB, WR, WR, TE, FLEX, K, DST
  })

  it('holds for the opponent roster too', () => {
    const playerData = buildLegacyPlayerData(opponentPlayers)
    const ids = getRosterPlayerIds(playerData)
    expect(ids).toEqual(opponentPlayers.map((p) => p.playerId))
    expect(playerData.starters.length).toBeGreaterThan(0)
  })

  it('regression guard: the old shape (playerIds instead of players) would have produced zero resolvable ids', () => {
    const oldShape = { seed: 'redraft-war-room-runtime', playerIds: memberPlayers.map((p) => p.playerId) }
    expect(getRosterPlayerIds(oldShape)).toEqual([])
  })

  it('also produces a lineup_sections block that the waiver add-drop legality gate (getNormalizedLineupSections) resolves correctly', () => {
    // Reproduced live: the waiver "Add" button called
    // evaluateFullRosterLegalityAsync -> getNormalizedLineupSections, which
    // reads playerData.lineup_sections.starters (NOT the flat `starters`
    // key). Without this block every add-drop attempt failed with
    // "Not enough starters (0/9)" despite the Roster tab showing 9/9 filled.
    const playerData = buildLegacyPlayerData(memberPlayers)
    const sections = getNormalizedLineupSections(playerData)
    const expectedStarterIds = memberPlayers.filter((p) => p.slotType !== 'bench').map((p) => p.playerId)
    expect(sections.starters.map((s) => s.id)).toEqual(expectedStarterIds)
    expect(sections.starters.length).toBe(9)
  })

  it('regression guard: a shape with only the flat starters[] (no lineup_sections) resolves to zero starters via getNormalizedLineupSections', () => {
    const flatOnlyShape = { starters: memberPlayers.map((p) => p.playerId) }
    expect(getNormalizedLineupSections(flatOnlyShape).starters).toEqual([])
  })
})
