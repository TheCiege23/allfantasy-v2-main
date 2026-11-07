import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A best ball week's result carries the rules it was scored under (lib/bestball/resultRuleStamp.ts), and a
 * SEALED week is rescored on those rules: a commissioner who removes the superflex seat in week 9 must not
 * silently rescore week 3. Audit 2026-11-06, row "Rule/settings version stored with a result".
 *
 * Mocks only: no database.
 */

const db = vi.hoisted(() => ({
  league: { findFirst: vi.fn() },
  redraftMatchup: { findFirst: vi.fn(), update: vi.fn() },
  redraftSeason: { findFirst: vi.fn() },
  redraftRosterPlayer: { findMany: vi.fn() },
  playerWeeklyScore: { findUnique: vi.fn() },
  roster: { findMany: vi.fn(async () => []) },
  afRosterLineupAssignment: { findMany: vi.fn(async () => []) },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/devy/scoringEligibilityEngine', () => ({
  leagueUsesDevyEngine: vi.fn(async () => false),
  calculateOfficialTeamScore: vi.fn(),
}))
vi.mock('@/lib/c2c/scoringEngine', () => ({ leagueUsesC2CEngine: vi.fn(async () => false), updateC2CMatchupScores: vi.fn() }))
vi.mock('@/lib/events', () => ({ getPlatformEvents: () => ({ emit: vi.fn(async () => undefined) }), EVENT: {} }))
vi.mock('@/lib/sports-evidence/gates', () => ({ isSportsDataEnabled: () => false }))

import { calculateScoreFromSportConfig, updateMatchupScores } from '@/lib/redraft/scoringEngine'
import { OPTIMAL_LINEUP_ALGORITHM } from '@/lib/lineup-optimizer/optimalLineup'
import {
  frozenBestBallSlots,
  nextBestBallRuleStamp,
  readBestBallRuleStamp,
  scoringRulesFingerprint,
} from '@/lib/bestball/resultRuleStamp'

const roster = (slots: Record<string, number>) => ({ sportConfig: { scoringPreset: 'PPR' }, roster: { config: { sections: [{ slots }] } } })
/** The seats the week was played with: superflex. */
const WITH_SF = roster({ QB: 1, RB: 1, WR: 1, SUPER_FLEX: 1, BN: 3 })
/** What the commissioner changed the league to afterwards: no superflex. */
const WITHOUT_SF = roster({ QB: 1, RB: 1, WR: 1, BN: 4 })

type P = { playerId: string; position: string; yards: number }
const HOME: P[] = [
  { playerId: 'q1', position: 'QB', yards: 50 },
  { playerId: 'q2', position: 'QB', yards: 250 },
  { playerId: 'r1', position: 'RB', yards: 20 },
  { playerId: 'r2', position: 'RB', yards: 150 },
  { playerId: 'w1', position: 'WR', yards: 100 },
]
const AWAY: P[] = [{ playerId: 'a1', position: 'WR', yards: 30 }]

function arrange(settings: unknown, matchup: { status: string; lineupSnapshots?: unknown }) {
  db.league.findFirst.mockResolvedValue({
    sport: 'NFL',
    settings,
    platform: 'manual',
    bestBallMode: true,
    leagueType: 'best_ball',
    leagueVariant: null,
    guillotineMode: false,
  })
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
    status: matchup.status,
    lineupSnapshots: matchup.lineupSnapshots ?? null,
  })
  db.redraftSeason.findFirst.mockResolvedValue({ id: 's1', season: 2026, sport: 'NFL' })
  db.redraftRosterPlayer.findMany.mockImplementation(async ({ where }: { where: { rosterId?: string | { in: string[] } } }) => {
    const id = typeof where.rosterId === 'string' ? where.rosterId : where.rosterId?.in?.[0]
    return (id === 'home' ? HOME : AWAY).map((p) => ({
      ...p,
      rosterId: id,
      slotType: 'BENCH',
      sport: 'NFL',
      playerName: p.playerId,
      addedAt: null,
      droppedAt: null,
      acquisitionType: 'draft',
    }))
  })
  db.playerWeeklyScore.findUnique.mockImplementation(async ({ where }: { where: { playerId_week_season_sport: { playerId: string } } }) => {
    const p = [...HOME, ...AWAY].find((x) => x.playerId === where.playerId_week_season_sport.playerId)!
    return { stats: { rush_yds: p.yards }, isFinalized: true }
  })
  db.redraftMatchup.update.mockResolvedValue({})
}

async function pts(id: string): Promise<number> {
  const p = [...HOME, ...AWAY].find((x) => x.playerId === id)!
  return calculateScoreFromSportConfig('L1', id, 3, { rush_yds: p.yards }, p.position)
}
const round = (n: number) => Math.round(n * 100) / 100
const written = () => db.redraftMatchup.update.mock.calls.at(-1)![0].data

