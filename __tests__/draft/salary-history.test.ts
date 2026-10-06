import {describe,it,expect} from 'vitest';
import {salaryHistory} from '@/lib/draft-archive/salaryHistoryModel';
const start='2026-08-01T00:00:00Z';
const basis=()=>({version:'draft-specialty-v1',capturedAt:start,salary:{state:'captured',ledgers:[{rosterId:'a',capYear:2026,capSpace:-5,totalCapHit:15,deadMoneyHit:2}],contracts:[{rosterId:'a',playerId:'p',salary:15,yearsTotal:2,contractYear:1,yearSigned:2025}]}});
describe('frozen cap history',()=>{
 it('preserves over-cap amounts and derives expiry from calendar terms',()=>{expect(salaryHistory(basis(),start,2026)).toEqual({state:'ready',teams:[{rosterId:'a',capYear:2026,capSpace:-5,totalCapHit:15,deadMoneyHit:2,contracts:1,expiring:1,recordedSalary:15,matchesLedger:true}]});});
 it('does not count future or ended contracts in this cap year',()=>{const b=basis();b.salary.contracts.push({...b.salary.contracts[0],playerId:'future',yearSigned:2027},{...b.salary.contracts[0],playerId:'ended',yearSigned:2023});expect(salaryHistory(b,start,2026).teams[0].contracts).toBe(1);});
 it('keeps ledger mismatches explicit instead of rewriting history',()=>{const b=basis();b.salary.contracts=[];expect(salaryHistory(b,start,2026)).toMatchObject({state:'partial',teams:[{contracts:0,recordedSalary:0,matchesLedger:false,totalCapHit:15}]});});
 it.each(['duplicate','wrong year','unknown owner','duplicate player','negative salary','invalid duration','future capture','overflow'])('blocks ambiguous evidence: %s',kind=>{const b=basis();switch(kind){case 'duplicate':b.salary.ledgers.push({...b.salary.ledgers[0]});break;case 'wrong year':b.salary.ledgers[0].capYear=2025;break;case 'unknown owner':b.salary.contracts[0].rosterId='b';break;case 'duplicate player':b.salary.contracts.push({...b.salary.contracts[0]});break;case 'negative salary':b.salary.contracts[0].salary=-1;break;case 'invalid duration':b.salary.contracts[0].contractYear=3;break;case 'future capture':b.capturedAt='2026-08-02T00:00:00Z';break;case 'overflow':b.salary.ledgers[0].totalCapHit=Number.MAX_SAFE_INTEGER+1;}
 expect(salaryHistory(b,start,2026)).toEqual({state:'unavailable',teams:[]});});
 it('blocks archives without a recorded cap year',()=>{expect(salaryHistory(basis(),start,null).state).toBe('unavailable');});
 it('does not expose raw identity metadata',()=>{const b=basis();Object.assign(b.salary.contracts[0],{privateOwner:'secret'});expect(JSON.stringify(salaryHistory(b,start,2026))).not.toContain('secret');});
});
