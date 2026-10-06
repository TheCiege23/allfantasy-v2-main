// @vitest-environment node
/**
 * 🛑 THE BENCH CHECK SEES BYES.
 *
 * `getMyTeamData` ran the bench check before the bye pass, so every player still read
 * `onBye: false` when it was asked who should start. Two failures, both of which are the exact
 * mistake the check exists to catch:
 *   · a bench player on bye was recommended over a starter who is playing;
 *   · a starter on bye kept his feed projection, so a playing bench player who projects lower than
 *     that stale number was never suggested — the manager was left starting a guaranteed zero.
 *
 * Drives the REAL `getMyTeamData` (resolver, bye pass, bench check) over a prisma double with one
 * club off this week and an otherwise complete slate, which is what `getByeWeeks` requires before
 * it will call anything a bye.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  answers: {} as Record<string, (args: any) => unknown>,
  calls: [] as string[],
}))

/** Permissive double: every model and method answers; unlisted reads get an empty-but-valid value. */
vi.mock('@/lib/prisma', () => {
  const fallback = (method: string) =>
    method === 'count' ? 0 : method === 'findMany' || method.startsWith('$query') ? [] : null
  const modelProxy = (model: string) =>
    new Proxy(
      {},
      {
        get: (_t, method: string) =>
          vi.fn(async (args: unknown) => {
            db.calls.push(`${model}.${method}`)
            const answer = db.answers[`${model}.${method}`]
            return answer ? answer(args) : fallback(method)
          }),
      },
    )
  const prisma = new Proxy(
    {},
    {
      get: (_t, key: string) => {
        if (key.startsWith('$query') || key.startsWith('$execute')) return vi.fn(async () => [])
        if (key === '$transaction') return vi.fn(async (ops: unknown) => (Array.isArray(ops) ? Promise.all(ops) : null))
        if (key === 'then') return undefined
        return modelProxy(key)
      },
    },
  )
  return { prisma, default: prisma }
})

const STARTERS = ['qb1', 'wrStart']
const BENCH = ['wrBench']

vi.mock('@/lib/core-app/currentSleeperRoster', () => ({
  currentSleeperRoster: vi.fn(async () => ({
    players: [...STARTERS, ...BENCH],
    starters: [...STARTERS],
    reserve: [],
    taxi: [],
    bestBall: state.bestBall,
    verification: { checkedAt: '2026-09-25T12:00:00.000Z', source: 'Sleeper', week: 3, slots: ['QB', 'WR'] },
  })),
}))

/* The app-wide own/start board. Null (the default) means "not enough leagues", as before. */
const market = vi.hoisted(() => ({ value: null as null | { leaguesCounted: number; byPlayerId: Map<string, { ownPct: number; startPct: number | null }> } }))
vi.mock('@/lib/core-app/rosteredMarket', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/core-app/rosteredMarket')>()),
  getRosteredMarket: vi.fn(async () => market.value),
}))

vi.mock('@/lib/core-app/currentWeek', () => ({
  resolveCurrentWeekForLeague: vi.fn(async () => ({ seasonYear: 2026, week: 3 })),
}))

vi.mock('@/lib/core-app/sportsWeek', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/core-app/sportsWeek')>()),
  resolveSportsWeek: vi.fn(async () => ({ season: 2026, week: 3, seasonType: 'regular' })),
}))

const LEAGUE_ID = 'league-bye'
const USER_ID = 'af-user-1'

/** The club off in week 3. Every other club listed plays. */
const BYE_CLUB = 'BUF'
const PLAYING = ['NYJ', 'MIA', 'NE', 'KC', 'LV', 'LAC', 'DEN', 'DAL', 'PHI', 'NYG', 'WAS', 'GB', 'CHI', 'DET', 'MIN', 'SF', 'SEA', 'LAR', 'ARI', 'TB', 'NO', 'ATL', 'CAR', 'PIT', 'BAL', 'CLE']

/** Catches projected this week; the league scores a point a catch, so this IS each player's number. */
const state = vi.hoisted(() => ({
  receptions: {} as Record<string, number>,
  club: {} as Record<string, string>,
  position: {} as Record<string, string>,
  kickoff: {} as Record<string, Date>,
  bestBall: false,
  bestBallMode: false,
}))
const nameOf = (id: string) => `Player ${id}`

function answerDb() {
  db.answers = {
    'fantasyProjection.findFirst': () => ({ season: '2026', week: 3 }),
    'fantasyProjection.findMany': (args) =>
      (args?.where?.playerId?.in ?? [])
        .filter((id: string) => id in state.receptions)
        .map((id: string) => ({
          playerId: id,
          projectedPoints: state.receptions[id],
          stats: { name: nameOf(id), position: state.position[id], team: state.club[id], stats: { rec: state.receptions[id] } },
        })),
    'sportsPlayer.findMany': (args) =>
      (args?.where?.sleeperId?.in ?? [])
        .filter((id: string) => id in state.club)
        .map((id: string) => ({ sleeperId: id, name: nameOf(id), position: state.position[id], team: state.club[id], sport: 'NFL', imageUrl: null })),
    // Thirteen distinct fixtures in week 3 — a plausible full slate — and none involves BUF.
    'sportsGame.findMany': () =>
      Array.from({ length: PLAYING.length / 2 }, (_, i) => ({
        homeTeam: PLAYING[2 * i],
        awayTeam: PLAYING[2 * i + 1],
        week: 3,
        seasonType: 'regular',
        startTime: state.kickoff[PLAYING[2 * i]] ?? state.kickoff[PLAYING[2 * i + 1]] ?? new Date('2026-09-27T17:00:00Z'),
      })),
  }
}