beforeEach(() => vi.clearAllMocks())

describe('a best ball result stores the rules it was scored under', () => {
  it('the first final scoring stamps the algorithm, the slots seated, a scoring fingerprint, and the seal', async () => {
    arrange(WITH_SF, { status: 'active' })
    await updateMatchupScores('m1')

    const stamp = written().lineupSnapshots.redraftScoring.bestBallRules
    expect(written().status).toBe('final')
    expect(stamp.v).toBe(1)
    expect(stamp.algorithm).toBe(OPTIMAL_LINEUP_ALGORITHM)
    expect(stamp.slots.map((s: { slot: string; count: number }) => `${s.slot}x${s.count}`)).toEqual(['QBx1', 'RBx1', 'WRx1', 'SFx1'])
    expect(stamp.scoringFingerprint).toMatch(/^[0-9a-f]{16}$/)
    expect(stamp.scoringFingerprint).toBe(scoringRulesFingerprint({ sport: 'NFL', settings: WITH_SF }))
    expect(typeof stamp.sealedAt).toBe('string')
    expect(stamp.sealedScoringFingerprint).toBe(stamp.scoringFingerprint)
    expect(stamp.legacy).toBeUndefined()
  })

  it('a result that is not final yet is stamped but not sealed', async () => {
    db.playerWeeklyScore.findUnique.mockReset()
    arrange(WITH_SF, { status: 'scheduled' })
    db.playerWeeklyScore.findUnique.mockImplementation(async ({ where }: { where: { playerId_week_season_sport: { playerId: string } } }) => {
      const p = [...HOME, ...AWAY].find((x) => x.playerId === where.playerId_week_season_sport.playerId)!
      return { stats: { rush_yds: p.yards }, isFinalized: false }
    })
    await updateMatchupScores('m1')
    const stamp = written().lineupSnapshots.redraftScoring.bestBallRules
    expect(written().status).toBe('active')
    expect(stamp.sealedAt).toBeUndefined()
    expect(stamp.slots).toHaveLength(4)
  })
})

describe('rescoring a SEALED week uses its stored slots, not the league\'s current ones', () => {
  async function sealedSnapshot() {
    arrange(WITH_SF, { status: 'active' })
    await updateMatchupScores('m1')
    return { snapshot: written().lineupSnapshots, score: written().homeScore as number }
  }

  it('the commissioner removed the superflex seat: the sealed week still seats it and keeps its score', async () => {
    const { snapshot, score } = await sealedSnapshot()
    expect(score).toBe(round((await pts('q2')) + (await pts('r2')) + (await pts('w1')) + (await pts('q1'))))

    vi.clearAllMocks()
    arrange(WITHOUT_SF, { status: 'final', lineupSnapshots: snapshot })
    const summary = await updateMatchupScores('m1')

    expect(summary?.homeScore).toBe(score)
    const data = written()
    expect(data.lineupSnapshots.redraftScoring.home.bestBall.assignments.map((a: { slot: string }) => a.slot)).toContain('SF')
    expect(data.lineupSnapshots.redraftScoring.bestBallRules.sealedAt).toBe(snapshot.redraftScoring.bestBallRules.sealedAt)
    expect(data.lineupSnapshots.redraftScoring.bestBallRules.slots).toHaveLength(4)
  })

  it('stays frozen through a correction that dropped the matchup back to active', async () => {
    const { snapshot, score } = await sealedSnapshot()
    vi.clearAllMocks()
    arrange(WITHOUT_SF, { status: 'active', lineupSnapshots: snapshot })
    expect((await updateMatchupScores('m1'))?.homeScore).toBe(score)
  })

  it('a week sealed BEFORE stamps existed keeps today\'s behaviour (current slots) and is marked legacy, never frozen', async () => {
    const current = round((await pts('q2')) + (await pts('r2')) + (await pts('w1')))
    arrange(WITHOUT_SF, { status: 'final', lineupSnapshots: { redraftScoring: { scoredAt: '2026-09-20T00:00:00Z' } } })
    expect((await updateMatchupScores('m1'))?.homeScore).toBe(current)
    const stamp = written().lineupSnapshots.redraftScoring.bestBallRules
    expect(stamp.legacy).toBe(true)
    expect(stamp.sealedAt).toBeUndefined()

    // A later change of seats still applies to it: legacy stays unfrozen.
    const legacySnapshot = written().lineupSnapshots
    vi.clearAllMocks()
    arrange(WITH_SF, { status: 'final', lineupSnapshots: legacySnapshot })
    const withSf = round(current + (await pts('q1')))
    expect((await updateMatchupScores('m1'))?.homeScore).toBe(withSf)
    expect(written().lineupSnapshots.redraftScoring.bestBallRules.legacy).toBe(true)
  })
})

