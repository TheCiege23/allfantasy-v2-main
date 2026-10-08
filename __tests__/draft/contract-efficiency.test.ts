import {describe,it,expect} from 'vitest';
import {contractEfficiency} from '@/lib/draft-archive/contractEfficiencyModel';
import type {PreparationContext} from '@/lib/core-app/draftPreparationModel';
const start='2026-08-01T00:00:00Z';
const context:PreparationContext={sport:'NFL',season:2026,leagueType:'dynasty',purpose:'startup',draftType:'auction',teamCount:2,playerPool:'all',scoring:'ppr',scoringRules:{rec:1},rosterSlots:['WR','BN']};
const basis=()=>({version:'draft-analysis-basis-v2',state:'captured',capturedAt:start,sport:'NFL',entries:[{playerId:'native',sleeperId:'p',playerName:'Frozen name',position:'WR',computedAt:'2026-07-31',perGameRates:{rec:12}}]});
const specialty=()=>({version:'draft-specialty-v1',capturedAt:start,salary:{state:'captured',ledgers:[{rosterId:'a',capYear:2026,capSpace:85,totalCapHit:15,deadMoneyHit:0,rolloverUsed:0}],contracts:[{rosterId:'a',playerId:'p',salary:15,yearsTotal:3,contractYear:1,yearSigned:2025}],rules:{version:'salary-draft-rules-v1',startupCap:100,capStartYear:2026,capGrowthPercent:0,contractMinYears:1,contractMaxYears:3,minimumSalary:0,auctionHoldback:0,rolloverEnabled:false,rolloverMax:0},deadMoney:[]}});
describe('frozen contract efficiency',()=>{
 it('binds saved aliases and calendar expiry without multiplying a one-year rate into a future forecast',()=>{
  const r=contractEfficiency(specialty(),basis(),context,start,2026);
  expect(r.state).toBe('ready');expect(r.players[0]).toMatchObject({name:'Frozen name',salary:15,remainingYears:2,remainingCommitment:30,capShare:15,baselinePerGame:12,baselinePerTenSalary:8});
  expect(r).not.toHaveProperty('grade');
 });
 it('keeps recorded costs while missing or conflicting player evidence remains unknown',()=>{
  const b=basis();b.entries[0].computedAt='2026-08-02';
  const r=contractEfficiency(specialty(),b,context,start,2026);
  expect(r.state).toBe('partial');expect(r.players[0]).toMatchObject({salary:15,baselinePerGame:null,baselinePerTenSalary:null});
  const conflict=basis();conflict.entries.push({...conflict.entries[0],playerId:'other'});
  expect(contractEfficiency(specialty(),conflict,context,start,2026).players[0].baselinePerGame).toBeNull();
 });
 it('never divides by zero salary or converts an unknown baseline to zero',()=>{
  const s=specialty();s.salary.contracts[0].salary=0;s.salary.ledgers[0].totalCapHit=0;s.salary.ledgers[0].capSpace=100;
  const r=contractEfficiency(s,basis(),context,start,2026);
  expect(r.state).toBe('partial');expect(r.players[0].baselinePerGame).toBe(12);expect(r.players[0].baselinePerTenSalary).toBeNull();
 });
 it.each(['ledger','future terms','season','scoring'])('blocks incompatible evidence: %s',kind=>{
  const s=specialty(),c={...context};
  if(kind==='ledger')s.salary.ledgers[0].capSpace=86;
  if(kind==='future terms')s.capturedAt='2026-08-02';
  if(kind==='season')c.season=2025;
  if(kind==='scoring')c.scoringRules={unknown_stat:1};
  const r=contractEfficiency(s,basis(),c,start,2026);
  if(kind==='scoring')expect(r.players[0].baselinePerGame).toBeNull();else expect(r.state).toBe('unavailable');
 });
});
