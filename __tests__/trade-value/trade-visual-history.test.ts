import { describe,it,expect } from 'vitest'
import { valueHistoryBuckets,retrospectiveRoster } from '@/lib/decision-os/trade/visualHistory'
describe('recorded trade visuals',()=>{
  it('keeps missing capture weeks as gaps and uses the last capture, never an average or zero',()=>{
    expect(valueHistoryBuckets([{day:'2026-09-08',value:100},{day:'2026-09-12',value:150},{day:'2026-09-25',value:130},{day:'2026-10-02',value:NaN}],'weeks')).toEqual([{label:'Week of 2026-09-07',day:'2026-09-12',value:150},{label:'Week of 2026-09-14',day:'2026-09-14',value:null},{label:'Week of 2026-09-21',day:'2026-09-25',value:130}])
  })
  it('attributes January to the previous NFL season and never invents prior seasons',()=>{
    expect(valueHistoryBuckets([{day:'2026-01-02',value:90},{day:'2026-09-02',value:120}],'seasons')).toEqual([{label:'2025',day:'2026-01-02',value:90},{label:'2026',day:'2026-09-02',value:120}])
  })
  it('undoes only the original swap while preserving later unrelated roster acquisitions',()=>{
    expect(retrospectiveRoster(['received','other','later'],['sent'],['received']).withoutTrade).toEqual(['other','later','sent'])
  })
  it('withholds the undo when acquired players moved or sent players returned',()=>{
    expect(retrospectiveRoster(['other','sent'],['sent'],['received'])).toEqual({moved:['received'],returned:['sent'],withoutTrade:null})
  })
})
