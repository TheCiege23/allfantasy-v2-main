// @vitest-environment jsdom
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest'
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
const m=vi.hoisted(()=>({value:null as unknown,proposal:{version:1,reason:'Reviewed test placements',replaceRecordedMovement:false,pools:[{key:'pool',templateLeagueId:'old',levelId:'gamma',name:'Gamma',seats:8}],placements:[{userId:'user',poolId:'pool'}]},fetch:vi.fn()}))
vi.mock('@/components/zombie/ZombieUniverseAllocationEditor',()=>({ZombieUniverseAllocationEditor:({onInvalidate,onPreview}:{onInvalidate:()=>void;onPreview:(data:unknown,proposal:unknown)=>void})=><div><button onClick={()=>onPreview(m.value,m.proposal)}>Review fixture proposal</button><button onClick={onInvalidate}>Edit fixture proposal</button></div>}))
import {ZombieUniverseRenewalPanel} from '@/components/zombie/ZombieUniverseRenewalPanel'
const result={nextSeason:2027,leagues:[{previousLeagueId:'old',leagueId:'next',draftId:'draft',name:'Gamma 2027'}]}
function preview(){return {completed:false,season:2026,nextSeason:2027,previewHash:'a'.repeat(64),openSeats:7,pools:[{leagueId:'pool',levelId:'gamma',name:'Gamma',seats:8}],assignments:[{userId:'user',rosterId:'roster',displayName:'Returning manager',destinationLeagueId:'pool',destinationLevelId:'gamma',slot:1,movement:'watch',nextFaab:100,faabRule:'reset'}]}}
function open(){render(<ZombieUniverseRenewalPanel universeId="universe" season={2026}/>);fireEvent.click(screen.getByRole('button',{name:'Edit placements and capacity',exact:true}))}
describe('reviewed season approval UI',()=>{
 beforeEach(()=>{m.value=preview();m.fetch.mockReset();vi.stubGlobal('fetch',m.fetch)})
 afterEach(()=>{cleanup();vi.unstubAllGlobals()})
 it('shows existing season links when another tab has already completed renewal',()=>{
  m.value={completed:true,result};open();fireEvent.click(screen.getByRole('button',{name:'Review fixture proposal'}))
  expect(screen.getByRole('link',{name:'Gamma 2027'}).getAttribute('href')).toBe('/league/next/draft')
  expect(screen.queryByRole('button',{name:'Create season 2027',exact:true})).toBeNull()
  expect(m.fetch).not.toHaveBeenCalled()
 })
 it('clears approval and removes the old executable preview after a plan edit',()=>{
  open();fireEvent.click(screen.getByRole('button',{name:'Review fixture proposal'}))
  const create=screen.getByRole('button',{name:'Create season 2027',exact:true}) as HTMLButtonElement
  expect(create.disabled).toBe(true)
  fireEvent.click(screen.getByRole('checkbox',{name:'I reviewed the placements and the fresh-season resets.'}))
  expect(create.disabled).toBe(false)
  fireEvent.click(screen.getByRole('button',{name:'Edit fixture proposal'}))
  expect(screen.queryByRole('button',{name:'Create season 2027',exact:true})).toBeNull()
  fireEvent.click(screen.getByRole('button',{name:'Review fixture proposal'}))
  expect((screen.getByRole('button',{name:'Create season 2027',exact:true}) as HTMLButtonElement).disabled).toBe(true)
 })
 it('executes only the accepted proposal with its content fingerprint',async()=>{
  m.fetch.mockResolvedValue({ok:true,json:async()=>result})
  open();fireEvent.click(screen.getByRole('button',{name:'Review fixture proposal'}))
  fireEvent.click(screen.getByRole('checkbox',{name:'I reviewed the placements and the fresh-season resets.'}))
  fireEvent.click(screen.getByRole('button',{name:'Create season 2027',exact:true}))
  await waitFor(()=>expect(screen.getByRole('link',{name:'Gamma 2027'})).toBeTruthy())
  expect(m.fetch).toHaveBeenCalledTimes(1)
  const [url,options]=m.fetch.mock.calls[0]
  expect(url).toBe('/api/zombie-universe/universe/renew')
  expect(options.method).toBe('POST')
  expect(JSON.parse(options.body)).toEqual({season:2026,previewHash:'a'.repeat(64),proposal:m.proposal})
 })
})
