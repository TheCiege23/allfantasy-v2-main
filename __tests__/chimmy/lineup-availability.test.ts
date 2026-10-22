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
it('reads an NFL player with no team as inactive when no live report says otherwise',async()=>{
 injury.mockResolvedValueOnce(new Map([['signed','Questionable']]))
 const result=await enrichLineupAvailability('nfl',new Map([
  ['released',{name:'Joey Bosa',position:'DL',team:null,injury:null}],
  ['fa',{name:'Bobby Wagner',position:'LB',team:'FA',injury:'Inactive'}],
  ['signed',{name:'Just Signed',position:'LB',team:null,injury:null}],
  ['rostered',{name:'Del\'Shawn Phillips',position:'LB',team:'ARI',injury:null}],
  ['unnamed',{name:null,position:null,team:null,injury:null}],
 ]))
 expect(unavailableForLineup(result.get('released')?.injury)).toBe(true)
 expect(unavailableForLineup(result.get('fa')?.injury)).toBe(true)
 expect(result.get('signed')?.injury).toBe('Questionable')
 expect(result.get('rostered')?.injury).toBeNull()
 expect(result.get('unnamed')?.injury).toBeNull()
})
it('leaves a teamless player alone outside the NFL',async()=>{
 const result=await enrichLineupAvailability('PGA',new Map([['golfer',{name:'A Golfer',position:'G',team:null,injury:null}]]))
 expect(result.get('golfer')?.injury).toBeNull()
})
