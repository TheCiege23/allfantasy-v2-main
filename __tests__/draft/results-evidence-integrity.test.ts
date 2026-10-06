import { describe, expect, it } from 'vitest';
import { resultsReport } from '@/lib/draft-archive/analysisModel';
import { importedWeeklyReport } from '@/lib/draft-archive/importedWeeklyModel';
const picks=['a','b'].map((rosterId,i)=>({rosterId,playerId:'p'+i,playerName:'Player '+i,position:'WR',keeper:false}));
const teams=picks.map(p=>({rosterId:p.rosterId,name:p.rosterId}));
const rows=picks.map((p,i)=>({rosterId:p.rosterId,playerId:p.playerId,week:1,points:10-i,isStarter:true,held:true}));
const weekly={selections:picks.map(({playerId,rosterId})=>({playerId,rosterId})),expectedWeeks:[1],rows,completeDraft:true};
describe('historical result evidence integrity',()=>{
  it('never ranks conflicting duplicate player-weeks, regardless of their order',()=>{
    for(const duplicate of [rows[0],{...rows[0],points:999}]) for(const input of [[...rows,duplicate],[duplicate,...rows]]) {
      const report=resultsReport(picks,teams,input,[1]);
      expect(report.state).toBe('partial');expect(report.teams.every(t=>t.rank===null)).toBe(true);
      expect(report.teams[0].coveredPicks).toBe(0);expect(report.teams[0].points).toBe(0);
    }
  });
  it('blocks invalid weeks, team inventory, selection ownership and starter flags',()=>{
    for(const report of [resultsReport(picks,teams,rows,[1,19]),resultsReport(picks,[teams[0],teams[0]],rows,[1]),resultsReport([...picks,{...picks[0],playerId:'foreign',rosterId:'unknown'}],teams,rows,[1]),resultsReport(picks,teams,[{...rows[0],isStarter:'false' as unknown as boolean},rows[1]],[1])]) expect(report.teams.every(t=>t.rank===null)).toBe(true);
  });
  it('recomputes provisional usage from verified archive identities and preserves departure evidence',()=>{
    const result=importedWeeklyReport({...weekly,rows:[rows[0],{...rows[1],points:0,isStarter:false,held:false,secret:'private'}]},picks,teams)!;
    expect(result.report.provisional).toBe(true);expect(result.report.state).toBe('ready');
    expect(result.contributions[1].weeks[0]).toEqual({week:1,points:0,starter:false,held:false});
    expect(JSON.stringify(result)).not.toContain('private');
  });
  it('rejects wrong selections, duplicate rows, impossible departures and unscored weeks',()=>{
    for(const raw of [{...weekly,selections:[weekly.selections[0],{playerId:'foreign',rosterId:'b'}]},{...weekly,rows:[...rows,rows[0]]},{...weekly,rows:[{...rows[0],held:false},rows[1]]},{...weekly,rows:[{...rows[0],week:2},rows[1]]},{...weekly,expectedWeeks:[1,1]}]) expect(importedWeeklyReport(raw,picks,teams)).toBeNull();
  });
  it('preserves sparse coverage without usage rates or a complete rank',()=>{
    const result=importedWeeklyReport({...weekly,expectedWeeks:[1,2],rows:[rows[0]]},picks,teams)!;
    expect(result.report.state).toBe('partial');expect(result.report.teams.every(t=>t.rank===null)).toBe(true);
    expect(result.contributions.map(p=>p.usage)).toEqual([null,null]);expect(result.contributions[1].weeks).toEqual([]);
  });
  it('does not rank a verified but incomplete draft inventory',()=>{
    const result=importedWeeklyReport({...weekly,completeDraft:false},picks,teams)!;
    expect(result.report.state).toBe('partial');expect(result.report.teams.every(t=>t.rank===null)).toBe(true);
  });
});
