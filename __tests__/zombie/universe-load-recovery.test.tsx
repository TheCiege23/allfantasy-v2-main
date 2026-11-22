// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react'
const m=vi.hoisted(()=>({universeId:'fixture-universe',replace:vi.fn(),fetch:vi.fn()}))
vi.mock('next/navigation',()=>({useParams:()=>({universeId:m.universeId}),useRouter:()=>({replace:m.replace})}))
vi.mock('@/components/zombie/ZombieUniverseRenewalPanel',()=>({ZombieUniverseRenewalPanel:()=> <div>Renewal controls</div>}))
vi.mock('@/app/zombie/components/ZombieEventFeed',()=>({ZombieEventFeed:()=>null}))
vi.mock('@/components/commissioner-hub/CommissionerFeederGrid',()=>({CommissionerFeederGrid:()=>null}))
import ZombieUniverseHubPage from '@/app/zombie/universe/[universeId]/page'
const payload={universe:{id:'fixture-universe',name:'Fixture universe',sport:'NFL',season:2026,levels:[],leagues:[{leagueId:'gamma',name:'Gamma'},{leagueId:'alpha',name:'Alpha'}]},seasons:[2026],counts:{survivorCount:14,zombieCount:0,whispererCount:2,leagueCount:2},animations:[],announcements:[],topByPpw:[]}
const response=(status:number,data:unknown=payload)=>({ok:status===200,status,json:async()=>data})
describe('universe loading recovery',()=>{
 beforeEach(()=>{m.universeId='fixture-universe';m.fetch.mockReset();m.replace.mockReset();vi.stubGlobal('fetch',m.fetch)})
 afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals()})
 it('replaces the spinner with sign-in and a safe return link when Safari has no session',async()=>{
  m.fetch.mockResolvedValue(response(401));render(<ZombieUniverseHubPage/>);
  expect(screen.getByRole('status').textContent).toContain('Loading universe')
  await screen.findByRole('heading',{name:'Sign in to your Zombie universe'})
  expect(screen.queryByRole('status')).toBeNull()
  expect(screen.getByRole('link',{name:'Sign in'}).getAttribute('href')).toBe('/login?callbackUrl=%2Fzombie%2Funiverse%2Ffixture-universe')
  expect(screen.queryByText('Renewal controls')).toBeNull()
  expect(m.fetch.mock.calls[0][1]).toMatchObject({credentials:'include',cache:'no-store'})
 })
 it.each([[403,'Commissioner access required'],[404,'Universe not found'],[500,'Unable to load your universe']])('ends loading for HTTP %s',async(status,title)=>{
  m.fetch.mockResolvedValue(response(status as number));render(<ZombieUniverseHubPage/>);
  await screen.findByRole('heading',{name:title as string});expect(screen.queryByRole('status')).toBeNull()
  expect(screen.getByRole('button',{name:'Try again'})).toBeTruthy()
  expect(screen.queryByText('Renewal controls')).toBeNull()
 })
 it('retries a network failure and displays the loaded universe',async()=>{
  m.fetch.mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(response(200));render(<ZombieUniverseHubPage/>);
  await screen.findByRole('heading',{name:'Unable to load your universe'});
  fireEvent.click(screen.getByRole('button',{name:'Try again'}));
  await screen.findByRole('heading',{name:'Fixture universe'});
  expect(screen.getByText('Renewal controls')).toBeTruthy();expect(m.fetch).toHaveBeenCalledTimes(2)
  expect(screen.queryByRole('alert')).toBeNull()
 })
 it('offers recovery instead of an endless spinner when a request times out',async()=>{
  vi.useFakeTimers();m.fetch.mockImplementation((_url,options)=>new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')))));
  render(<ZombieUniverseHubPage/>);await act(async()=>{await vi.advanceTimersByTimeAsync(15000)});
  expect(screen.getByRole('heading',{name:'The universe is taking too long to load'})).toBeTruthy()
  expect(screen.queryByRole('status')).toBeNull();expect(m.fetch.mock.calls[0][1].signal.aborted).toBe(true)
 })
 it('does not let an old unauthorized response replace a newly loaded universe',async()=>{
  let resolveOld!:(value:unknown)=>void
  m.fetch.mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve})).mockResolvedValueOnce(response(200));
  const view=render(<ZombieUniverseHubPage/>);m.universeId='new-universe';view.rerender(<ZombieUniverseHubPage/>);
  await screen.findByRole('heading',{name:'Fixture universe'});
  await act(async()=>{resolveOld(response(401))});
  expect(screen.queryByRole('alert')).toBeNull();expect(screen.getByText('Renewal controls')).toBeTruthy()
  expect(m.fetch.mock.calls[0][1].signal.aborted).toBe(true)
 })
 it('shows recovery when an OK response lacks its universe',async()=>{
  m.fetch.mockResolvedValue(response(200,{}));render(<ZombieUniverseHubPage/>);
  await screen.findByRole('heading',{name:'Unable to load your universe'});expect(screen.queryByRole('status')).toBeNull()
 })
 it('aborts the request when leaving the page',()=>{
  m.fetch.mockImplementation(()=>new Promise(()=>{}));const view=render(<ZombieUniverseHubPage/>);view.unmount();
  expect(m.fetch.mock.calls[0][1].signal.aborted).toBe(true)
 })
})
