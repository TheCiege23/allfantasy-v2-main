import {describe,it,expect} from 'vitest';
import {assetLineages,type AssetTransfer} from '@/lib/draft-archive/lineageModel';
import type {ArchivePick} from '@/lib/draft-archive/detail';
const pick={id:'pick',overall:2,round:1,originalRosterId:'original',rosterId:'receiver',playerId:'player',playerName:'Recorded player',selectedAt:'2026-09-01'} as ArchivePick;
const transfer:AssetTransfer={transactionId:'trade',at:'2026-08-01',kind:'pick',season:2026,round:1,originalRosterId:'original',from:'original',to:'receiver',packageAssets:3};
describe('source-qualified asset lineage',()=>{
  it('links a unique source asset without assigning the package price to one player',()=>{const result=assetLineages([pick],[transfer],2026,'source',true)[0];expect(result.state).toBe('linked');expect(result.edges[0]).toMatchObject({packageAssets:3,phase:'before_selection'});expect(result).not.toHaveProperty('grade');});
  it('keeps generic same-season assets unresolved across multiple drafts',()=>{expect(assetLineages([pick],[transfer],2026,'source',false)[0].state).toBe('ambiguous');expect(assetLineages([pick],[transfer],2026,'source',false)[0].edges).toEqual([]);});
  it('accepts explicit matching draft identity and rejects a different source',()=>{expect(assetLineages([pick],[{...transfer,draftId:'source'}],2026,'source',false)[0].edges).toHaveLength(1);expect(assetLineages([pick],[{...transfer,draftId:'different'}],2026,'source',true)[0].edges).toEqual([]);});
  it('preserves reversal evidence and does not guess selection time or future pick outcome',()=>{const player={...transfer,kind:'player' as const,playerId:'player',at:'2026-10-01',reversedAt:'2026-10-02'};expect(assetLineages([{...pick,selectedAt:null}],[player],2026,'source',true)[0].edges[0]).toMatchObject({phase:'selection_time_unknown',reversedAt:'2026-10-02'});expect(assetLineages([pick],[{...transfer,season:2027}],2026,'source',true)[0].edges).toEqual([]);});
});
