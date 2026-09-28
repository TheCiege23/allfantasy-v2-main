// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
const db = vi.hoisted(() => ({
 guillotineElimination: { findMany: vi.fn(async () => []) },
 leagueTeam: { findMany: vi.fn(async () => Array.from({length: 65}, (_, i) => ({leagueId: `L${i}`, externalId: '4', platformUserId: 'su', teamName: 'Mine', league: {id: `L${i}`, name: `League ${i}`, sport: 'NFL', platform: 'sleeper', platformLeagueId: `${1000+i}`, userId: 'user', season: 2026, updatedAt: new Date()}}))) },
 roster: { findMany: vi.fn(async () => Array.from({length:65}, (_,i) => ({leagueId:`L${i}`,platformUserId:'su',playerData:{players:['healthy','out'],starters:['healthy','out']}}))) },
 sportsPlayer: { findMany: vi.fn(async () => [{sleeperId:'healthy',name:'Healthy Player',team:'ATL'},{sleeperId:'out',name:'Omar Cooper',team:'NYJ'}]) },
 sportsInjury: { findMany: vi.fn(async () => [{sport:'NFL',playerName:'Omar Cooper Jr.',status:'IR',team:'NYJ'}]) },
 sportsGame: { findMany: vi.fn(async () => [{homeTeam:'ATL',awayTeam:'GB',startTime:new Date('2026-09-25T00:15:00Z')},{homeTeam:'NYJ',awayTeam:'DET',startTime:new Date('2026-09-27T17:00:00Z')}]) },
}))
vi.mock('@/lib/prisma', () => ({prisma:db}))
vi.mock('@/lib/core-app/sportsWeek', () => ({resolveSportsWeek:vi.fn(async () => ({season:2026,week:3,seasonType:'regular'}))}))
vi.mock('@/lib/core-app/byeWeeks', () => ({getByeWeeks:vi.fn(async () => ({byWeek:new Map([[3,[]]])}))}))
vi.mock('@/lib/core-app/leagueHome', () => ({leagueDisplayName:(name:string)=>name}))
 beforeEach(() => vi.clearAllMocks())
 import { getMyTeamPulse } from '@/lib/core-app/myTeamPulse'
it('keeps 65 partially played lineups actionable with one batched read per resource', async () => {
 const pulse=await getMyTeamPulse('user',new Date('2026-09-27T12:00:00Z'))
 expect(pulse.considered).toBe(65)
 expect(pulse.checked).toBe(65)
 expect(pulse.needsTotal).toBe(65)
 expect(pulse.needs[0]).toMatchObject({out:1,started:1,actionableSeverity:1,locked:false,lockAt:'2026-09-27T17:00:00.000Z'})
 for (const model of Object.values(db)) expect(model.findMany).toHaveBeenCalledTimes(1)
})
it('excludes paused leagues from urgency while keeping them in the inventory count', async () => {
 const pulse=await getMyTeamPulse('user',new Date('2026-09-27T12:00:00Z'),new Set(['L0']))
 expect(pulse).toMatchObject({considered:65,checked:64,needsTotal:64,paused:1})
 expect(pulse.needs.some(row=>row.leagueId==='L0')).toBe(false)
})
it('does not turn a failed primary read into a healthy empty account', async () => {
 db.leagueTeam.findMany.mockRejectedValueOnce(new Error('read unavailable'))
 await expect(getMyTeamPulse('user')).rejects.toThrow('read unavailable')
 expect(db.roster.findMany).not.toHaveBeenCalled()
})
it('treats explicit Best Ball rules as an automatic lineup, not a manual issue', async () => {
 db.leagueTeam.findMany.mockResolvedValueOnce([{leagueId:'L0',externalId:'4',platformUserId:'su',teamName:'Mine',league:{id:'L0',name:'Neutral name',sport:'NFL',platform:'sleeper',platformLeagueId:'1000',userId:'user',season:2026,updatedAt:new Date(),settings:{best_ball:1}}}] as any)
 const pulse=await getMyTeamPulse('user',new Date('2026-09-27T12:00:00Z'))
 expect(pulse.needsTotal).toBe(0)
 expect(pulse.set[0]).toMatchObject({bestBall:true,out:1,severity:0,actionableSeverity:0})
 expect(pulse.automatic).toBe(1)
})
/*
 * 🛑 A Fleaflicker/MFL/Fantrax/Yahoo roster holds the provider's ids, short numbers in Sleeper's range.
 * 'out' here IS a Sleeper id in the fake catalog, whose owner (Omar Cooper) is on IR — a stranger.
 */
const oneLeague = (platform: string) => [{leagueId:'L0',externalId:'4',platformUserId:'su',teamName:'Mine',league:{id:'L0',name:'Neutral name',sport:'NFL',platform,platformLeagueId:'1000',userId:'user',season:2026,updatedAt:new Date()}}] as any
it('🛑 never flags a stranger as your OUT starter from a foreign-id lineup', async () => {
 db.leagueTeam.findMany.mockResolvedValueOnce(oneLeague('fleaflicker'))
 const pulse=await getMyTeamPulse('user',new Date('2026-09-27T12:00:00Z'))
 expect(pulse.needsTotal).toBe(0)
 expect([...pulse.needs,...pulse.set].some(row=>row.out>0)).toBe(false)
 expect(pulse.notChecked.noLineup).toBe(1)
 expect(db.sportsPlayer.findMany).not.toHaveBeenCalled()
})
it('CONTROL: the same lineup in a Sleeper league IS read, and its OUT starter flagged', async () => {
 db.leagueTeam.findMany.mockResolvedValueOnce(oneLeague('sleeper'))
 const pulse=await getMyTeamPulse('user',new Date('2026-09-27T12:00:00Z'))
 expect(pulse.needsTotal).toBe(1)
 expect(pulse.needs[0]).toMatchObject({leagueId:'L0',out:1})
})
