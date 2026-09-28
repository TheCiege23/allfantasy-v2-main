// @vitest-environment node
import { expect, it, vi } from 'vitest'
const injury = vi.hoisted(()=>vi.fn(async(..._args:unknown[])=>new Map<string,string>()))
vi.mock('@/lib/core-app/injuryStatusById',()=>({readInjuryStatusById:injury}))
import {enrichLineupAvailability,unavailableForLineup} from '@/lib/chimmy/lineupAvailability'
it('uses the current club-matched report instead of an old vendor availability tag',async()=>{
 injury.mockResolvedValueOnce(new Map([['out','IR'],['cleared','Active']]))
 const result=await enrichLineupAvailability('NFL',new Map([
  ['out',{name:'Omar Cooper',position:'WR',team:'NYJ',injury:'Active'}],
  ['cleared',{name:'Healthy Again',position:'RB',team:'ATL',injury:'INACT'}],
 ]))
 expect(result.get('out')?.injury).toBe('IR')
 expect(unavailableForLineup(result.get('out')?.injury)).toBe(true)
 expect(result.get('cleared')?.injury).toBeNull()
 expect(unavailableForLineup(result.get('cleared')?.injury)).toBe(false)
 expect(injury).toHaveBeenCalledTimes(1)
 expect(injury.mock.calls[0]?.[2]).toEqual(new Map([['out','NYJ'],['cleared','ATL']]))
})
