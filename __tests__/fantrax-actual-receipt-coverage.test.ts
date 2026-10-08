// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from 'vitest'
const db=vi.hoisted(()=>({league:{findUnique:vi.fn()},redraftRoster:{findMany:vi.fn()},leaguePlayerWeeklyScore:{groupBy:vi.fn()},sportsDataCache:{findMany:vi.fn()}}))
vi.mock('@/lib/prisma',()=>({prisma:db}))
import {loadFantraxNativePresentation} from '../lib/redraft/fantraxNativePresentation'
const season={id:'s',leagueId:'l',season:2026}
beforeEach(()=>{vi.clearAllMocks();db.league.findUnique.mockResolvedValue({platform:'fantrax',platformLeagueId:'snapshot',sport:'NCAAF',season:2026,settings:{fantrax_scoring_periods:[{number:4,startDate:'2026-09-22',endDate:'2026-09-29'}],fantrax_native_team_ids:{a:'ra',b:'rb'},fantrax_schedule:[{week:4,homeTeamId:'a',awayTeamId:'b',homeTeam:'A',awayTeam:'B',homeScore:10,awayScore:9,played:true,isPlayoff:false}]}});db.redraftRoster.findMany.mockResolvedValue([{id:'ra'},{id:'rb'}]);db.sportsDataCache.findMany.mockResolvedValue([{data:{verified:true,period:4,sourceTeamId:'a',rosterId:1,rows:1}},{data:{verified:true,period:4,sourceTeamId:'b',rosterId:2,rows:1}}]);db.leaguePlayerWeeklyScore.groupBy.mockResolvedValue([{week:4,rosterId:1,isStarter:true,_count:{_all:1},_sum:{points:10}},{week:4,rosterId:2,isStarter:true,_count:{_all:1},_sum:{points:9}}])})
describe('receipt-backed actual availability',()=>{
 it('requires matching stored row counts and source sums',async()=>{expect((await loadFantraxNativePresentation(season))?.matchups[0]?.scoringEvidence.individualSourceScores).toBe('available');expect(db.leaguePlayerWeeklyScore.groupBy.mock.calls[0]![0].where).toEqual({leagueId:'snapshot',seasonYear:2026,source:'fantrax'})})
 it('does not trust a receipt after its score rows disappear',async()=>{db.leaguePlayerWeeklyScore.groupBy.mockResolvedValue([]);expect((await loadFantraxNativePresentation(season))?.matchups[0]?.scoringEvidence.individualSourceScores).toBe('unavailable')})
 it('does not trust a receipt after source team totals change',async()=>{db.leaguePlayerWeeklyScore.groupBy.mockResolvedValue([{week:4,rosterId:1,isStarter:true,_count:{_all:1},_sum:{points:11}},{week:4,rosterId:2,isStarter:true,_count:{_all:1},_sum:{points:9}}]);expect((await loadFantraxNativePresentation(season))?.matchups[0]?.scoringEvidence.individualSourceScores).toBe('unavailable')})
})
