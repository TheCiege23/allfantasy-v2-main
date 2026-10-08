import {afterEach,describe,it,expect,vi} from 'vitest'
vi.mock('@/lib/observability/rootTiming',()=>({recordCompletedSpan:vi.fn()}))
import {teamLoadTiming} from '@/lib/observability/teamLoadTiming'
afterEach(()=>vi.restoreAllMocks())
describe('slow team diagnostics',()=>{
 it('preserves failures and logs fixed phases with durations only',async()=>{
  let time=0;vi.spyOn(performance,'now').mockImplementation(()=>time)
  const log=vi.spyOn(console,'info').mockImplementation(()=>{}),timing=teamLoadTiming('full'),error=new Error('private-roster-id')
  await expect(timing.read('players',async()=>{time=3000;throw error})).rejects.toBe(error)
  timing.finish();expect(log).toHaveBeenCalledWith('[team-load-timing]',JSON.stringify({mode:'full',totalMs:3000,phases:{players:3000}}))
  expect(JSON.stringify(log.mock.calls)).not.toContain('private-roster-id')
 })
 it('stays quiet for fast reads and never fails a render if the log sink throws',async()=>{
  let time=0;vi.spyOn(performance,'now').mockImplementation(()=>time)
  const log=vi.spyOn(console,'info').mockImplementation(()=>{throw new Error('sink')})
  const timing=teamLoadTiming('alerts');expect(await timing.read('league',async()=>42)).toBe(42);timing.finish();expect(log).not.toHaveBeenCalled()
  time=3000;expect(()=>timing.finish()).not.toThrow()
 })
})

it('records fixed portfolio phases without exposing translated roster data',async()=>{
 let time=0;vi.spyOn(performance,'now').mockImplementation(()=>time)
 const log=vi.spyOn(console,'info').mockImplementation(()=>{})
 const timing=teamLoadTiming('portfolio')
 expect(await timing.read('identities',async()=>{time=3100;return {privatePlayer:'fixture-id'}})).toEqual({privatePlayer:'fixture-id'})
 timing.finish()
 expect(log).toHaveBeenCalledWith('[team-load-timing]',JSON.stringify({mode:'portfolio',totalMs:3100,phases:{identities:3100}}))
 expect(JSON.stringify(log.mock.calls)).not.toContain('fixture-id')
})
