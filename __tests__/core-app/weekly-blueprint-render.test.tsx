import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
const h=vi.hoisted(()=>({language:'en'}))
vi.mock('@/components/i18n/LanguageProviderClient',()=>({useOptionalLanguage:()=>({language:h.language})}))
import { WeeklyBlueprint, PlayoffPath } from '@/components/core-app/WeeklyBlueprint'
import { COMMS_OPEN_EVENT } from '@/components/core-app/comms/commsEvents'
import type { WeeklyBlueprint as Blueprint } from '@/lib/core-app/weeklyBlueprint'
import type { WeeklyPlayoffPath } from '@/lib/core-app/weeklyPlayoffPath'
const data: Blueprint={name:'Alex',teamName:'Ice Bears',leagueCount:1,sports:['NHL'],focusLeagueId:'A',actions:[{id:'A:lineup',leagueId:'A',leagueName:'Ice League',kind:'lineup',count:2,href:'/core/my-team?league=A',gameAt:'2026-10-05T12:00:00Z',source:'stored-lineup'}],actionCount:1,attentionLeagueIds:['A'],lineupReadFailed:false,coverage:[]}
const path=(probability:number,status:null|'clinched'|'eliminated'=null)=>({leagueId:'A',season:2026,period:4,points:[{period:3,probability:5,sampledAt:'2026-10-01'},{period:4,probability,sampledAt:'2026-10-04'}],historyUnavailable:false,swing:{week:4,ifWin:12,ifLose:1},league:{leagueId:'A',season:2026,period:4,you:{modelled:true,playoffPct:probability,status},assumptions:{iterations:10000,computedAt:'2026-10-04',missing:[]}}}) as WeeklyPlayoffPath
afterEach(()=>{cleanup();h.language='en';vi.restoreAllMocks()})
describe('weekly blueprint UI',()=>{
  it('withholds a stale period even when its league and season match',()=>{
    const stale=path(52)
    render(<PlayoffPath path={{...stale,league:{...stale.league!,period:5}}}/> )
    expect(screen.queryByRole('img',{name:/probability trend/})).toBeNull()
    expect(screen.queryByText('If you win: 12.0%')).toBeNull()
  })
  it('opens Chimmy with league context and an unsent brief',()=>{
    const listener=vi.fn();window.addEventListener(COMMS_OPEN_EVENT,listener)
    render(<WeeklyBlueprint data={data}/>)
    fireEvent.click(screen.getByRole('button',{name:'Ask Chimmy'}))
    expect(listener.mock.calls[0][0].detail).toMatchObject({tab:'chimmy',leagueId:'A',prefill:expect.stringContaining('Ice Bears')})
    expect(screen.getByText(/Confirm your league’s lineup lock/)).toBeTruthy()
    window.removeEventListener(COMMS_OPEN_EVENT,listener)
  })
  it('offers selectable text when clipboard access fails',async()=>{
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:vi.fn().mockRejectedValue(new Error('denied'))}})
    render(<WeeklyBlueprint data={data}/>)
    fireEvent.click(screen.getByRole('button',{name:'Copy my brief'}))
    await waitFor(()=>expect((screen.getByRole('textbox',{name:'Brief to copy'}) as HTMLTextAreaElement).value).toContain('Ice Bears'))
  })
  it('keeps a long shot actionable and provides accessible trend values',()=>{
    render(<PlayoffPath path={path(3.5)}/> )
    expect(screen.getByText(/Long shot; this is not mathematical elimination/)).toBeTruthy()
    expect(screen.getByRole('img',{name:/probability trend/})).toBeTruthy()
    expect(screen.getByRole('table')).toBeTruthy()
    expect(screen.getByText('If you win: 12.0%')).toBeTruthy()
  })
  it('does not call 99.9% clinched and translates the brief controls',()=>{
    h.language='es';render(<WeeklyBlueprint data={data} path={path(99.9)}/>)
    expect(screen.getByRole('button',{name:'Preguntar a Chimmy'})).toBeTruthy()
    expect(screen.getByText(/aún no está asegurada matemáticamente/)).toBeTruthy()
    expect(screen.getByText('>99%')).toBeTruthy()
  })
})