describe('a median-game bye row is stamped and frozen the same way', () => {
  function arrangeBye(settings: unknown, matchup: { status: string; lineupSnapshots?: unknown }) {
    arrange(settings, matchup)
    db.league.findFirst.mockResolvedValue({
      sport: 'NFL', settings, platform: 'manual', bestBallMode: true, leagueType: 'best_ball', leagueVariant: null, guillotineMode: false, medianGame: true,
    })
    db.redraftMatchup.findFirst.mockResolvedValue({
      id: 'bye1', leagueId: 'L1', seasonId: 's1', week: 3, homeRosterId: 'home', awayRosterId: null, homeRoster: {},
      homeScore: 0, awayScore: 0, status: matchup.status, lineupSnapshots: matchup.lineupSnapshots ?? null,
    })
    db.redraftSeason.findFirst.mockResolvedValue({ id: 's1', season: 2026, sport: 'NFL', medianGame: true })
  }

  it('seals with the superflex seat, then keeps it after the commissioner removes it', async () => {
    arrangeBye(WITH_SF, { status: 'active' })
    await updateMatchupScores('bye1')
    const sealed = written()
    expect(sealed.lineupSnapshots.redraftScoring.bye).toBe(true)
    expect(typeof sealed.lineupSnapshots.redraftScoring.bestBallRules.sealedAt).toBe('string')

    vi.clearAllMocks()
    arrangeBye(WITHOUT_SF, { status: 'final', lineupSnapshots: sealed.lineupSnapshots })
    await updateMatchupScores('bye1')
    expect(written().homeScore).toBe(sealed.homeScore)
    expect(written().lineupSnapshots.redraftScoring.bestBallRules.slots).toHaveLength(4)
  })
})

describe('resultRuleStamp helpers', () => {
  const slots = [{ slot: 'QB', eligible: ['QB'], count: 1, slotOrder: 0 }]
  it('freezes only a sealed, non-legacy stamp with readable slots', () => {
    const now = new Date('2026-10-01T00:00:00Z')
    const sealed = nextBestBallRuleStamp({ previous: null, previousStatus: 'active', slotsUsed: slots, scoringFingerprint: 'abc', isFinal: true, now })
    expect(frozenBestBallSlots(sealed)).toEqual(slots)
    const open = nextBestBallRuleStamp({ previous: null, previousStatus: 'active', slotsUsed: slots, scoringFingerprint: 'abc', isFinal: false, now })
    expect(frozenBestBallSlots(open)).toBeNull()
    const legacy = nextBestBallRuleStamp({ previous: null, previousStatus: 'final', slotsUsed: slots, scoringFingerprint: 'abc', isFinal: true, now })
    expect(legacy.legacy).toBe(true)
    expect(frozenBestBallSlots(legacy)).toBeNull()
    expect(frozenBestBallSlots({ ...sealed, slots: [{ slot: 'QB', eligible: ['QB'], count: -1 }] })).toBeNull()
  })

  it('keeps the seal fingerprint while recording the latest scoring', () => {
    const now = new Date('2026-10-01T00:00:00Z')
    const sealed = nextBestBallRuleStamp({ previous: null, previousStatus: 'active', slotsUsed: slots, scoringFingerprint: 'first', isFinal: true, now })
    const later = nextBestBallRuleStamp({ previous: sealed, previousStatus: 'final', slotsUsed: slots, scoringFingerprint: 'second', isFinal: true, now: new Date('2026-10-05T00:00:00Z') })
    expect(later.sealedAt).toBe(sealed.sealedAt)
    expect(later.sealedScoringFingerprint).toBe('first')
    expect(later.scoringFingerprint).toBe('second')
  })

  it('reads a stamp back from lineupSnapshots and ignores junk', () => {
    const now = new Date('2026-10-01T00:00:00Z')
    const stamp = nextBestBallRuleStamp({ previous: null, previousStatus: 'active', slotsUsed: slots, scoringFingerprint: null, isFinal: true, now })
    expect(readBestBallRuleStamp({ redraftScoring: { bestBallRules: JSON.parse(JSON.stringify(stamp)) } })).toEqual(stamp)
    expect(readBestBallRuleStamp({ redraftScoring: { bestBallRules: { v: 2 } } })).toBeNull()
    expect(readBestBallRuleStamp(null)).toBeNull()
  })

  it('a scoring edit moves the fingerprint', () => {
    const a = scoringRulesFingerprint({ sport: 'NFL', settings: { sportConfig: { scoringPreset: 'PPR' } } })
    const b = scoringRulesFingerprint({ sport: 'NFL', settings: { sportConfig: { scoringPreset: 'PPR', categoryPoints: { pass_td: 6 } } } })
    expect(a).not.toBe(b)
  })
})
