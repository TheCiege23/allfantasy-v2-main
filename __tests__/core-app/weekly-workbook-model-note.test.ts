// @vitest-environment node
/**
 * Production 2026-10-06: the portfolio workbook's Model sheet said "Playoff model unavailable for
 * this format or data" while its Brief quoted NFL Dreaming!'s 33.6% from that very model.
 */
import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { buildWeeklyWorkbook } from '@/lib/core-app/weeklyWorkbook'
import type { WeeklyBlueprint } from '@/lib/core-app/weeklyBlueprint'
import type { WeeklyPlayoffPath } from '@/lib/core-app/weeklyPlayoffPath'

const portfolio = { name: 'Alex', teamName: null, leagueCount: 65, sports: ['NFL', 'NCAAF'], focusLeagueId: null, actions: [], actionCount: 0, attentionLeagueIds: [],
  lineupReadFailed: false, coverage: [], matchup: { opponent: 'the Price i$ Right', period: 5, leagueName: 'NFL Dreaming!', leagueId: 'N', season: 2026 },
  playoff: { probability: 33.6, leagueName: 'NFL Dreaming!', leagueId: 'N', season: 2026, period: 5 } } as unknown as WeeklyBlueprint
const model = (rows: unknown[][]) => Object.fromEntries(rows.map(r => [r[0], r[1]]))
const sheet = (bytes: Uint8Array) => XLSX.utils.sheet_to_json<unknown[]>(XLSX.read(bytes, { type: 'array' }).Sheets.Model, { header: 1 })

describe('the workbook Model sheet explains itself honestly', () => {
  it('portfolio: names whose estimate the Brief quotes, instead of calling the model unavailable', () => {
    const rows = model(sheet(buildWeeklyWorkbook(portfolio, null)))
    expect(rows.Available).toBe(false)
    expect([rows.Season, rows.Period]).toEqual([2026, 5])
    expect(rows.Note).toBe("Charts and model details export from one league's own Your Week page. The Brief's 33.6% is NFL Dreaming!'s current playoff estimate.")
    expect(JSON.stringify(rows)).not.toContain('unavailable')
  })

  it('a model for another period: says so, rather than "unavailable"', () => {
    const stale = { leagueId: 'N', season: 2026, period: 5, historyUnavailable: false, points: [], swing: null,
      league: { leagueId: 'N', season: 2026, period: 4, you: { modelled: true, playoffPct: 33.6 }, assumptions: { iterations: 10000, computedAt: '2026-10-06', missing: [] } } } as unknown as WeeklyPlayoffPath
    const rows = model(sheet(buildWeeklyWorkbook({ ...portfolio, focusLeagueId: 'N' }, stale)))
    expect(rows.Available).toBe(false)
    expect(rows.Note).toMatch(/different season or period than this export/)
  })

  it('no model and no estimate: still unavailable', () => {
    const none = { ...portfolio, playoff: undefined } as unknown as WeeklyBlueprint
    expect(model(sheet(buildWeeklyWorkbook(none, null))).Note).toBe('Playoff model unavailable for this format or data.')
  })
})
