import React from 'react'
import {render,screen,cleanup,fireEvent,act,waitFor} from '@testing-library/react'
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest'
vi.mock('@/components/i18n/LanguageProviderClient',()=>({useOptionalLanguage:()=>({language:'en'})}))
import TeamAlerts from '@/components/core-app/TeamAlerts'
const fetcher=vi.fn()
const empty={available:true,alerts:[],delivery:[]}
async function open(){const view=render(<TeamAlerts leagueId="a"/>);const details=view.container.querySelector('details')!;details.open=true;fireEvent(details,new Event('toggle'));return view}
beforeEach(()=>{vi.stubGlobal('fetch',fetcher);fetcher.mockReset()})
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals()})
describe('alert request recovery',()=>{
 it('shows a retry message when the request hangs and ignores its late result',async()=>{
  vi.useFakeTimers();let resolve!:(value:any)=>void
  fetcher.mockImplementation(()=>new Promise(r=>{resolve=r}))
  await open();expect(fetcher).toHaveBeenCalledTimes(1)
  await act(async()=>{await vi.advanceTimersByTimeAsync(15000)})
  expect(screen.getByRole('status').textContent).toContain('unavailable')
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true)
  await act(async()=>resolve({ok:true,json:async()=>empty}))
  expect(screen.getByRole('status').textContent).toContain('unavailable')
 })
 it('refreshes after reconnect, coalesces adjacent resume events and clears old private data on 401',async()=>{
  fetcher.mockResolvedValue({ok:true,json:async()=>empty});await open()
  await screen.findByText(/No upcoming alerts/)
  fetcher.mockResolvedValue({ok:false,status:401})
  act(()=>{window.dispatchEvent(new Event('online'));window.dispatchEvent(new Event('pageshow'))})
  await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(2))
  await screen.findByText(/Alert evidence is unavailable/)
  expect(screen.queryByText(/No upcoming alerts/)).toBeNull()
 })
 it('cancels an old league request and cannot display its response in the new league',async()=>{
  let finish!:(value:any)=>void;fetcher.mockImplementationOnce(()=>new Promise(r=>{finish=r})).mockResolvedValue({ok:true,json:async()=>empty})
  const view=await open();const oldSignal=fetcher.mock.calls[0][1].signal
  view.rerender(<TeamAlerts leagueId="b"/>);await screen.findByText(/No upcoming alerts/)
  expect(oldSignal.aborted).toBe(true);expect(fetcher.mock.calls[1][0]).toContain('league=b')
  await act(async()=>finish({ok:true,json:async()=>({available:false,alerts:[]})}))
  expect(screen.queryByText(/Alert evidence is unavailable/)).toBeNull()
 })
})
