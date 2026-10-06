import {describe,it,expect} from 'vitest'
import {draftBackfillOptions} from '@/lib/draft-archive/backfillOptions'
describe('bounded historical batches',()=>{
 it('defaults to the current season and accepts historical page ranges',()=>{
  expect(draftBackfillOptions([],2026)).toEqual({fromSeason:2026,throughSeason:2026,limit:2,offset:0})
  expect(draftBackfillOptions(['--from-season=2018','--through-season=2025','--limit=20','--offset=40'],2026)).toEqual({fromSeason:2018,throughSeason:2025,limit:20,offset:40})
 })
 it('rejects malformed, duplicate, inverted and unbounded arguments',()=>{
  for(const args of [['--limit=21'],['--limit=0'],['--offset=-1'],['--offset=100001'],['--limit=2','--limit=3'],['--from-season=2027'],['--from-season=2025','--through-season=2024'],['--through-season=2027'],['--from-season=1899'],['--limit=1.5'],['--limit=NaN']])expect(()=>draftBackfillOptions(args,2026)).toThrow()
 })
})
