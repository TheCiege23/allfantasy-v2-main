import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
import { SleeperAdapter } from '@/lib/league-import/adapters/sleeper/SleeperAdapter'
import { buildImportedLeagueSettings, republishCanonicalSettingsForRefresh } from '@/lib/league-import/ImportedLeagueCommitService'
import { readImportedPointsAgainst } from '@/lib/league-import/importedPointsAgainst'
import type { SleeperImportPayload, SleeperRosterRaw } from '@/lib/league-import/adapters/sleeper/types'
import type { CanonicalImportBundle } from '@/lib/league-import/types'

function payload(settings: SleeperRosterRaw['settings']): SleeperImportPayload {
  return { league: { league_id: 'source', name: 'IDP', sport: 'nfl', season: '2026', total_rosters: 1 }, rosters: [{ roster_id: 2, owner_id: 'manager', settings }] }
}
const read = (settings: unknown, season = 2026, externalId = '2') => readImportedPointsAgainst({ settings, season, externalId, platform: 'sleeper', persisted: 0 })

describe('reported Sleeper points-against through normalization and persistence', () => {
  it.each([
    [{ fpts_against: 1670, fpts_against_decimal: 32 }, 1670.32],
    [{ fpts_against: 0, fpts_against_decimal: 0 }, 0],
    [{ fpts_against: 15 }, 15],
    [{ fpts_against: -2, fpts_against_decimal: -50 }, -2.5],
  ] as const)('retains the provider total from %j', async (fields, expected) => {
    const normalized = await SleeperAdapter.normalize(payload(fields))
    expect(normalized.rosters[0].points_against).toBe(expected)
    expect(normalized.standings[0].points_against).toBe(expected)
    const settings = buildImportedLeagueSettings(normalized)
    expect(read(settings)).toBe(expected)
    // The scheduled refresh path republishes the source evidence, including genuine zero.
    const refreshed = republishCanonicalSettingsForRefresh({ imported_points_against: { season: 2025, byTeamId: { '2': 99 } } }, settings, { settingsSnapshot: {} } as CanonicalImportBundle)
    expect(read(refreshed)).toBe(expected)
  })
  it.each([undefined, {}, { fpts_against_decimal: 32 }, { fpts_against: NaN }, { fpts_against: Infinity }, { fpts_against: 5, fpts_against_decimal: NaN }])('does not invent an absent or malformed total: %j', async fields => {
    const normalized = await SleeperAdapter.normalize(payload(fields))
    expect(normalized.rosters[0].points_against).toBeUndefined()
    expect(normalized.standings[0].points_against).toBeUndefined()
    expect(read(buildImportedLeagueSettings(normalized))).toBeNull()
  })
  it('never uses another season, another team, inherited keys or malformed evidence', () => {
    const settings = { imported_points_against: { season: 2026, byTeamId: { '2': 1670.32 } } }
    expect(read(settings, 2025)).toBeNull()
    expect(read(settings, 2026, '3')).toBeNull()
    expect(read(settings, 2026, 'toString')).toBeNull()
    expect(read({ imported_points_against: { season: 2026, byTeamId: { '2': '0' } } })).toBeNull()
    expect(read({})).toBeNull()
  })
})
