import {it,expect} from 'vitest';
import {importedResultCutoff} from '@/lib/draft-archive/resultCutoff';
it('requires a real date and completed status for a last-pick fallback',()=>{
 const now=new Date('2026-10-01');const at=Date.parse('2019-09-01');
 expect(importedResultCutoff({start_time:at,last_picked:at+1},now)).toEqual({at,basis:'provider_start'});
 expect(importedResultCutoff({status:'complete',start_time:null,last_picked:at},now)).toEqual({at,basis:'provider_last_pick'});
 for(const value of [null,0,'2019-09-01',Infinity,Date.parse('2027-01-01')])expect(importedResultCutoff({status:'complete',start_time:null,last_picked:value},now)).toBeNull();
 expect(importedResultCutoff({status:'drafting',last_picked:at},now)).toBeNull();
});
