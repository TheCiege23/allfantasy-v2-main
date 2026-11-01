import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { parseYahooTeamMatchupsForTest } from '@/lib/league-import/yahoo/YahooLeagueFetchService'
import { parseEspnScheduleForTest } from '@/lib/league-import/espn/EspnLeagueFetchService'
import { verifiedCategoryPairs } from '@/lib/import-os/collector/importedCategorySnapshots'
import { externalMatchupSeasonActive } from '@/lib/import-os/collector/externalMatchupParity'

const team = (key: string, values: Array<[number, string]>) => ({ team: [[
  { team_key: key },
  { team_stats: { stats: Object.fromEntries(values.map(([id, value], i) =>
    [i, { stat: [{ stat_id: id }, { value }] }])) } },
]] })

describe('Yahoo imported category totals', () => {
  it('retains the provider stat totals from both sides of a matchup', () => {
    const raw = { fantasy_content: { team: { matchups: { 0: { matchup: [
      { week: '2' }, { teams: { 0: team('466.l.12.t.1', [[5, '101'], [6, '42.5']]),
        1: team('466.l.12.t.2', [[5, '95'], [6, '40']]) } },
    ] } } } } }
    const weeks = parseYahooTeamMatchupsForTest(raw, 2026)
    expect(weeks[0]?.matchups[0]).toMatchObject({ categories1: { '5': 101, '6': 42.5 },
      categories2: { '5': 95, '6': 40 } })
    const pairs = verifiedCategoryPairs(weeks[0]!.matchups.map((m) => ({
      teamId1: m.teamKey1, teamId2: m.teamKey2, categories1: m.categories1, categories2: m.categories2,
    })), (id) => id.split('.t.')[1] ?? null)
    expect(pairs).toEqual([{ roster1: '1', roster2: '2', categories1: { '5': 101, '6': 42.5 },
      categories2: { '5': 95, '6': 40 } }])
  })

  it('refuses a partial category pairing rather than inventing zeros', () => {
    expect(verifiedCategoryPairs([{ teamId1: '1', teamId2: '2', categories1: { '5': 101, '6': 42 },
      categories2: { '5': 95 } }], (id) => id)).toEqual([])
  })

  it('refreshes the current NBA and soccer seasons while refusing old or offseason leagues', () => {
    expect(externalMatchupSeasonActive('NBA', 2026, new Date('2026-11-01T12:00:00Z'))).toBe(true)
    expect(externalMatchupSeasonActive('SOCCER', 2026, new Date('2027-04-01T12:00:00Z'))).toBe(true)
    expect(externalMatchupSeasonActive('NBA', 2025, new Date('2026-11-01T12:00:00Z'))).toBe(false)
    expect(externalMatchupSeasonActive('NBA', 2026, new Date('2027-08-01T12:00:00Z'))).toBe(false)
  })
})

describe('ESPN imported category totals', () => {
  it('reads configured category totals from a captured ESPN baseball matchup', () => {
    const raw = JSON.parse(readFileSync(path.join(process.cwd(), 'contracts/espn/fixtures/fantasy-league.MLB.2026.json'), 'utf8'))
    const weeks = parseEspnScheduleForTest(raw, 2026, raw.status.currentMatchupPeriod)
    const pair = weeks.flatMap((week) => week.matchups).find((match) => match.categories1 && match.categories2)
    expect(pair).toBeDefined()
    const configured = raw.settings.scoringSettings.scoringItems.map((item: { statId: number }) => String(item.statId))
    expect(Object.keys(pair!.categories1!)).toEqual(expect.arrayContaining(configured))
    expect(Object.keys(pair!.categories1!)).toHaveLength(configured.length)
    expect(verifiedCategoryPairs([pair!], (id) => id)).toHaveLength(1)
  })

  it('refuses a scalar points league even if ESPN includes scoreByStat diagnostics', () => {
    const raw = JSON.parse(readFileSync(path.join(process.cwd(), 'contracts/espn/fixtures/fantasy-league.MLB.2026.json'), 'utf8'))
    raw.settings.scoringSettings.scoringType = 'H2H_POINTS'
    const pair = parseEspnScheduleForTest(raw, 2026, raw.status.currentMatchupPeriod)
      .flatMap((week) => week.matchups).find((match) => match.teamId2)
    expect(pair?.categories1).toBeUndefined()
  })
})
