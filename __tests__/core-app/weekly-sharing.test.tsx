import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as XLSX from 'xlsx'
import { WeeklySharing } from '@/components/core-app/WeeklySharing'
import { buildWeeklyWorkbook } from '@/lib/core-app/weeklyWorkbook'
import { rivalryNarrative, weeklySocialPost, WEEK_SOCIALS } from '@/lib/core-app/weeklyShare'
import type { WeeklyBlueprint } from '@/lib/core-app/weeklyBlueprint'
import type { WeeklyPlayoffPath } from '@/lib/core-app/weeklyPlayoffPath'
import { COMMS_OPEN_EVENT } from '@/components/core-app/comms/commsEvents'
const data: WeeklyBlueprint = {name:'Alex',teamName:'Ice Bears',leagueCount:1,sports:['NHL'],focusLeagueId:'private-id',actions:[],actionCount:0,attentionLeagueIds:[],lineupReadFailed:false,coverage:[],rivalry:{opponent:'Rivals',wins:6,losses:2,ties:1,winningStreak:4,losingStreak:0,final:false},commissionerLeagueIds:['private-id']}
const path = {season:2026,period:4,historyUnavailable:false,points:[{period:2,probability:25,sampledAt:'2026-09-20'},{period:4,probability:52,sampledAt:'2026-10-04'}],swing:{week:4,ifWin:70,ifLose:30},league:{season:2026,you:{modelled:true,playoffPct:52},assumptions:{iterations:10000,computedAt:'2026-10-04',missing:['No division model']}}} as WeeklyPlayoffPath
afterEach(()=>{cleanup();vi.restoreAllMocks()})
describe('weekly sharing and Excel',()=>{
  it('uses proven streaks and withholds future motivation for final games',()=>{
    expect(rivalryNarrative(data)).toContain('Let’s make it 5!')
    expect(rivalryNarrative({...data,rivalry:{...data.rivalry!,final:true}})).not.toContain('Let’s make')
    expect(rivalryNarrative({...data,rivalry:undefined})).toBe('')
  })
  it('offers every platform without publishing private league URLs or fabricated odds',()=>{
    for(const platform of WEEK_SOCIALS) {
      const text=weeklySocialPost(data,platform)
      expect(text).not.toContain('private-id'); expect(text).not.toContain('Estimated playoff odds')
      expect(text).toContain('https://www.allfantasy.ai/core/week')
    }
    expect(Array.from(weeklySocialPost({...data,teamName:'🎉'.repeat(300)},'X')).length).toBeLessThan(280)
  })
  it('keeps exports literal and creates real chart relationships with no interpolated periods',()=>{
    const bytes=buildWeeklyWorkbook({...data,teamName:'=HYPERLINK("https://invalid")'},path)
    const wb=XLSX.read(bytes,{type:'array'})
    expect(wb.SheetNames).toEqual(['Brief','Actions','Trend','Scenarios','Coverage','Model'])
    expect(XLSX.utils.sheet_to_json(wb.Sheets.Trend,{header:1})).toHaveLength(3)
    expect(wb.Sheets.Brief.B2.f).toBeUndefined()
    const zip=XLSX.CFB.read(bytes,{type:'array'})
    const part=(name:string)=>new TextDecoder().decode(new Uint8Array(XLSX.CFB.find(zip,`/${name}`)!.content as Uint8Array))
    expect(part('xl/charts/chart3.xml')).toContain('<c:lineChart>')
    expect(part('xl/charts/chart4.xml')).toContain('<c:barChart>')
    expect(part('xl/worksheets/sheet3.xml')).toContain('r:id="rId1"')
    expect(part('[Content_Types].xml')).toContain('/xl/charts/chart3.xml')
    const noOdds=buildWeeklyWorkbook(data,null)
    expect(XLSX.CFB.find(XLSX.CFB.read(noOdds,{type:'array'}),'xl/charts/chart3.xml')).toBeNull()
  })
  it('copies the selected caption, excludes rivalry on request, and opens an unsent commissioner prompt',async()=>{
    const copy=vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:copy}})
    const listener=vi.fn();window.addEventListener(COMMS_OPEN_EVENT,listener)
    render(<WeeklySharing data={data}/>)
    fireEvent.change(screen.getByRole('combobox'),{target:{value:'TikTok'}})
    fireEvent.click(screen.getByRole('button',{name:'Copy post'}))
    await waitFor(()=>expect(copy).toHaveBeenCalledWith(expect.stringContaining('fantasy blueprint')))
    fireEvent.click(screen.getByRole('checkbox'))
    expect((screen.getByRole('textbox',{name:'Social post to copy'}) as HTMLTextAreaElement).value).not.toContain('Rivals')
    fireEvent.click(screen.getByRole('button',{name:'Prepare with Chimmy'}))
    expect(listener.mock.calls[0][0].detail).toMatchObject({tab:'chimmy',leagueId:'private-id',prefill:expect.stringContaining('announcement')})
    window.removeEventListener(COMMS_OPEN_EVENT,listener)
  })
  it('does not expose commissioner tools to a member',()=>{
    render(<WeeklySharing data={{...data,commissionerLeagueIds:[]}}/>)
    expect(screen.queryByText('Commissioner weekly plan')).toBeNull()
  })
})
