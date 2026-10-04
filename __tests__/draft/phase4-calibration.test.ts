import {describe,it,expect} from 'vitest';
import {calibrateDraftModel,validCalibration,calibratedScores,type CalibrationCohort} from '@/lib/draft-archive/calibrationModel';
const now=new Date('2026-01-01');
const cohort=(i:number,season:number):CalibrationCohort=>({leagueId:`league-${season}-${i}`,draftId:`draft-${season}-${i}`,season,startedAt:`${season}-08-01`,observedAt:'2025-12-31',finalThroughWeek:18,teams:[0,1,2].map(j=>({rosterId:String(j),components:[100-j*50,j*50,50,50],outcome:j*50}))});
const cohorts=[...Array.from({length:30},(_,i)=>cohort(i,2024)),...Array.from({length:15},(_,i)=>cohort(i,2025))];
describe('grade publication evidence',()=>{
  it('fits older leagues only and validates on independent later-season leagues',()=>{
    const model=calibrateDraftModel(cohorts,now);expect(model.state).toBe('validated');expect(model.weights).toEqual([0,1,0,0]);expect(model.trainingLeagues).toBe(30);expect(model.holdoutLeagues).toBe(15);expect(model.modelError).toBe(0);expect(validCalibration(model,now)).not.toBeNull();
  });
  it('blocks too few seasons, recycled leagues, sparse data and future observations',()=>{
    expect(calibrateDraftModel(cohorts.slice(0,30),now).weights).toBeNull();
    expect(calibrateDraftModel(cohorts.map(c=>({...c,leagueId:'one-league'})),now).weights).toBeNull();
    expect(calibrateDraftModel(cohorts.map(c=>({...c,finalThroughWeek:3})),now).weights).toBeNull();
    expect(calibrateDraftModel(cohorts.map(c=>({...c,observedAt:'2027-01-01'})),now).weights).toBeNull();
  });
  it('does not refit when the held-out result contradicts training',()=>{
    const model=calibrateDraftModel(cohorts.map(c=>c.season===2025?{...c,teams:c.teams.map(t=>({...t,outcome:100-t.outcome}))}:c),now);
    expect(model.state).toBe('failed_validation');expect(model.weights).toBeNull();
  });
  it('never applies a later model, an in-sample model or missing components to the original draft',()=>{
    const model=calibrateDraftModel(cohorts,now),row={rosterId:'a',name:'A',values:[1,1,1,1] as [number,number,number,number],scores:[100,100,100,100] as [number,number,number,number],marketDiscount:null,benchmarkPicks:0,totalPicks:1};
    expect(calibratedScores([row],model,2026,'2026-09-01')[0].grade).toBe('A');
    expect(calibratedScores([row],model,2025,'2026-09-01')[0].grade).toBeNull();
    expect(calibratedScores([row],model,2026,'2025-09-01')[0].grade).toBeNull();
    expect(calibratedScores([{...row,scores:[null,100,100,100]}],model,2026,'2026-09-01')[0].grade).toBeNull();
  });
  it('rejects false publication evidence',()=>{
    const model=calibrateDraftModel(cohorts,now);expect(validCalibration({...model,trainingLeagues:1},now)).toBeNull();expect(validCalibration({...model,improvement:0},now)).toBeNull();expect(validCalibration({...model,weights:[.5,.5,.5,.5]},now)).toBeNull();
  });
  it('strips extra stored fields and rejects malformed count types',()=>{
    const model=calibrateDraftModel(cohorts,now);expect(validCalibration({...model,privateLeagueIds:['secret']},now)).not.toHaveProperty('privateLeagueIds');expect(validCalibration({...model,trainingTeams:undefined},now)).toBeNull();expect(validCalibration({...model,trainingLeagues:'30'},now)).toBeNull();
  });
});
