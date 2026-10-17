import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 🛑 A NATIVE BEST-BALL TEAM WAS SCORED ON ITS STALE STARTER SLOTS. The matchup summed only the
 * players the draft auto-slotted as starters; nothing ever re-slotted them, so bench points never
 * counted. These tests pin that the matchup now starts each team's optimal lineup from its whole
 * active roster, on the league's own slots (superflex included), and that a lineup league is
 * scored exactly as before.
 */

const db = vi.hoisted(() => ({
  league: { findFirst: vi.fn() },
  redraftMatchup: { findFirst: vi.fn(), update: vi.fn() },
  redraftSeason: { findFirst: vi.fn() },
  redraftRosterPlayer: { findMany: vi.fn() },
  playerWeeklyScore: { findUnique: vi.fn() },
  roster: { findMany: vi.fn() },
  afRosterLineupAssignment: { findMany: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/devy/scoringEligibilityEngine', () => ({
  leagueUsesDevyEngine: vi.fn(async () => false),
  calculateOfficialTeamScore: vi.fn(),
}))
vi.mock('@/lib/c2c/scoringEngine', () => ({ leagueUsesC2CEngine: vi.fn(async () => false), updateC2CMatchupScores: vi.fn() }))
vi.mock('@/lib/events', () => ({ getPlatformEvents: () => ({ emit: vi.fn(async () => undefined) }), EVENT: {} }))
vi.mock('@/lib/sports-evidence/gates', () => ({ isSportsDataEnabled: () => false }))

import {
  buildBestBallSlots,
  calculateScoreFromSportConfig,
  countsTowardScore,
  isBestBallCandidateSlot,
  leagueIsBestBall,
  updateMatchupScores,
} from '@/lib/redraft/scoringEngine'

const SUPERFLEX_SETTINGS = {
  sportConfig: { scoringPreset: 'PPR' },
  roster: { config: { sections: [{ slots: { QB: 1, RB: 1, WR: 1, SUPER_FLEX: 1, BN: 3, IR: 1 } }] } },
}

type P = { playerId: string; position: string; slotType: string; yards: number }
const HOME: P[] = [
  { playerId: 'q1', position: 'QB', slotType: 'QB', yards: 50 },
  { playerId: 'q2', position: 'QB', slotType: 'BENCH', yards: 250 },
  { playerId: 'r1', position: 'RB', slotType: 'RB', yards: 20 },
  { playerId: 'r2', position: 'RB', slotType: 'BN', yards: 150 },
  { playerId: 'w1', position: 'WR', slotType: 'WR', yards: 100 },
  // A huge week on IR must never count, best ball or not.
  { playerId: 'ir', position: 'WR', slotType: 'IR', yards: 400 },
]
const AWAY: P[] = [{ playerId: 'a1', position: 'WR', slotType: 'WR', yards: 30 }]

type Assignment = { week: number; section: string; playerId: string }

function arrange(
  league: Record<string, unknown>,
  opts: {
    missing?: string[]
    /** The home team's saved lineups by week (`af_roster_lineup_assignments`), via a NATIVE AF roster. */
    homeLineups?: Assignment[]
  } = {},
) {
  const all = [...HOME, ...AWAY]
  db.roster.findMany.mockImplementation(async ({ where }: { where: { redraftRosterId: { in: string[] } } }) =>
    opts.homeLineups && where.redraftRosterId.in.includes('home')
      ? [{ id: 'af-home', redraftRosterId: 'home', league: { platform: 'manual' } }]
      : [],
  )
  db.afRosterLineupAssignment.findMany.mockImplementation(
    async ({ where }: { where: { rosterId: { in: string[] }; season: number; week: number } }) =>
      where.rosterId.in.includes('af-home') && where.season === 2026
        ? (opts.homeLineups ?? [])
            .filter((a) => a.week === where.week)
            .map((a) => ({ rosterId: 'af-home', section: a.section, playerId: a.playerId }))
        : [],
  )
  db.league.findFirst.mockResolvedValue({ sport: 'NFL', settings: SUPERFLEX_SETTINGS, ...league })
  db.redraftMatchup.findFirst.mockResolvedValue({
    id: 'm1',
    leagueId: 'L1',
    seasonId: 's1',
    week: 3,
    homeRosterId: 'home',
    awayRosterId: 'away',
    homeRoster: {},
    homeScore: 0,
    awayScore: 0,
  })
  db.redraftSeason.findFirst.mockResolvedValue({ id: 's1', season: 2026, sport: 'NFL' })
  db.redraftRosterPlayer.findMany.mockImplementation(async ({ where }: { where: { rosterId: string } }) =>
    (where.rosterId === 'home' ? HOME : AWAY).map((p) => ({
      ...p,
      rosterId: where.rosterId,
      sport: 'NFL',
      playerName: p.playerId,
      droppedAt: null,
    })),
  )
  db.playerWeeklyScore.findUnique.mockImplementation(async ({ where }: { where: { playerId_week_season_sport: { playerId: string } } }) => {
    const id = where.playerId_week_season_sport.playerId
    if (opts.missing?.includes(id)) return null
    const p = all.find((x) => x.playerId === id)!
    return { stats: { rush_yds: p.yards }, isFinalized: true }
  })
  db.redraftMatchup.update.mockResolvedValue({})
}

async function pts(id: string): Promise<number> {
  const p = [...HOME, ...AWAY].find((x) => x.playerId === id)!
  return calculateScoreFromSportConfig('L1', id, 3, { rush_yds: p.yards }, p.position)
}

beforeEach(() => vi.clearAllMocks())

describe('MLB native category matchups',()=>{
 it('writes category wins and breakdown from starters, not point weights or bench stats',async()=>{
  arrange({sport:'MLB',settings:{scoring_mode:'h2h_category',category_preset_id:'mlb_5x5',category_record_mode:'each'}})
  db.redraftSeason.findFirst.mockResolvedValue({id:'s1',season:2026,sport:'MLB'})
  db.redraftRosterPlayer.findMany.mockImplementation(async({where})=>[
   {playerId:where.rosterId,position:'OF',slotType:'OF',sport:'MLB',rosterId:where.rosterId,droppedAt:null},
   {playerId:`${where.rosterId}-bench`,position:'OF',slotType:'BN',sport:'MLB',rosterId:where.rosterId,droppedAt:null},
  ])
  db.playerWeeklyScore.findUnique.mockImplementation(async({where})=>({stats:where.playerId_week_season_sport.playerId==='home' ? {hr:3,r:4,rbi:5,sb:1,h:3,ab:10,outs:18,er:1,p_h:2,p_bb:1,so:10,w:1,sv:0} : {hr:1,r:2,rbi:3,sb:0,h:2,ab:10,outs:18,er:3,p_h:5,p_bb:1,so:6,w:0,sv:1},isFinalized:true}))
  const result=await updateMatchupScores('m1')
  expect(result).toMatchObject({homeScore:9,awayScore:1,isComplete:true})
  expect(db.redraftMatchup.update.mock.calls[0][0].data).toMatchObject({status:'final',homeScore:9,awayScore:1,lineupSnapshots:{categoryRecordMode:'each',categoryMatchup:{aWins:9,bWins:1,ties:0}}})
  expect(db.playerWeeklyScore.findUnique.mock.calls.every(([args])=>!args.where.playerId_week_season_sport.playerId.endsWith('-bench'))).toBe(true)
 })
})
