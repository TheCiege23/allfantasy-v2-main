import {describe,it,expect} from 'vitest'
import {realizedReceipt} from '@/lib/decision-os/trade/realizedReceipt'
const a={name:'Player',creditedBySeason:{'2026':50},departed:null}
const side={ownerId:'owner',playersIn:[a],playersOut:[{...a,name:'Sent',creditedBySeason:{'2026':25}}],picksIn:[],picksOut:[],seasonNets:[{season:'2026',net:25,partial:true}]}
const payload=()=>({version:2,sleeperLeagueId:'league',fetchedAt:'2026-10-03T12:00:00Z',staleAsOf:null,missing:[],contextNotes:[],trades:[{id:'league:tx',multiTeam:false,sides:[structuredClone(side),{...structuredClone(side),ownerId:'other'}]}]})
const args={leagueId:'league',transactionId:'tx',ownerId:'owner',expiresAt:new Date('2026-10-03T18:00:00Z'),now:new Date('2026-10-03T13:00:00Z')}
describe('historical receipts',()=>{
  it('requires an exact league, transaction and participant match',()=>{
    expect(realizedReceipt(payload(),args)).toMatchObject({receivedPoints:50,sentPoints:25,ongoing:true,stale:false})
    expect(realizedReceipt(payload(),{...args,ownerId:'stranger'})).toBeNull()
    expect(realizedReceipt(payload(),{...args,leagueId:'other'})).toBeNull()
    expect(realizedReceipt(payload(),{...args,transactionId:'another'})).toBeNull()
  })
  it('withholds aggregates for missing data and pending picks rather than calling them zero',()=>{
    const data=payload();data.missing=['2026: weekly stat lines']
    expect(realizedReceipt(data,args)).toMatchObject({receivedPoints:null,sentPoints:null})
    const pending=payload() as any;pending.trades[0].sides[0].picksIn=[{label:'2027 R1',pending:true,rerouted:false,resolved:null}]
    expect(realizedReceipt(pending,args)).toMatchObject({receivedPoints:null,sentPoints:25})
    expect(realizedReceipt(pending,args)?.assets.at(-2)?.points).toBeNull()
  })
  it('preserves negative actual points and identifies stale ledgers and rerouted pick outcomes',()=>{
    const data=payload() as any;data.trades[0].sides[0].playersIn[0].creditedBySeason={'2026':-2};data.trades[0].sides[0].picksOut=[{label:'2026 R1',pending:false,rerouted:true,resolved:null}]
    const receipt=realizedReceipt(data,{...args,now:new Date('2026-10-04T12:00:00Z')})
    expect(receipt).toMatchObject({receivedPoints:-2,sentPoints:null,stale:true})
    expect(receipt?.assets.at(-1)?.status).toContain('Flipped before the draft')
  })
  it('refuses malformed numbers and multi-party caches',()=>{
    const data=payload();data.trades[0].multiTeam=true;expect(realizedReceipt(data,args)).toBeNull()
    data.trades[0].multiTeam=false;data.trades[0].sides[0].playersIn[0].creditedBySeason['2026']=NaN;expect(realizedReceipt(data,args)).toBeNull()
  })
})
