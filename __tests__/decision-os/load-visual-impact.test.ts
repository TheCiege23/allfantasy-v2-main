import {beforeEach,describe,it,expect,vi} from 'vitest'
const mocks=vi.hoisted(()=>({world:vi.fn(),viewer:vi.fn(),basis:vi.fn(),price:vi.fn()}))
vi.mock('@/lib/decision-os/world',()=>({resolveCanonicalWorld:mocks.world}))
vi.mock('@/lib/trade-intel/viewerLeagueRoster',()=>({resolveViewerLeagueRoster:mocks.viewer}))
vi.mock('@/lib/decision-os/trade/leagueWeekPricing',()=>({leagueWeekBasis:mocks.basis,isLeagueWeekRefusal:(b:unknown)=>Boolean(b && typeof b==='object' && 'refuse' in b),priceLeagueWeek:mocks.price}))
import {loadVisualImpact} from '@/lib/decision-os/trade/loadVisualImpact'
beforeEach(()=>{vi.clearAllMocks();mocks.world.mockResolvedValue({teams:[],rosters:[{rosterId:'r',playerIds:['got','other']}],league:{season:2026,sport:'NFL',rosterSettings:{starterSlots:['RB']},scoringSettings:{rec:.5}},provenance:{provider:'sleeper',freshness:{lastSyncedAt:'2026-10-03',isStale:false}}});mocks.viewer.mockResolvedValue({ok:true,team:{externalId:'1'},roster:{id:'r'}});mocks.basis.mockResolvedValue({rules:{rec:.5},week:{season:'2026',week:5}});mocks.price.mockResolvedValue(new Map([['got',{playerId:'got',position:'RB',projectedPoints:20}],['sent',{playerId:'sent',position:'RB',projectedPoints:10}],['other',{playerId:'other',position:'RB',projectedPoints:5}]]))})
const args={leagueId:'l',userId:'u',sent:['sent'],received:['got'],completed:true}
describe('current roster impact',()=>{
  it('does not turn a pick-only trade into a claimed zero lineup effect',async()=>{
    expect(await loadVisualImpact({...args,sent:[],received:[]})).toMatchObject({impact:null,reason:expect.stringContaining('no original player swap')})
    expect(mocks.price).not.toHaveBeenCalled()
  })
  it('compares the hypothetical undo to today’s actual roster in league weekly points',async()=>{
    expect((await loadVisualImpact(args)).impact).toMatchObject({unit:'league_points_week',week:5,startingPointsBefore:10,startingPointsAfter:20,startingPointsDelta:10})
  })
  it('refuses a moved acquisition before pricing projections',async()=>{
    const world=await mocks.world();world.rosters[0].playerIds=['other'];mocks.world.mockResolvedValue(world)
    expect(await loadVisualImpact(args)).toMatchObject({impact:null,moved:['got']});expect(mocks.price).not.toHaveBeenCalled()
  })
  it('refuses colliding foreign roster ids and a different season’s feed',async()=>{
    const world=await mocks.world();world.provenance.provider='espn';mocks.world.mockResolvedValue(world)
    expect((await loadVisualImpact(args)).reason).toMatch(/roster mapping/);expect(mocks.price).not.toHaveBeenCalled()
    world.provenance.provider='sleeper';world.league.season=2025
    expect((await loadVisualImpact(args)).reason).toMatch(/season/);expect(mocks.price).not.toHaveBeenCalled()
  })
})
