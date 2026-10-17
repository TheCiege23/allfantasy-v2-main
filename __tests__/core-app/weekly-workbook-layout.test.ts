// @vitest-environment node
import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { mkdirSync, writeFileSync } from 'node:fs'
import { buildWeeklyWorkbook } from '@/lib/core-app/weeklyWorkbook'
import type { WeeklyBlueprint } from '@/lib/core-app/weeklyBlueprint'
import type { WeeklyPlayoffPath } from '@/lib/core-app/weeklyPlayoffPath'
const data: WeeklyBlueprint = { name: 'QA Manager', teamName: 'QA Team', leagueCount: 1, sports: ['NFL'], focusLeagueId: 'QA', actions: [], actionCount: 0, attentionLeagueIds: [], lineupReadFailed: false, coverage: [], matchup: { leagueId: 'QA', leagueName: 'QA League', season: 2026, period: 5, opponent: 'QA Rival' }, playoff: { leagueId: 'QA', leagueName: 'QA League', season: 2026, period: 5, probability: 52 }, calendar: { generatedAt: '2026-10-07T12:00:00Z', through: '2026-10-14T12:00:00Z', events: [{ id: 'waivers', leagueId: 'QA', leagueName: 'QA League', kind: 'waivers', title: 'Waivers process', at: '2026-10-08T08:00:00Z', source: 'waiver-engine', href: '/core/waivers?league=QA' }], gaps: [{ leagueId: 'QA', leagueName: 'QA League', kind: 'lineup' }] } }
const path = { season: 2026, period: 5, historyUnavailable: false, points: [{ period: 5, probability: 52, sampledAt: '2026-10-07T12:00:00Z' }], swing: { leagueId: 'QA', week: 5, ifWin: 65, ifLose: 40 }, league: { leagueId: 'QA', season: 2026, period: 5, you: { modelled: true, playoffPct: 52 }, assumptions: { iterations: 10000, computedAt: '2026-10-07T12:00:00Z', missing: [] } } } as WeeklyPlayoffPath
function part(bytes: Uint8Array, name: string) { const zip = XLSX.CFB.read(bytes, { type: 'array' }); const item = XLSX.CFB.find(zip, `/${name}`); return item?.content ? new TextDecoder().decode(new Uint8Array(item.content as Uint8Array)) : '' }
describe('weekly workbook readability and calendar export', () => {
  it('wraps a long brief, reserves row height, and freezes the header even without charts', () => {
    const bytes = buildWeeklyWorkbook({ ...data, focusLeagueId: null, teamName: 'A very long team name '.repeat(12) })
    const sheet = part(bytes, 'xl/worksheets/sheet1.xml')
    expect(part(bytes, 'xl/styles.xml')).toContain('wrapText="1"')
    expect(sheet).toContain('state="frozen"')
    const row = /<row\b[^>]*r="2"[^>]*>/.exec(sheet)?.[0] ?? ''
    expect(Number(/ht="([\d.]+)"/.exec(row)?.[1])).toBeGreaterThan(30)
  })
  it('keeps calendar timing and gaps, numeric percent labels, and a visible single-point chart', () => {
    const bytes = buildWeeklyWorkbook(data, path), wb = XLSX.read(bytes, { type: 'array', cellNF: true })
    expect(wb.SheetNames).toEqual(['Brief', 'Actions', 'Trend', 'Scenarios', 'Calendar', 'Calendar gaps', 'Coverage', 'Model'])
    expect(wb.Sheets.Calendar.C2.v).toBe('2026-10-08T08:00:00Z')
    expect(wb.Sheets['Calendar gaps'].B2.v).toBe('lineup')
    expect(wb.Sheets.Trend.B2.v).toBe(52)
    expect(wb.Sheets.Trend.B2.z).toBe('0.0"%"')
    expect(part(bytes, 'xl/charts/chart3.xml')).toContain('<c:symbol val="circle"/>')
    expect(part(bytes, 'xl/charts/chart4.xml')).toContain('Win / loss scenarios (%)')
    if (process.env.AF_WEEKLY_QA_EXPORT_DIR) { mkdirSync(process.env.AF_WEEKLY_QA_EXPORT_DIR, { recursive: true }); writeFileSync(`${process.env.AF_WEEKLY_QA_EXPORT_DIR}/current-export-QA-fixture.xlsx`, bytes) }
  })
})
