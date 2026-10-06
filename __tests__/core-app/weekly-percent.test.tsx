import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import * as XLSX from 'xlsx'
vi.mock('@/components/i18n/LanguageProviderClient',()=>({useOptionalLanguage:()=>({language:'en'})}))
import { PlayoffPath } from '@/components/core-app/WeeklyBlueprint'
import { buildWeeklyWorkbook } from '@/lib/core-app/weeklyWorkbook'
import { formatPct1, pct1 } from '@/lib/core-app/weeklyPercent'
import type { WeeklyBlueprint } from '@/lib/core-app/weeklyBlueprint'
import type { WeeklyPlayoffPath } from '@/lib/core-app/weeklyPlayoffPath'
// Production 2026-10-06, HailShiva: the page said 55.5% and Excel 55.6% for the same 55.55.
const data = {name:'Alex',teamName:'Tenzy SF',leagueCount:1,sports:['NFL'],focusLeagueId:'H',actions:[],actionCount:0,attentionLeagueIds:[],lineupReadFailed:false,coverage:[]} as unknown as WeeklyBlueprint
const path = {leagueId:'H',season:2026,period:5,historyUnavailable:false,points:[{period:5,probability:65.12,sampledAt:'2026-10-06T04:07:46.476Z'}],swing:{leagueId:'H',week:5,ifWin:76.4,ifLose:55.55},
  league:{leagueId:'H',season:2026,period:5,you:{modelled:true,playoffPct:65.12,status:null},assumptions:{iterations:10000,computedAt:'2026-10-06T04:07:46.476Z',missing:[]}}} as unknown as WeeklyPlayoffPath
afterEach(()=>cleanup())
describe('one rounding for weekly percentages',()=>{
  it('rounds the decimal value half away from zero and never prints -0.0',()=>{
    expect((55.55).toFixed(1)).toBe('55.5')
    expect(formatPct1(55.55)).toBe('55.6')
    expect([pct1(76.4),pct1(65.12),pct1(51.85),pct1(99.95),pct1(-0.05)]).toEqual([76.4,65.1,51.9,100,-0.1])
    expect(formatPct1(-0.04)).toBe('0.0')
  })
  it('shows the page and writes the workbook the same figure',()=>{
    render(<PlayoffPath path={path}/>)
    expect(screen.getByText('If you lose: 55.6%')).toBeTruthy()
    const bytes = buildWeeklyWorkbook(data,path)
    const wb = XLSX.read(bytes,{type:'array'})
    expect(XLSX.utils.sheet_to_json(wb.Sheets.Scenarios,{header:1})).toEqual([['Outcome','Estimated playoff probability (%)'],['If you win',76.4],['If you lose',55.6]])
    expect(wb.Sheets.Trend.B2.v).toBe(65.1)
    const zip = XLSX.CFB.read(bytes,{type:'array'})
    const chart = new TextDecoder().decode(new Uint8Array(XLSX.CFB.find(zip,'/xl/charts/chart4.xml')!.content as Uint8Array))
    expect(chart).toContain('<c:v>55.6</c:v>')
    expect(chart).not.toContain('55.55')
  })
})
