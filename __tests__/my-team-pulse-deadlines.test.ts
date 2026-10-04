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
it('filters a focused weekly league in the database before the display cap',async()=>{
 await getMyTeamPulse('user',new Date('2026-09-27T12:00:00Z'),undefined,null,'L64')
 expect(db.leagueTeam.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{claimedByUserId:'user',leagueId:'L64'}}))
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
 expect(pulse.notChecked.idsUnreadable).toBe(1)
 expect(pulse.notChecked.noLineup).toBe(0)
 expect(db.sportsPlayer.findMany).not.toHaveBeenCalled()
})
it('CONTROL: a Sleeper roster with no starters array is still counted as noLineup, not idsUnreadable', async () => {
 db.leagueTeam.findMany.mockResolvedValueOnce(oneLeague('sleeper'))
 db.roster.findMany.mockResolvedValueOnce([{leagueId:'L0',platformUserId:'su',playerData:{players:['healthy']}}] as any)
 const pulse=await getMyTeamPulse('user',new Date('2026-09-27T12:00:00Z'))
 expect(pulse.notChecked.noLineup).toBe(1)
 expect(pulse.notChecked.idsUnreadable).toBe(0)
})
it('CONTROL: the same lineup in a Sleeper league IS read, and its OUT starter flagged', async () => {
 db.leagueTeam.findMany.mockResolvedValueOnce(oneLeague('sleeper'))
 const pulse=await getMyTeamPulse('user',new Date('2026-09-27T12:00:00Z'))
 expect(pulse.needsTotal).toBe(1)
 expect(pulse.needs[0]).toMatchObject({leagueId:'L0',out:1})
})
/*
 * A questionable starter was invisible to the order: `set` sorted on lock time alone, so
 * "4 questionable" tied "SET · nothing missing" (observed live 2026-10-02). L0 is first in
 * query order, so a lock-only sort leaves it first — the assertion fails without the fix.
 */
it('puts a lineup with a questionable starter ahead of a clean one locking at the same time', async () => {
 const league = (i: number) => ({leagueId:`L${i}`,externalId:'4',platformUserId:'su',teamName:'Mine',league:{id:`L${i}`,name:`League ${i}`,sport:'NFL',platform:'sleeper',platformLeagueId:`${1000+i}`,userId:'user',season:2026,updatedAt:new Date()}})
 db.leagueTeam.findMany.mockResolvedValueOnce([league(0), league(1)] as any)
 db.roster.findMany.mockResolvedValueOnce([
  {leagueId:'L0',platformUserId:'su',playerData:{players:['healthy'],starters:['healthy']}},
  {leagueId:'L1',platformUserId:'su',playerData:{players:['healthy','qp'],starters:['healthy','qp']}},
 ] as any)
 db.sportsPlayer.findMany.mockResolvedValueOnce([{sleeperId:'healthy',name:'Healthy Player',team:'ATL'},{sleeperId:'qp',name:'Quinn Maybe',team:'NYJ'}] as any)
 db.sportsInjury.findMany.mockResolvedValueOnce([{sport:'NFL',playerName:'Quinn Maybe',status:'Questionable',team:'NYJ'}] as any)
 const pulse=await getMyTeamPulse('user',new Date('2026-09-24T12:00:00Z'))
 expect(pulse.needsTotal).toBe(0)
 expect(pulse.set.map(row=>[row.leagueId,row.questionable,row.lockAt])).toEqual([
  ['L1',1,'2026-09-25T00:15:00.000Z'],
  ['L0',0,'2026-09-25T00:15:00.000Z'],
 ])
})
/*
 * `status ?? lifecycleState` never read the lifecycle state (status is set on every import),
 * and `archived` / `renewal_pending` were not in the list — a finished league's stale roster
 * was checked as a live lineup.
 */
it.each([
 ['archived', 'in_season'],
 ['renewal_pending', 'in_season'],
 ['in_season', 'archived'],
])('treats lifecycleState=%s (status %s) as inactive, never as a live lineup', async (lifecycleState, status) => {
 db.leagueTeam.findMany.mockResolvedValueOnce([{leagueId:'L0',externalId:'4',platformUserId:'su',teamName:'Mine',league:{id:'L0',name:'Done',sport:'NFL',platform:'sleeper',platformLeagueId:'1000',userId:'user',season:2026,updatedAt:new Date(),status,lifecycleState}}] as any)
 const pulse=await getMyTeamPulse('user',new Date('2026-09-27T12:00:00Z'))
 const inactive = lifecycleState === 'in_season' ? status : lifecycleState
 expect(['archived','renewal_pending']).toContain(inactive)
 expect(pulse.checked).toBe(0)
 expect(pulse.notChecked.inactive).toBe(1)
})
it('CONTROL: an in-season league with an in-season lifecycle is still checked', async () => {
 db.leagueTeam.findMany.mockResolvedValueOnce([{leagueId:'L0',externalId:'4',platformUserId:'su',teamName:'Mine',league:{id:'L0',name:'Live',sport:'NFL',platform:'sleeper',platformLeagueId:'1000',userId:'user',season:2026,updatedAt:new Date(),status:'in_season',lifecycleState:'in_season'}}] as any)
 const pulse=await getMyTeamPulse('user',new Date('2026-09-27T12:00:00Z'))
 expect(pulse.checked).toBe(1)
 expect(pulse.notChecked.inactive).toBe(0)
})
/*
 * End to end through the loader: a starter whose club is off this week. Needs a slate complete
 * enough for getByeWeeks to call anything a bye, so this mocks that module's answer directly.
 */
it('🛑 a starter on bye is a bye on the row, not a starter "without a kickoff"', async () => {
 const { getByeWeeks } = await import('@/lib/core-app/byeWeeks')
 vi.mocked(getByeWeeks).mockResolvedValueOnce({ byWeek: new Map([[3, ['healthy']]]) } as any)
 db.leagueTeam.findMany.mockResolvedValueOnce(oneLeague('sleeper'))
 const pulse=await getMyTeamPulse('user',new Date('2026-09-24T12:00:00Z'))
 const row = [...pulse.needs, ...pulse.set][0]
 expect(row).toMatchObject({ leagueId: 'L0', bye: 1, out: 1, unknownKickoffs: 0 })
 expect(row.actionableSeverity).toBe(2)
})
