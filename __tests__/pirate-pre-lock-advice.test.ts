import type { PrismaClient } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'

const h=vi.hoisted(()=>({schedule:vi.fn(),preview:vi.fn(),mode:vi.fn(),teams:vi.fn()}))
vi.mock('@/lib/redraft/lineupLock',()=>({
  buildWeekKickoffMap:h.schedule, readLineupLockSettings:h.mode,
  easternDayKey:()=> '2026-11-03', lockTeamLookupKeys:(_sport:string,team:string)=>[team],
}))
vi.mock('@/lib/redraft/lineupLockCurrentTeam',()=>({resolveCurrentLockTeams:h.teams}))
vi.mock('@/lib/roster-lineup-engine/lineupService',()=>({previewRosterLineupWithEngine:h.preview}))
vi.mock('@/lib/multi-sport/MultiSportRosterService',()=>({getRosterTemplateForLeague:vi.fn()}))
vi.mock('@/lib/league/lineupStarterSlots',()=>({resolveLineupStarterSlots:()=>[{label:'QB'}]}))
vi.mock('@/lib/redraft/rosterConfigResolver',()=>({resolveRedraftRosterConfig:()=>({starterCapacities:new Map([['QB',1]])})}))
import { readPiratePreLockAdvice } from '@/lib/pirate/preLockAdvice'
import { pirateReviewQueue } from '@/lib/pirate/reviewQueue'

const now=new Date()
const kickoff=new Date(now.getTime()+3600000)
const args={leagueId:'league',rosterId:'mine',ownerId:'manager',season:2026,week:9,now}
function fixture({fresh=true,mode='first_game_of_week',previewOk=true,dailySaved=true}={}) {
  h.preview.mockReset().mockResolvedValue({ok:previewOk})
  h.mode.mockReturnValue({mode,manualLockedWeeks:new Set(),overrides:[],warnings:[]})
  h.schedule.mockResolvedValue({firstKickoff:kickoff,byTeam:new Map([['GB',kickoff]]),byTeamDay:new Map([['GB',new Map([['2026-11-03',kickoff]])]]),warnings:[]})
  h.teams.mockResolvedValue(new Map([['qb','GB']]))
  return {
    league:{findUnique:vi.fn().mockResolvedValue({sport:'NFL',platform:'manual',settings:{}})},
    redraftRoster:{findFirst:vi.fn().mockResolvedValue({legacyRoster:{id:'legacy',playerData:{players:['qb'],bench:['qb']}},
      players:[{playerId:'qb',playerName:'Bench QB',position:'QB',slotType:'BENCH',team:'GB'}]})},
    sportsInjury:{findMany:vi.fn().mockResolvedValue([])},
    providerSyncState:{findFirst:vi.fn().mockResolvedValue({lastSuccessAt:new Date(now.getTime()-(fresh?1:60)*60000)})},
    redraftDailyLineup:{findMany:vi.fn().mockResolvedValue(dailySaved?[{playerId:'qb',slotType:'BENCH'}]:[])},
  }
}

describe('Pirate pre-lock advice',()=>{
  it('names the empty slot and offers a real bench move only after a read-only save preview',async()=>{
    const db=fixture()
    const advice=await readPiratePreLockAdvice(args,db as unknown as PrismaClient)
    expect(advice).toMatchObject({issues:['QB: 1 empty'],moves:[{playerName:'Bench QB',slot:'QB'}],deadlineAt:kickoff.toISOString()})
    expect(db.redraftRoster.findFirst).toHaveBeenCalledWith(expect.objectContaining({where:{id:'mine',leagueId:'league',ownerId:'manager'}}))
    expect(h.preview).toHaveBeenCalledWith(expect.objectContaining({rosterId:'legacy',actorUserId:'manager',nextPlayerData:expect.objectContaining({starters:['qb']})}))
  })
  it.each([{fresh:false},{previewOk:false}])('keeps the warning but withholds a move when it cannot be verified (%j)',async options=>{
    const advice=await readPiratePreLockAdvice(args,fixture(options) as unknown as PrismaClient)
    expect(advice).toMatchObject({issues:['QB: 1 empty'],moves:[]})
  })
  it('does not substitute a weekly roster for a missing daily lineup',async()=>{
    expect(await readPiratePreLockAdvice(args,fixture({mode:'daily',dailySaved:false}) as unknown as PrismaClient)).toBeNull()
    expect(h.preview).not.toHaveBeenCalled()
  })
  it('keeps daily pre-lock advice available when daily mode reports its normal behavior',async()=>{
    const db=fixture({mode:'daily'})
    h.mode.mockReturnValue({mode:'daily',manualLockedWeeks:new Set(),overrides:[],
      warnings:['Daily lineup lock is active: players lock at their own game start each day and unlock the next day']})
    const advice=await readPiratePreLockAdvice(args,db as unknown as PrismaClient)
    expect(advice).toMatchObject({issues:['QB: 1 empty'],moves:[{playerName:'Bench QB',slot:'QB'}]})
  })
  it('stops warnings at lock',async()=>{
    expect(await readPiratePreLockAdvice({...args,now:kickoff},fixture() as unknown as PrismaClient)).toBeNull()
    expect(h.preview).not.toHaveBeenCalled()
  })
})

it('queues only actionable commissioner cases and prioritizes corrections',()=>{
  const c={week:8,deadlineAt:null,selectionDeadlineAt:null,scoreCorrectionNeedsReversal:false}
  const overdue=new Date(now.getTime()-6*60000).toISOString()
  const justDue=new Date(now.getTime()-60000).toISOString()
  const review={decision:'review',issues:['QB: 1 empty']}
  const entries=pirateReviewQueue([
    {...c,id:'recent',status:'pending',deadlineAt:justDue},
    {...c,id:'late',status:'countered',deadlineAt:overdue},
    {...c,id:'expired',status:'selection_expired'},
    {...c,id:'already-ruled',status:'awaiting_selection'},
    {...c,id:'evidence',status:'awaiting_selection'},
    {...c,id:'corrected',status:'transferred',scoreCorrectionNeedsReversal:true},
  ],new Set(['already-ruled']),{evidence:review,'already-ruled':review},now.getTime())
  expect(entries.map(e=>e.claim.id)).toEqual(['corrected','late','expired','evidence'])
})
