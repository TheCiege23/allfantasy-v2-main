import {describe,it,expect,vi,beforeEach} from 'vitest'
const db=vi.hoisted(()=>({weeklyMatchup:{findMany:vi.fn()},leagueTeam:{findMany:vi.fn()},roster:{findMany:vi.fn()},sportsPlayer:{findMany:vi.fn()}}))
const identities=vi.hoisted(()=>vi.fn())
vi.mock('@/lib/prisma',()=>({prisma:{...db,playerIdentityMap:{findMany:identities}}}))
import {portfolioOpponentExposure} from '@/lib/core-app/portfolioOpponentExposure'
import type {MyTeamRow} from '@/lib/core-app/myTeamPulse'
const row={leagueId:'af',platformLeagueId:'source',teamId:'mine',leagueName:'League',season:2026,week:5,sport:'NFL'} as MyTeamRow
beforeEach(()=>{vi.clearAllMocks();db.weeklyMatchup.findMany.mockResolvedValue([{leagueId:'source',seasonYear:2026,week:5,rosterId:'mine',matchupId:1},{leagueId:'source',seasonYear:2026,week:5,rosterId:'opponent',matchupId:1}]);db.leagueTeam.findMany.mockResolvedValue([{id:'t',leagueId:'af',externalId:'opponent',platformUserId:null}]);db.roster.findMany.mockResolvedValue([{id:'r',leagueId:'af',platformUserId:'orphan-sleeper-opponent',playerData:{source_team_id:'opponent',starters:['p']}}]);db.sportsPlayer.findMany.mockResolvedValue([{sleeperId:'p',name:'NFL Player',sport:'NFL'},{sleeperId:'p',name:'NBA Namesake',sport:'NBA'}])})
describe('scheduled opponent exposure',()=>{
 it('excludes archived seasons from current opponent exposure',async()=>{expect(await portfolioOpponentExposure([{...row,archived:true}])).toEqual([]);expect(db.weeklyMatchup.findMany).not.toHaveBeenCalled()})
 it('joins the provider pairing to the canonical roster using source team identity and sport',async()=>{expect(await portfolioOpponentExposure([row])).toEqual([{id:'p',name:'NFL Player',sport:'NFL',leagues:[{id:'af',name:'League',week:5}]}]);expect(db.weeklyMatchup.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{OR:[{leagueId:'source',seasonYear:2026,week:5}]}}))})
 it('does not guess an opponent with a missing pairing',async()=>{db.weeklyMatchup.findMany.mockResolvedValue([{leagueId:'source',seasonYear:2026,week:5,rosterId:'mine',matchupId:null}]);expect(await portfolioOpponentExposure([row])).toEqual([]);expect(db.sportsPlayer.findMany).not.toHaveBeenCalled()})
 it('does not use a different week or ambiguous pairing',async()=>{db.weeklyMatchup.findMany.mockResolvedValue([{leagueId:'source',seasonYear:2026,week:4,rosterId:'mine',matchupId:1},{leagueId:'source',seasonYear:2026,week:4,rosterId:'opponent',matchupId:1}]);expect(await portfolioOpponentExposure([row])).toEqual([])})
})

it('translates paired ESPN opponents across leagues in one read and ignores unpaired rosters',async()=>{
 const rows=[row,{...row,leagueId:'af2',platformLeagueId:'source2'}].map(r=>({...r,platform:'espn'}))
 db.weeklyMatchup.findMany.mockResolvedValue(rows.flatMap(r=>[{leagueId:r.platformLeagueId,seasonYear:2026,week:5,rosterId:'mine',matchupId:1},{leagueId:r.platformLeagueId,seasonYear:2026,week:5,rosterId:'opponent',matchupId:1}]))
 db.leagueTeam.findMany.mockResolvedValue(rows.map(r=>({id:`t-${r.leagueId}`,leagueId:r.leagueId,externalId:'opponent',platformUserId:null})))
 db.roster.findMany.mockResolvedValue(rows.flatMap((r,i)=>[{id:`r-${i}`,leagueId:r.leagueId,platformUserId:`orphan-${i}`,playerData:{source_team_id:'opponent',starters:[`${10+i}`]}},{id:`other-${i}`,leagueId:r.leagueId,platformUserId:'other',playerData:{source_team_id:'other',starters:['999']}}]))
 identities.mockResolvedValue([{espnId:'10',sleeperId:'p'},{espnId:'11',sleeperId:'p'}])
 expect(await portfolioOpponentExposure(rows)).toEqual([{id:'p',name:'NFL Player',sport:'NFL',leagues:[{id:'af',name:'League',week:5},{id:'af2',name:'League',week:5}]}])
 expect(identities).toHaveBeenCalledTimes(1)
 expect(identities).toHaveBeenCalledWith(expect.objectContaining({where:{espnId:{in:['10','11']},sleeperId:{not:null}}}))
})
