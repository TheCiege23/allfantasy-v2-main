import {describe,it,expect} from 'vitest';
import {playerContributions} from '@/lib/draft-archive/resultsDecisionModel';
const pick={playerId:'p',playerName:'Player',rosterId:'a',position:'WR',keeper:false};
const row={playerId:'p',rosterId:'a',week:1,points:10,isStarter:true};
describe('weekly original-team contribution',()=>{
  it('separates starts, bench production and later production on another team',()=>{
    const [p]=playerContributions([pick],[row,{...row,week:2,points:30,isStarter:false},{...row,rosterId:'b',week:3,points:100},{...row,week:3,points:-2}], [1,2,3]);
    expect(p.totalPoints).toBe(38);expect(p.starterPoints).toBe(8);expect(p.starts).toBe(2);expect(p.usage).toBe(2/3);expect(p.earlyStarterPoints).toBe(10);expect(p.lateStarterPoints).toBe(-2);
  });
  it('keeps sparse rows partial without fabricating zeroes or usage',()=>{
    const [p]=playerContributions([pick],[row],[1,2]);expect(p.state).toBe('partial');expect(p.weeks).toHaveLength(1);expect(p.usage).toBeNull();expect(p.lateStarterPoints).toBeNull();
  });
  it('rejects duplicate weekly rows and does not count unfinalized weeks',()=>{
    expect(playerContributions([pick],[row,row],[1])).toEqual([]);
    expect(playerContributions([pick],[row],[])).toEqual([]);
  });
});
