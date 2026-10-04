// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
const h=vi.hoisted(()=>({read:vi.fn(),write:vi.fn()}))
vi.mock('@/lib/prisma',()=>({prisma:{sportsDataCache:{findMany:h.read,upsert:h.write}}}))
import { readWeeklyPlayoffPath, validPlayoffPoint } from '@/lib/core-app/weeklyPlayoffPath'
import type { OutlookLeague } from '@/lib/core-app/seasonOutlook'
const league={leagueId:'A',season:2026,you:{modelled:true,rosterId:'r1',playoffPct:3.5},assumptions:{computedAt:'2026-10-04T12:00:00Z'}} as OutlookLeague
const point=(period:number,probability:number)=>({period,probability,sampledAt:'2026-10-03T12:00:00Z'})
beforeEach(()=>{vi.resetAllMocks();h.read.mockResolvedValue([]);h.write.mockResolvedValue({})})
describe('weekly playoff snapshots',()=>{
  it.each([point(0,50),point(1,101),point(1,NaN),{...point(1,50),sampledAt:'bad'}])('rejects invalid snapshots %j', p=>expect(validPlayoffPoint(p)).toBe(false))
  it('keeps past snapshots and writes just the current period',async()=>{
    h.read.mockResolvedValue([{data:point(5,80)},{data:point(2,10)},{data:point(3,5)},{data:point(0,90)}])
    const out=await readWeeklyPlayoffPath('u',league,null,2026,4)
    expect(out.points.map(p=>[p.period,p.probability])).toEqual([[2,10],[3,5],[4,3.5]])
    expect(h.write.mock.calls[0][0].where.cacheKey).toMatch(/:4$/)
  })
  it('isolates snapshots by user, team, league and season',async()=>{
    await readWeeklyPlayoffPath('u',league,null,2026,4)
    await readWeeklyPlayoffPath('v',league,null,2026,4)
    await readWeeklyPlayoffPath('u',{...league,you:{...league.you!,rosterId:'r2'}},null,2026,4)
    expect(new Set(h.write.mock.calls.map(c=>c[0].where.cacheKey)).size).toBe(3)
  })
  it('retains the current calculation when history storage fails',async()=>{
    h.read.mockRejectedValue(new Error('storage unavailable'))
    const out=await readWeeklyPlayoffPath('u',league,null,2026,4)
    expect(out.historyUnavailable).toBe(true);expect(out.points).toEqual([{...point(4,3.5),sampledAt:league.assumptions.computedAt}]);expect(h.write).not.toHaveBeenCalled()
  })
  it('does not store another season or an unmodelled team',async()=>{
    await readWeeklyPlayoffPath('u',league,null,2025,4)
    await readWeeklyPlayoffPath('u',{...league,you:{...league.you!,modelled:false}},null,2026,4)
    expect(h.write).not.toHaveBeenCalled()
  })
})
