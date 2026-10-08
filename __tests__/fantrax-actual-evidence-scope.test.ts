// @vitest-environment node
import {describe,expect,it,vi} from 'vitest'
vi.mock('@/lib/prisma',()=>({prisma:{}}))
import {projectFantraxHistory} from '../lib/redraft/fantraxNativePresentation'
const input={seasonId:'s',leagueId:'l',info:{scoringPeriods:[{number:4,startDate:'2026-09-22',endDate:'2026-09-29'}]},teamIds:{a:'ra',b:'rb'},rosters:[{id:'ra'},{id:'rb'}],now:new Date('2026-10-07'),rows:[{week:4,homeTeam:'A',awayTeam:'B',homeTeamId:'a',awayTeamId:'b',homeScore:10,awayScore:9,played:true,isPlayoff:false}]}
describe('actual evidence scope',()=>{
 it('reports available only for both teams in the exact period',()=>expect(projectFantraxHistory({...input,sourceActualTeamPeriods:new Set(['4:a','4:b'])}).matchups[0]?.scoringEvidence.individualSourceScores).toBe('available'))
 it.each([['4:a'],['5:a','5:b'],[]])('keeps partial or wrong-week actuals unavailable: %s',keys=>expect(projectFantraxHistory({...input,sourceActualTeamPeriods:new Set(keys)}).matchups[0]?.scoringEvidence.individualSourceScores).toBe('unavailable'))
})
