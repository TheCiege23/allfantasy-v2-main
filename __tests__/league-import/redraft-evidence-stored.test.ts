/**
 * The raw format signals the redraft identity reads for an imported league (batch B-ID) are stored
 * by the importers exactly as the provider sent them — and stay ABSENT when it sent nothing, which is
 * the whole difference from `isDynasty` / `is_keeper`, both `false` in that case.
 */
import { describe, expect, it } from 'vitest'
import { SleeperLeagueMapper } from '@/lib/league-import/adapters/sleeper/SleeperLeagueMapper'
import type { SleeperImportPayload } from '@/lib/league-import/adapters/sleeper/types'
import { espnKeeperCount } from '@/lib/league-import/adapters/espn/EspnAdapter'
import type { EspnImportPayload } from '@/lib/league-import/adapters/espn/types'
import { buildImportedLeagueSettings } from '@/lib/league-import/ImportedLeagueCommitService'
import { isImportedRedraftLeague } from '@/lib/league-media/redraftIdentity'

const sleeperPayload = (settings: Record<string, unknown>): SleeperImportPayload =>
  ({
    league: { league_id: 'x', name: 'L', sport: 'nba', season: '2026', total_rosters: 10, roster_positions: [], scoring_settings: {}, settings },
  }) as unknown as SleeperImportPayload

describe('SleeperLeagueMapper stores settings.type raw', () => {
  it.each([[0, 0], [1, 1], [2, 2]])('type %s → sleeper_league_type %s', (type, stored) => {
    expect(SleeperLeagueMapper.map(sleeperPayload({ type }))?.sleeper_league_type).toBe(stored)
  })
  it('absent type stays absent (while is_keeper and isDynasty both read false)', () => {
    const mapped = SleeperLeagueMapper.map(sleeperPayload({ num_teams: 10 }))
    expect(mapped?.sleeper_league_type).toBeUndefined()
    expect(mapped?.is_keeper).toBe(false)
    expect(mapped?.isDynasty).toBe(false)
  })
})

describe('espnKeeperCount reads ESPN\'s own number only', () => {
  const espn = (raw: Record<string, unknown> | undefined) => ({ settings: raw ? { raw } : null }) as unknown as EspnImportPayload
  it('top-level, then draftSettings, else undefined', () => {
    expect(espnKeeperCount(espn({ keeperCount: 0 }))).toBe(0)
    expect(espnKeeperCount(espn({ draftSettings: { keeperCount: 7 } }))).toBe(7)
    expect(espnKeeperCount(espn({ draftSettings: { keeperCount: 0 } }))).toBe(0)
    expect(espnKeeperCount(espn({}))).toBeUndefined()
    expect(espnKeeperCount(espn({ draftSettings: { keeperCount: '0' } }))).toBeUndefined()
    expect(espnKeeperCount(espn(undefined))).toBeUndefined()
  })
})

describe('the stored settings blob carries the signal through to the identity rule', () => {
  it('a Sleeper type-0 league is redraft once its settings are rebuilt; a type-1 league is not', () => {
    for (const [type, expected] of [[0, true], [1, false]] as const) {
      const league = SleeperLeagueMapper.map(sleeperPayload({ type }))!
      const settings = buildImportedLeagueSettings({
        source: { source_provider: 'sleeper', source_league_id: 'x', import_batch_id: 'b', imported_at: '2026-10-31T00:00:00Z' },
        league,
        coverage: {},
      } as never)
      expect(settings.sleeper_league_type).toBe(type)
      expect(isImportedRedraftLeague({ platform: 'sleeper', sport: 'NBA', leagueType: 'redraft', isDynasty: league.isDynasty, settings })).toBe(expected)
    }
  })
})