function context() {
  return {
    leagueId: LEAGUE_ID,
    userId: USER_ID,
    league: vi.fn(async () => ({
      id: LEAGUE_ID,
      name: 'Bye League',
      platform: 'sleeper',
      platformLeagueId: '999',
      sport: 'NFL',
      season: 2026,
      leagueType: 'redraft',
      isDynasty: false,
      starters: null,
      settings: { scoring_settings: { rec: 1 }, roster_positions: ['QB', 'WR', 'BN'] },
      bestBallMode: state.bestBallMode,
    })),
    claimedTeam: vi.fn(async () => ({
      id: 'lt-4', externalId: '4', platformUserId: 'su4', teamName: 'Mine', ownerName: 'me', avatarUrl: null,
      wins: 1, losses: 1, ties: 0, pointsFor: 200, pointsAgainst: 190, currentRank: 5,
    })),
    claimedTeams: vi.fn(async () => []),
  }
}

async function wrSlot() {
  const { getMyTeamData } = await import('@/lib/core-app/myTeam')
  const data = await getMyTeamData(LEAGUE_ID, USER_ID, context() as any)
  if (!data?.starters.available) throw new Error('no starters')
  const slot = data.starters.data.find((s) => s.player?.sleeperId === 'wrStart')
  if (!slot) throw new Error('no WR slot')
  return slot
}

describe('Team alert loading budget',()=>{
 beforeAll(async()=>{vi.spyOn(Date,'now').mockReturnValue(Date.parse('2026-09-25T12:00:00Z'));await import('@/lib/core-app/myTeam')},180000)
 afterAll(()=>vi.restoreAllMocks())
 beforeEach(()=>{state.kickoff={};state.bestBall=false;state.bestBallMode=false;market.value=null;state.receptions={qb1:20,wrStart:12,wrBench:25};state.club={qb1:'NYJ',wrStart:'MIA',wrBench:'NE'};state.position={qb1:'QB',wrStart:'WR',wrBench:'WR'};answerDb();db.answers['roster.findFirst']=()=>({id:'roster',platformUserId:USER_ID,playerData:{starters:STARTERS,players:[...STARTERS,...BENCH],reserve:[],taxi:[]}});vi.clearAllMocks();db.calls=[]})
 it('retains roster/identity/kickoff evidence while removing unrelated read groups',async()=>{
  const {getMyTeamData}=await import('@/lib/core-app/myTeam')
  const full=await getMyTeamData(LEAGUE_ID,USER_ID,context() as any,{savedRosterOnly:true});const fullReads=db.calls.length
  const {getRosteredMarket}=await import('@/lib/core-app/rosteredMarket'),{resolveCurrentWeekForLeague}=await import('@/lib/core-app/currentWeek')
  expect(getRosteredMarket).toHaveBeenCalled();expect(resolveCurrentWeekForLeague).toHaveBeenCalled()
  vi.clearAllMocks();db.calls=[]
  const preview=await getMyTeamData(LEAGUE_ID,USER_ID,context() as any,{alertPreviewOnly:true});const previewReads=db.calls.length
  const evidence=(d:any)=>d.starters.data.map((s:any)=>({slot:s.slotLabel,id:s.player?.sleeperId,status:s.player?.injuryStatus,kickoff:s.player?.kickoff,bye:s.player?.onBye}))
  expect(evidence(preview)).toEqual(evidence(full));expect(preview?.bench).toEqual(full?.bench)
  expect(getRosteredMarket).not.toHaveBeenCalled();expect(resolveCurrentWeekForLeague).not.toHaveBeenCalled()
  const {currentSleeperRoster}=await import('@/lib/core-app/currentSleeperRoster');expect(currentSleeperRoster).not.toHaveBeenCalled()
  expect(previewReads).toBeLessThan(fullReads);process.stdout.write(JSON.stringify({benchmark:'controlled mocked database reads',fullReads,previewReads})+'\n')
 },30000)
 it('starts the team count while the claimed-team read is still pending',async()=>{
  const {getMyTeamData}=await import('@/lib/core-app/myTeam');const ctx=context();let finish!:(value:any)=>void
  ctx.claimedTeam=vi.fn(()=>new Promise(resolve=>{finish=resolve})) as any
  const load=getMyTeamData(LEAGUE_ID,USER_ID,ctx as any,{alertPreviewOnly:true})
  await vi.waitFor(()=>expect(db.calls).toContain('leagueTeam.count'));finish(null);expect((await load)?.starters.available).toBe(false)
 })
})
