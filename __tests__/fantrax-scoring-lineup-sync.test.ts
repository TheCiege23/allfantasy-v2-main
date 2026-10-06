import { beforeEach, expect, it, vi } from 'vitest'
const h=vi.hoisted(()=>({ league: {findUnique:vi.fn()}, roster:{findMany:vi.fn()}, redraftRosterPlayer:{findMany:vi.fn(),updateMany:vi.fn()} }))
vi.mock('@/lib/prisma',()=>({prisma:{$transaction:async(fn:(tx:unknown)=>unknown)=>fn(h)}}))
import { syncFantraxRedraftLineups } from '@/lib/import-os/collector/syncFantraxRedraftLineups'
beforeEach(()=>{vi.resetAllMocks();h.league.findUnique.mockResolvedValue({platform:'fantrax'});h.roster.findMany.mockResolvedValue([{redraftRosterId:'rd',playerData:{lineup_sections:{starters:['new'],bench:['old'],ir:['injured']}}}]);h.redraftRosterPlayer.findMany.mockResolvedValue([{id:'1',playerId:'old',position:'QB',slotType:'QB'},{id:'2',playerId:'new',position:'RB',slotType:'bench'},{id:'3',playerId:'injured',position:'WR',slotType:'bench'},{id:'4',playerId:'absent',position:'WR',slotType:'WR'}]);h.redraftRosterPlayer.updateMany.mockResolvedValue({count:1})})
it('moves current source starters, bench and IR in the imported scoring projection',async()=>{
 expect(await syncFantraxRedraftLineups('league')).toBe(3)
 expect(h.redraftRosterPlayer.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{rosterId:'rd',droppedAt:null,acquisitionType:'imported'}}))
 expect(h.redraftRosterPlayer.updateMany.mock.calls.map(c=>c[0].data.slotType)).toEqual(['bench','RB','ir'])
 for(const [write] of h.redraftRosterPlayer.updateMany.mock.calls)expect(write.where).toMatchObject({rosterId:'rd',droppedAt:null,acquisitionType:'imported'})
 expect(h.redraftRosterPlayer.updateMany.mock.calls.flatMap(c=>c[0].where.id.in)).not.toContain('4')
})
it.each(['allfantasy','native','sleeper',null])('does not change %s league lineups',async(platform)=>{
 h.league.findUnique.mockResolvedValue({platform});expect(await syncFantraxRedraftLineups('league')).toBe(0);expect(h.roster.findMany).not.toHaveBeenCalled();expect(h.redraftRosterPlayer.updateMany).not.toHaveBeenCalled()
})
it('is idempotent and preserves an equivalent FLEX label',async()=>{
 h.redraftRosterPlayer.findMany.mockResolvedValue([{id:'2',playerId:'new',position:'RB',slotType:'FLEX'},{id:'1',playerId:'old',position:'QB',slotType:'bench'}]);expect(await syncFantraxRedraftLineups('league')).toBe(0);expect(h.redraftRosterPlayer.updateMany).not.toHaveBeenCalled()
})
it('preserves rows when the source supplies no lineup',async()=>{
 h.roster.findMany.mockResolvedValue([{redraftRosterId:'rd',playerData:{}}]);expect(await syncFantraxRedraftLineups('league')).toBe(0);expect(h.redraftRosterPlayer.updateMany).not.toHaveBeenCalled()
})
