import { describe, expect, it } from 'vitest'
import fixture from './fixtures/fantrax/mlb-points-public.json'
import { fantraxScoringRules } from '@/lib/league-import/fantrax/fantraxScoring'
import { resolveRosters, type FantraxLeagueInfo, type FantraxPlayerRef } from '@/lib/league-import/fantrax/fantraxApi'
import { importedMlbScoring } from '@/lib/league-creation/canonical/importedMlbScoring'
import { importedMlbRoster } from '@/lib/league-creation/canonical/importedMlbRoster'
import { resolveRedraftRosterConfig } from '@/lib/redraft/rosterConfigResolver'
import { allowedPositionsForSlot } from '@/lib/redraft/lineupValidation'

const settings = () => ({
  scoringSettings: { format: 'HEAD_TO_HEAD_POINTS_BASED', rules: Object.fromEntries(fantraxScoringRules(fixture.info as unknown as FantraxLeagueInfo).rules.map(r => [r.stat_key, r.points_value])) },
  fantrax_settings: fixture.info,
})

describe('public Fantrax baseball contract and native carryover', () => {
  it('resolves public MLB player IDs against the baseball map', () => {
    const [roster] = resolveRosters({ fixture: fixture.roster }, fixture.playerMap as Record<string, FantraxPlayerRef>)
    expect(roster.resolved).toBe(7)
    expect(roster.total).toBe(8)
  })
  it('preserves hitting and pitching weights without adding default categories', () => {
    const result = importedMlbScoring(settings())
    expect(result.categoryPoints).toMatchObject({ single: 1, double: 2, triple: 3, hr: 4, w: 10, sv: 7, ip: 1, qs: 3, l: -5, er: -1, so: 1, tb: 0, hld: 0, bat_so: 0 })
    expect(result.uiRules).toMatchObject({ singles: 1, home_runs: 4, wins: 10, holds: 0 })
    expect(fantraxScoringRules(fixture.info as unknown as FantraxLeagueInfo).gaps).toEqual([])
  })
  it('keeps a single-category points league single-category', () => {
    const result = importedMlbScoring({ scoringSettings: { format: 'points', rules: { hr: 1 } } })
    expect(Object.entries(result.categoryPoints).filter(([, v]) => v !== 0)).toEqual([['hr', 1]])
  })
  it('refuses category scoring and unsupported rules instead of silently replacing them', () => {
    expect(() => importedMlbScoring({ scoringSettings: { format: 'categories', rules: { hr: 1 } } })).toThrow('category format')
    expect(() => importedMlbScoring({ scoringSettings: { format: 'points', rules: { hr: 1, unknown: 5 } } })).toThrow('cannot be scored exactly')
  })
  it('uses real slot constraints and keeps corner/middle infield eligibility', () => {
    const roster = importedMlbRoster(settings())
    const result = resolveRedraftRosterConfig('MLB', { roster })
    expect(result.maxRosterSize).toBe(30)
    expect(result.starterCapacities.get('P')).toBe(9)
    expect(result.starterCapacities.get('CI')).toBe(1)
    expect(allowedPositionsForSlot('MLB', 'CI')).toEqual(['1B', '3B'])
    expect(allowedPositionsForSlot('MLB', 'MI')).toEqual(['2B', 'SS'])
  })
})
