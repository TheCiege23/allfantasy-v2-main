import {describe,expect,it,vi} from 'vitest'
import {verifiedSGNativePlayer} from '@/lib/survivor-guillotine/playerCatalog'
describe('Survivor native waiver identity',()=>{
 it('requires the Sleeper source for an NFL numeric pool ID',async()=>{const findMany=vi.fn(async (_args: any)=>[{name:'Correct NFL player',position:'WR',team:'KC'}]);expect((await verifiedSGNativePlayer({sportsPlayer:{findMany}} as any,'NFL','123'))?.name).toBe('Correct NFL player');expect(findMany.mock.calls[0][0].where).toEqual({sport:'NFL',source:'sleeper',OR:[{sleeperId:'123'},{externalId:'sleeper:123'}]})})
 it('requires the Rolling Insights source for the same numeric NBA pool ID',async()=>{const findMany=vi.fn(async (_args: any)=>[{name:'Correct NBA player',position:'PG',team:'BOS'}]);await verifiedSGNativePlayer({sportsPlayer:{findMany}} as any,'NBA','123');expect(findMany.mock.calls[0][0].where).toEqual({sport:'NBA',source:'rolling_insights',OR:[{externalId:'123'}]})})
 it('resolves a native defense to its actual Sleeper team profile',async()=>{const findMany=vi.fn(async (_args: any)=>[{name:'Kansas City Chiefs',position:'DEF',team:'KC'}]);await verifiedSGNativePlayer({sportsPlayer:{findMany}} as any,'NFL','nfl:def:KC');expect(findMany.mock.calls[0][0].where.OR).toEqual([{sleeperId:'KC'},{externalId:'sleeper:KC'}])})
 it('rejects an ambiguous catalog rather than accepting the first matching name',async()=>{const findMany=vi.fn(async (_args: any)=>[{name:'Player A'},{name:'Player B'}]);expect(await verifiedSGNativePlayer({sportsPlayer:{findMany}} as any,'NFL','123')).toBeNull()})
})
