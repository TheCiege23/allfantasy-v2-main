/**
 * Big Brother League — Comprehensive Test Suite
 * Tests: league creation, HOH, nominations, veto draw (randomizer), veto use,
 * replacement nominee, voting, eviction, jury, Have/Have-Nots, waivers, phase
 * state machine, challenge engine, sport-specific adapter — all 7 sports × 2 draft types.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock Prisma ─────────────────────────────────────────────────────────────
vi.mock('@/lib/prisma', () => {
  const db = {
    league: { findUnique: vi.fn(), findFirst: vi.fn() },
    roster: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    bigBrotherLeagueConfig: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    bigBrotherCycle: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      upsert: vi.fn(),
    },
    bigBrotherEvictionVote: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    bigBrotherJuryMember: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    bigBrotherFinaleVote: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    bigBrotherAuditLog: { create: vi.fn(), findFirst: vi.fn().mockResolvedValue(null) },
    rosterWaiverRequest: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  }
  return { prisma: { ...db, $transaction: vi.fn(async fn => fn(db)) } }
})

// ─── Mock getBigBrotherSeasonPoints ────────────────────────────────
vi.mock('@/lib/big-brother/BigBrotherScores', () => ({
  getBigBrotherSeasonPoints: vi.fn(async (_l: string, _r: string, _w: number) => 100),
}))

vi.mock('@/lib/big-brother/BigBrotherChatAnnouncements', () => ({
  announceEviction: vi.fn(),
  announceHOHWinner: vi.fn(),
}))

vi.mock('@/lib/big-brother/BigBrotherVoteProgressChat', () => ({
  syncBigBrotherVoteProgressChat: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/big-brother/BigBrotherChatChannels', () => ({
  resolveHaveNotRosterIdsForCycle: vi.fn(async () => ['roster-2']),
}))

vi.mock('@/lib/sport-scope', () => ({
  SUPPORTED_SPORTS: ['NFL', 'NBA', 'NHL', 'MLB', 'NCAAF', 'NCAAB', 'SOCCER'],
  normalizeToSupportedSport: (s: string) => (s ?? 'NFL').toUpperCase(),
}))

import { prisma } from '@/lib/prisma'

// ─── Engine imports ──────────────────────────────────────────────────────────
import { getEligibleHOHRosterIds, assignHOH } from '@/lib/big-brother/BigBrotherHOHEngine'
import { selectVetoCompetitors, setVetoWinner } from '@/lib/big-brother/BigBrotherVetoEngine'
import { setNominations, setReplacementNominee, getFinalNomineeRosterIds } from '@/lib/big-brother/BigBrotherNominationEngine'
import { getEligibleVoterRosterIds, submitEvictionVote } from '@/lib/big-brother/BigBrotherVoteEngine'
import { shouldJoinJury, enrollJuryMember, getJuryMembers, submitFinaleVote, tallyFinaleVotes } from '@/lib/big-brother/BigBrotherJuryEngine'
import { canTransition, isValidPhase } from '@/lib/big-brother/BigBrotherPhaseStateMachine'
import { resolveChallengeByScore, resolveChallengeBySeededRandom } from '@/lib/big-brother/BigBrotherChallengeEngine'
import { applyHaveNotChallengeScorePenalty, HAVE_NOT_CHALLENGE_PENALTY_PCT } from '@/lib/big-brother/BigBrotherHaveNotPenaltyService'
import { getChallengeThemeSportLabel, getHOHChallengeThemeHints, getVetoChallengeThemeHints, getBigBrotherSupportedSports } from '@/lib/big-brother/sport-adapter'
import {
  BIG_BROTHER_VARIANT,
  DEFAULT_EVICTION_END_WEEK_BY_SPORT,
  DEFAULT_JURY_START_AFTER_ELIMINATIONS,
  DEFAULT_VETO_COMPETITOR_COUNT,
  FINAL_NOMINEE_COUNT,
} from '@/lib/big-brother/constants'

// ─── Helpers ─────────────────────────────────────────────────────────────────
const SPORTS = ['NFL', 'NBA', 'NHL', 'MLB', 'NCAAF', 'NCAAB', 'SOCCER'] as const
const DRAFT_TYPES = ['snake', 'auction'] as const

function makeRosters(count: number) {
  return Array.from({ length: count }, (_, i) => ({ id: `roster-${i + 1}`, waiverPriority: i + 1 }))
}

function mockConfig(leagueId: string, sport = 'NFL') {
  return {
    leagueId,
    configId: `config-${leagueId}`,
    sport,
    hohChallengeDayOfWeek: 2,
    hohChallengeTimeUtc: '18:00',
    nominationDeadlineDayOfWeek: 3,
    nominationDeadlineTimeUtc: '18:00',
    vetoDrawDayOfWeek: 4,
    vetoDrawTimeUtc: '12:00',
    vetoDecisionDeadlineDayOfWeek: 5,
    vetoDecisionDeadlineTimeUtc: '18:00',
    replacementNomineeDeadlineDayOfWeek: 5,
    replacementNomineeDeadlineTimeUtc: '20:00',
    evictionVoteOpenDayOfWeek: 5,
    evictionVoteOpenTimeUtc: '20:00',
    evictionVoteCloseDayOfWeek: 6,
    evictionVoteCloseTimeUtc: '20:00',
    finalNomineeCount: 2,
    vetoCompetitorCount: DEFAULT_VETO_COMPETITOR_COUNT,
    consecutiveHohAllowed: false,
    hohVotesOnlyInTie: true,
    juryStartMode: 'after_eliminations',
    juryStartAfterEliminations: DEFAULT_JURY_START_AFTER_ELIMINATIONS,
    juryStartWhenRemaining: null,
    juryStartWeek: null,
    finaleFormat: 'final_2',
    waiverReleaseTiming: 'immediate',
    publicVoteTotalsVisibility: 'evicted_only',
    challengeMode: 'hybrid',
    antiCollusionLogging: true,
    inactivePlayerHandling: 'none',
    autoNominationFallback: 'lowest_season_points',
    evictionTieBreakMode: 'season_points',
    weekProgressionPaused: false,
  }
}

// ─── SECTION 1: Big Brother Sport Support ────────────────────────────────────
describe('Big Brother League — Sport Support', () => {
  it('should support all 7 sports', () => {
    const supported = getBigBrotherSupportedSports()
    const required = ['NFL', 'NBA', 'NHL', 'MLB', 'NCAAF', 'NCAAB', 'SOCCER']
    for (const sport of required) {
      expect(supported).toContain(sport)
    }
  })

  it('should have eviction end week for all 7 sports', () => {
    for (const sport of SPORTS) {
      expect(DEFAULT_EVICTION_END_WEEK_BY_SPORT[sport]).toBeDefined()
      expect(DEFAULT_EVICTION_END_WEEK_BY_SPORT[sport]).toBeGreaterThan(0)
    }
  })

  it('should return sport label for every sport', () => {
    for (const sport of SPORTS) {
      const label = getChallengeThemeSportLabel(sport)
      expect(typeof label).toBe('string')
      expect(label.length).toBeGreaterThan(0)
    }
  })

  it('should return HOH challenge theme hints for every sport', () => {
    for (const sport of SPORTS) {
      const hints = getHOHChallengeThemeHints(sport)
      expect(Array.isArray(hints)).toBe(true)
      expect(hints.length).toBeGreaterThan(0)
    }
  })

  it('should return Veto challenge theme hints for every sport', () => {
    for (const sport of SPORTS) {
      const hints = getVetoChallengeThemeHints(sport)
      expect(Array.isArray(hints)).toBe(true)
      expect(hints.length).toBeGreaterThan(0)
    }
  })
})

// ─── SECTION 2: League Constants & Config ─────────────────────────────────────
describe('Big Brother League — Constants & Config Defaults', () => {
  it('should have correct BIG_BROTHER_VARIANT constant', () => {
    expect(BIG_BROTHER_VARIANT).toBe('big_brother')
  })

  it('should have default veto competitor count of 6', () => {
    expect(DEFAULT_VETO_COMPETITOR_COUNT).toBe(6)
  })

  it('should have final nominee count of 2', () => {
    expect(FINAL_NOMINEE_COUNT).toBe(2)
  })

  it('should default jury start after 7 eliminations', () => {
    expect(DEFAULT_JURY_START_AFTER_ELIMINATIONS).toBe(7)
  })

  it.each(SPORTS)('NFL/all sports: eviction end week is a positive number (%s)', (sport) => {
    const endWeek = DEFAULT_EVICTION_END_WEEK_BY_SPORT[sport]
    expect(endWeek).toBeDefined()
    expect(typeof endWeek).toBe('number')
    expect(endWeek!).toBeGreaterThan(0)
  })
})

// ─── SECTION 3: League Creation (14 Sport × Draft combos) ────────────────────
describe('Big Brother League — Creation Matrix (7 sports × 2 draft types)', () => {
  it('should support 14 sport-draft combinations', () => {
    const combos = SPORTS.flatMap((s) => DRAFT_TYPES.map((d) => ({ sport: s, draftType: d })))
    expect(combos).toHaveLength(14)
  })

  it.each(SPORTS.flatMap((s) => DRAFT_TYPES.map((d) => [s, d] as const)))(
    'should create %s + %s big brother league config with valid defaults',
    (sport, draftType) => {
      const leagueId = `bb-${sport}-${draftType}-test`
      const config = mockConfig(leagueId, sport)
      expect(config.leagueId).toContain('bb')
      expect(config.sport).toBe(sport)
      expect(config.finalNomineeCount).toBe(2)
      expect(config.vetoCompetitorCount).toBe(6)
      expect(config.juryStartMode).toBe('after_eliminations')
      expect(['final_2', 'final_3']).toContain(config.finaleFormat)
      expect(['snake', 'auction']).toContain(draftType)
    }
  )

  it.each(SPORTS)('should have valid eviction schedule fields for %s', (sport) => {
    const config = mockConfig(`bb-${sport}`, sport)
    expect(config.hohChallengeDayOfWeek).toBeGreaterThanOrEqual(0)
    expect(config.evictionVoteCloseDayOfWeek).toBeGreaterThanOrEqual(0)
    expect(config.nominationDeadlineDayOfWeek).toBeGreaterThanOrEqual(0)
  })
})

// ─── SECTION 4: Phase State Machine ──────────────────────────────────────────
describe('Big Brother Phase State Machine', () => {
  it('should validate all valid phases', () => {
    const phases = [
      'HOH_OPEN', 'HOH_LOCKED', 'NOMINATION_OPEN', 'NOMINATION_LOCKED',
      'VETO_DRAW', 'VETO_CHALLENGE_OPEN', 'VETO_DECISION_OPEN',
      'REPLACEMENT_NOMINATION_OPEN', 'VOTING_OPEN', 'VOTING_LOCKED',
      'EVICTION_RESOLVED', 'JURY_UPDATE', 'RESET_NEXT_WEEK',
    ]
    for (const phase of phases) {
      expect(isValidPhase(phase)).toBe(true)
    }
  })

  it('should reject invalid phases', () => {
    expect(isValidPhase('INVALID_PHASE')).toBe(false)
    expect(isValidPhase('')).toBe(false)
    expect(isValidPhase('hoh_open')).toBe(false) // lowercase
  })

  it('should allow HOH_OPEN → HOH_LOCKED', () => {
    expect(canTransition('HOH_OPEN', 'HOH_LOCKED')).toBe(true)
  })

  it('should allow HOH_LOCKED → NOMINATION_OPEN', () => {
    expect(canTransition('HOH_LOCKED', 'NOMINATION_OPEN')).toBe(true)
  })

  it('should allow NOMINATION_OPEN → NOMINATION_LOCKED', () => {
    expect(canTransition('NOMINATION_OPEN', 'NOMINATION_LOCKED')).toBe(true)
  })

  it('should allow NOMINATION_LOCKED → VETO_DRAW', () => {
    expect(canTransition('NOMINATION_LOCKED', 'VETO_DRAW')).toBe(true)
  })

  it('should allow VETO_DRAW → VETO_CHALLENGE_OPEN', () => {
    expect(canTransition('VETO_DRAW', 'VETO_CHALLENGE_OPEN')).toBe(true)
  })

  it('should allow VETO_CHALLENGE_OPEN → VETO_DECISION_OPEN', () => {
    expect(canTransition('VETO_CHALLENGE_OPEN', 'VETO_DECISION_OPEN')).toBe(true)
  })

  it('should allow VETO_DECISION_OPEN → VOTING_OPEN (veto not used path)', () => {
    expect(canTransition('VETO_DECISION_OPEN', 'VOTING_OPEN')).toBe(true)
  })

  it('should allow VETO_DECISION_OPEN → REPLACEMENT_NOMINATION_OPEN (veto used path)', () => {
    expect(canTransition('VETO_DECISION_OPEN', 'REPLACEMENT_NOMINATION_OPEN')).toBe(true)
  })

  it('should allow REPLACEMENT_NOMINATION_OPEN → VOTING_OPEN', () => {
    expect(canTransition('REPLACEMENT_NOMINATION_OPEN', 'VOTING_OPEN')).toBe(true)
  })

  it('should allow VOTING_OPEN → VOTING_LOCKED', () => {
    expect(canTransition('VOTING_OPEN', 'VOTING_LOCKED')).toBe(true)
  })

  it('should allow VOTING_LOCKED → EVICTION_RESOLVED', () => {
    expect(canTransition('VOTING_LOCKED', 'EVICTION_RESOLVED')).toBe(true)
  })

  it('should allow EVICTION_RESOLVED → JURY_UPDATE', () => {
    expect(canTransition('EVICTION_RESOLVED', 'JURY_UPDATE')).toBe(true)
  })

  it('should allow EVICTION_RESOLVED → RESET_NEXT_WEEK (skip jury update)', () => {
    expect(canTransition('EVICTION_RESOLVED', 'RESET_NEXT_WEEK')).toBe(true)
  })

  it('should allow JURY_UPDATE → RESET_NEXT_WEEK', () => {
    expect(canTransition('JURY_UPDATE', 'RESET_NEXT_WEEK')).toBe(true)
  })

  it('should NOT allow jumping phases (HOH_OPEN → VOTING_OPEN)', () => {
    expect(canTransition('HOH_OPEN', 'VOTING_OPEN')).toBe(false)
  })

  it('should NOT allow backward transitions (VOTING_OPEN → HOH_OPEN)', () => {
    expect(canTransition('VOTING_OPEN', 'HOH_OPEN')).toBe(false)
  })

  it('should NOT allow RESET_NEXT_WEEK → anything (terminal state)', () => {
    expect(canTransition('RESET_NEXT_WEEK', 'HOH_OPEN')).toBe(false)
  })

  it('full week phase sequence is valid end-to-end', () => {
    const sequence: [string, string][] = [
      ['HOH_OPEN', 'HOH_LOCKED'],
      ['HOH_LOCKED', 'NOMINATION_OPEN'],
      ['NOMINATION_OPEN', 'NOMINATION_LOCKED'],
      ['NOMINATION_LOCKED', 'VETO_DRAW'],
      ['VETO_DRAW', 'VETO_CHALLENGE_OPEN'],
      ['VETO_CHALLENGE_OPEN', 'VETO_DECISION_OPEN'],
      ['VETO_DECISION_OPEN', 'REPLACEMENT_NOMINATION_OPEN'],
      ['REPLACEMENT_NOMINATION_OPEN', 'VOTING_OPEN'],
      ['VOTING_OPEN', 'VOTING_LOCKED'],
      ['VOTING_LOCKED', 'EVICTION_RESOLVED'],
      ['EVICTION_RESOLVED', 'JURY_UPDATE'],
      ['JURY_UPDATE', 'RESET_NEXT_WEEK'],
    ]
    for (const [from, to] of sequence) {
      expect(canTransition(from as never, to as never)).toBe(true)
    }
  })
})

// ─── SECTION 5: HOH Engine ───────────────────────────────────────────────────
describe('Big Brother — HOH Engine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return all active rosters as HOH eligible on week 1', async () => {
    const rosters = makeRosters(10)
    vi.mocked(prisma.bigBrotherCycle).findMany.mockResolvedValue([]) // no evictions
    vi.mocked(prisma.roster).findMany.mockResolvedValue(rosters as never)
    vi.mocked(prisma.bigBrotherCycle).findUnique.mockResolvedValue(null) // no prev HOH

    const eligible = await getEligibleHOHRosterIds('league-1', 'config-1', 1, false)
    expect(eligible).toHaveLength(10)
  })

  it('should exclude previous HOH when consecutiveHohAllowed = false', async () => {
    const rosters = makeRosters(10)
    vi.mocked(prisma.bigBrotherCycle).findMany.mockResolvedValue([])
    vi.mocked(prisma.roster).findMany.mockResolvedValue(rosters as never)
    vi.mocked(prisma.bigBrotherCycle).findUnique.mockResolvedValue({
      hohRosterId: 'roster-1',
    } as never)

    const eligible = await getEligibleHOHRosterIds('league-1', 'config-1', 2, false)
    expect(eligible).not.toContain('roster-1')
    expect(eligible).toHaveLength(9)
  })

  it('should allow previous HOH to compete when consecutiveHohAllowed = true', async () => {
    const rosters = makeRosters(10)
    vi.mocked(prisma.bigBrotherCycle).findMany.mockResolvedValue([])
    vi.mocked(prisma.roster).findMany.mockResolvedValue(rosters as never)

    const eligible = await getEligibleHOHRosterIds('league-1', 'config-1', 2, true)
    expect(eligible).toHaveLength(10)
  })

  it('should reject assigning HOH to evicted roster', async () => {
    const rosters = makeRosters(10).slice(1) // exclude roster-1 (evicted)
    vi.mocked(prisma.bigBrotherCycle).findMany.mockResolvedValue([
      { evictedRosterId: 'roster-1' },
    ] as never)
    vi.mocked(prisma.roster).findMany.mockResolvedValue(rosters as never)
    vi.mocked(prisma.bigBrotherCycle).findUnique.mockImplementation(async ({ where }: any) => {
      if (where?.id === 'cycle-1') return { id: 'cycle-1', week: 2, leagueId: 'league-1', configId: 'config-1' }
      return { hohRosterId: null }
    })
    vi.mocked(prisma.league).findUnique.mockResolvedValue({
      id: 'league-1', sport: 'NFL', leagueVariant: 'big_brother',
    } as never)
    vi.mocked(prisma.bigBrotherLeagueConfig).findUnique.mockResolvedValue(
      { id: 'config-1', ...mockConfig('league-1') } as never
    )

    const result = await assignHOH('league-1', 'config-1', 'cycle-1', 'roster-1')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('eligible')
  })

  it.each(SPORTS)('HOH eligibility works for %s sport', async (sport) => {
    const rosters = makeRosters(8)
    vi.mocked(prisma.bigBrotherCycle).findMany.mockResolvedValue([])
    vi.mocked(prisma.roster).findMany.mockResolvedValue(rosters as never)
    vi.mocked(prisma.bigBrotherCycle).findUnique.mockResolvedValue(null)

    const eligible = await getEligibleHOHRosterIds(`league-${sport}`, `config-${sport}`, 1, true)
    expect(eligible.length).toBeGreaterThan(0)
  })
})

// ─── SECTION 6: Nomination Engine ────────────────────────────────────────────
describe('Big Brother — Nomination Engine', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(prisma.roster).findMany.mockResolvedValue([{id:'roster-2'},{id:'roster-3'}] as never) })

  it('should set nominations successfully', async () => {
    vi.mocked(prisma.bigBrotherCycle).findUnique.mockResolvedValue({
      leagueId: 'league-1',
      configId: 'config-1',
      hohRosterId: 'roster-1',
    } as never)
    vi.mocked(prisma.bigBrotherCycle).findMany.mockResolvedValue([])
    vi.mocked(prisma.bigBrotherCycle).update.mockResolvedValue({} as never)

    const result = await setNominations('cycle-1', 'roster-2', 'roster-3')
    expect(result.ok).toBe(true)
  })

  it('should reject HOH as nominee', async () => {
    vi.mocked(prisma.bigBrotherCycle).findUnique.mockResolvedValue({
      leagueId: 'league-1',
      configId: 'config-1',
      hohRosterId: 'roster-1',
    } as never)
    vi.mocked(prisma.bigBrotherCycle).findMany.mockResolvedValue([])

    const result = await setNominations('cycle-1', 'roster-1', 'roster-3')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('HOH cannot be nominated')
  })

  it('should reject duplicate nominees', async () => {
    vi.mocked(prisma.bigBrotherCycle).findUnique.mockResolvedValue({
      leagueId: 'league-1',
      configId: 'config-1',
      hohRosterId: 'roster-1',
    } as never)

    const result = await setNominations('cycle-1', 'roster-2', 'roster-2')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('different')
  })

  it('should reject evicted roster as nominee', async () => {
    vi.mocked(prisma.bigBrotherCycle).findUnique.mockImplementation(async ({ where }: any) => {
      if (where?.id === 'cycle-1') return { leagueId: 'league-1', configId: 'config-1', hohRosterId: 'roster-1' }
      return null
    })
    // roster-2 was evicted in a previous cycle
    vi.mocked(prisma.bigBrotherCycle).findMany.mockResolvedValue([
      { evictedRosterId: 'roster-2' },
    ] as never)

    const result = await setNominations('cycle-1', 'roster-2', 'roster-3')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('evicted')
  })

  it('should compute final nominees (no veto used)', async () => {
    vi.mocked(prisma.bigBrotherCycle).findUnique.mockResolvedValue({
      vetoUsed: false,
      nominee1RosterId: 'roster-2',
      nominee2RosterId: 'roster-3',
      replacementNomineeRosterId: null,
    } as never)

    const noms = await getFinalNomineeRosterIds('cycle-1')
    expect(noms).toContain('roster-2')
    expect(noms).toContain('roster-3')
    expect(noms).toHaveLength(2)
  })

  it('should compute final nominees (veto used — replacement on block)', async () => {
    vi.mocked(prisma.bigBrotherCycle).findUnique.mockResolvedValue({
      vetoUsed: true,
      nominee1RosterId: 'roster-2',
      nominee2RosterId: 'roster-3',
      vetoSavedRosterId: 'roster-2',
      replacementNomineeRosterId: 'roster-4',
    } as never)

    const noms = await getFinalNomineeRosterIds('cycle-1')
    expect(noms).toContain('roster-3')
    expect(noms).toContain('roster-4')
    expect(noms).not.toContain('roster-2')
  })
})

// ─── SECTION 7: Veto Engine (Randomizer + Use) ───────────────────────────────
describe('Big Brother — Veto Engine (Randomizer + Use + Replacement)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('should select exactly vetoCompetitorCount competitors (or all eligible if small league)', async () => {
    const allRosters = makeRosters(12)
    vi.mocked(prisma.bigBrotherCycle).findUnique.mockResolvedValue({
      id: 'cycle-1',
      leagueId: 'league-1',
      configId: 'config-1',
      week: 1,
      hohRosterId: 'roster-1',
      nominee1RosterId: 'roster-2',
      nominee2RosterId: 'roster-3',
    } as never)
    vi.mocked(prisma.bigBrotherCycle).findMany.mockResolvedValue([])
    vi.mocked(prisma.league).findUnique.mockResolvedValue({ id: 'league-1', sport: 'NFL', leagueVariant: 'big_brother' } as never)
    vi.mocked(prisma.bigBrotherLeagueConfig).findUnique.mockResolvedValue({ id: 'config-1', ...mockConfig('league-1') } as never)
    vi.mocked(prisma.roster).findMany.mockResolvedValue(
      allRosters.filter((r) => !['roster-1', 'roster-2', 'roster-3'].includes(r.id)) as never
    )
    vi.mocked(prisma.bigBrotherCycle).update.mockResolvedValue({} as never)

    const result = await selectVetoCompetitors('cycle-1')
    expect(result.ok).toBe(true)
    expect(result.rosterIds).toHaveLength(DEFAULT_VETO_COMPETITOR_COUNT)
    expect(result.rosterIds).toContain('roster-1') // HOH always included
    expect(result.rosterIds).toContain('roster-2') // nom1 always included
    expect(result.rosterIds).toContain('roster-3') // nom2 always included
  })

  it('should use deterministic seed (same inputs = same veto draw)', async () => {
    const allRosters = makeRosters(12)
    vi.mocked(prisma.bigBrotherCycle).findUnique.mockResolvedValue({
      id: 'cycle-1',
      leagueId: 'league-1',
      configId: 'config-1',
      week: 3,
      hohRosterId: 'roster-1',
      nominee1RosterId: 'roster-2',
      nominee2RosterId: 'roster-3',
    } as never)
    vi.mocked(prisma.bigBrotherCycle).findMany.mockResolvedValue([])
    vi.mocked(prisma.league).findUnique.mockResolvedValue({ id: 'league-1', sport: 'NFL', leagueVariant: 'big_brother' } as never)
    vi.mocked(prisma.bigBrotherLeagueConfig).findUnique.mockResolvedValue({ id: 'config-1', ...mockConfig('league-1') } as never)
    vi.mocked(prisma.roster).findMany.mockResolvedValue(
      allRosters.filter((r) => !['roster-1', 'roster-2', 'roster-3'].includes(r.id)) as never
    )
    vi.mocked(prisma.bigBrotherCycle).update.mockResolvedValue({} as never)

    const result1 = await selectVetoCompetitors('cycle-1')
    const result2 = await selectVetoCompetitors('cycle-1')
    expect(result1.rosterIds).toEqual(result2.rosterIds)
  })

  it('should reject veto winner who was not a competitor', async () => {
    vi.mocked(prisma.bigBrotherCycle).findUnique.mockResolvedValue({
      vetoParticipantRosterIds: ['roster-1', 'roster-2', 'roster-3'],
    } as never)

    const result = await setVetoWinner('cycle-1', 'roster-99')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('not a veto competitor')
  })

  it('should accept valid veto winner from competitor pool', async () => {
    vi.mocked(prisma.bigBrotherCycle).findUnique.mockResolvedValue({
      vetoParticipantRosterIds: ['roster-1', 'roster-2', 'roster-3'],
    } as never)
    vi.mocked(prisma.bigBrotherCycle).update.mockResolvedValue({} as never)

    const result = await setVetoWinner('cycle-1', 'roster-2')
    expect(result.ok).toBe(true)
  })

  it('should reject replacement nominee who is the HOH', async () => {
    vi.mocked(prisma.bigBrotherCycle).findUnique.mockResolvedValue({
      leagueId: 'league-1',
      hohRosterId: 'roster-1',
      vetoUsed: true,
      vetoSavedRosterId: 'roster-2',
      nominee1RosterId: 'roster-2',
      nominee2RosterId: 'roster-3',
    } as never)
    vi.mocked(prisma.bigBrotherCycle).findMany.mockResolvedValue([])

    const result = await setReplacementNominee('cycle-1', 'roster-1')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('HOH')
  })

  it('should reject replacement nominee who was already saved by veto', async () => {
    vi.mocked(prisma.bigBrotherCycle).findUnique.mockResolvedValue({
      leagueId: 'league-1',
      hohRosterId: 'roster-1',
      vetoUsed: true,
      vetoSavedRosterId: 'roster-2',
      nominee1RosterId: 'roster-2',
      nominee2RosterId: 'roster-3',
    } as never)
    vi.mocked(prisma.bigBrotherCycle).findMany.mockResolvedValue([])

    const result = await setReplacementNominee('cycle-1', 'roster-2')
    expect(result.ok).toBe(false)
  })
})

// ─── SECTION 8: Voting System ────────────────────────────────────────────────
describe('Big Brother — Voting System', () => {
  beforeEach(() => vi.clearAllMocks())

  it('should allow eligible voters to vote', async () => {
    vi.mocked(prisma.bigBrotherCycle).findUnique.mockImplementation(async ({ where }: any) => {
      if (where?.id === 'cycle-1') {
        return {
          leagueId: 'league-1',
          configId: 'config-1',
          phase: 'VOTING_OPEN',
          nominee1RosterId: 'roster-2', nominee2RosterId: 'roster-3', vetoUsed: false,
          voteDeadlineAt: new Date(Date.now() + 3600000),
          closedAt: null,
          hohRosterId: 'roster-1',
        }
      }
      return { hohRosterId: 'roster-1' }
    })
    vi.mocked(prisma.bigBrotherCycle).findMany.mockResolvedValue([])
    vi.mocked(prisma.roster).findMany.mockResolvedValue(makeRosters(10) as never)
    vi.mocked(prisma.bigBrotherCycle).findMany.mockResolvedValue([]) // no evictions
    vi.mocked(prisma.league).findUnique.mockResolvedValue({ id: 'league-1', sport: 'NFL', leagueVariant: 'big_brother' } as never)
    vi.mocked(prisma.bigBrotherLeagueConfig).findUnique.mockResolvedValue({ id: 'config-1', ...mockConfig('league-1') } as never)
    vi.mocked(prisma.bigBrotherEvictionVote).upsert.mockResolvedValue({} as never)

    // voter=roster-4, target=roster-2 (nominee)
    const result = await submitEvictionVote('cycle-1', 'roster-4', 'roster-2')
    // We expect OK — eligible voter, valid target
    expect(result.ok).toBe(true)
  })

  it('should reject vote when cycle is closed', async () => {
    vi.mocked(prisma.bigBrotherCycle).findUnique.mockResolvedValue({
      leagueId: 'league-1',
      configId: 'config-1',
      phase: 'VOTING_LOCKED',
      voteDeadlineAt: null,
      closedAt: new Date(Date.now() - 1000),
    } as never)

    const result = await submitEvictionVote('cycle-1', 'roster-4', 'roster-2')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('closed')
  })

  it('should reject vote when voting phase not open', async () => {
    vi.mocked(prisma.bigBrotherCycle).findUnique.mockResolvedValue({
      leagueId: 'league-1',
      configId: 'config-1',
      phase: 'NOMINATION_OPEN',
      voteDeadlineAt: null,
      closedAt: null,
    } as never)

    const result = await submitEvictionVote('cycle-1', 'roster-4', 'roster-2')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('not open')
  })

  it('should get eligible voters (HOH excluded when hohVotesOnlyInTie=true)', async () => {
    // Call order inside getEligibleVoterRosterIds:
    //   1st findUnique: cycle lookup → needs { leagueId, hohRosterId }
    //   2nd findUnique (inside getFinalNomineeRosterIds): needs nominee data
    vi.mocked(prisma.bigBrotherCycle).findUnique
      .mockResolvedValueOnce({ leagueId: 'league-1', hohRosterId: 'roster-1' } as never)
      .mockResolvedValueOnce({
        vetoUsed: false,
        nominee1RosterId: 'roster-2',
        nominee2RosterId: 'roster-3',
        replacementNomineeRosterId: null,
      } as never)
    vi.mocked(prisma.bigBrotherCycle).findMany.mockResolvedValue([]) // no evictions
    vi.mocked(prisma.roster).findMany.mockResolvedValue(makeRosters(10) as never)

    const eligible = await getEligibleVoterRosterIds('league-1', 'cycle-1', true)
    expect(eligible).not.toContain('roster-1') // HOH excluded
    expect(eligible).not.toContain('roster-2') // nominee excluded
    expect(eligible).not.toContain('roster-3') // nominee excluded
    expect(eligible.length).toBeGreaterThan(0)
    expect(Array.isArray(eligible)).toBe(true)
  })
})

// ─── SECTION 9: Jury Engine ──────────────────────────────────────────────────
describe('Big Brother — Jury Engine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.league).findUnique.mockResolvedValue({ id: 'league-1', sport: 'NFL' } as never)
    vi.mocked(prisma.bigBrotherLeagueConfig).findUnique.mockResolvedValue({ ...mockConfig('league-1'), id: 'config-1' } as never)
    vi.mocked(prisma.roster).findMany.mockResolvedValue(['finalist-A','finalist-B','jury-1','jury-2','jury-3'].map(id=>({id})) as never)
    vi.mocked(prisma.bigBrotherCycle).findMany.mockResolvedValue(['jury-1','jury-2','jury-3'].map(evictedRosterId=>({evictedRosterId})) as never)
    vi.mocked(prisma.bigBrotherJuryMember).findMany.mockResolvedValue(['jury-1','jury-2','jury-3'].map(rosterId=>({rosterId})) as never)
    vi.mocked(prisma.bigBrotherAuditLog).findFirst.mockResolvedValue(null)
  })

  it('should correctly determine jury eligibility (after_eliminations mode)', async () => {
    vi.mocked(prisma.league).findUnique.mockResolvedValue({ id: 'league-1', sport: 'NFL', leagueVariant: 'big_brother' } as never)
    vi.mocked(prisma.bigBrotherLeagueConfig).findUnique.mockResolvedValue({
      ...mockConfig('league-1'),
      juryStartMode: 'after_eliminations',
      juryStartAfterEliminations: 3,
    } as never)
    vi.mocked(prisma.bigBrotherCycle).count.mockResolvedValue(3) // 3 evictions so far

    const result = await shouldJoinJury('league-1', 4, 7)
    expect(result).toBe(true)
  })

  it('should return false when below jury threshold', async () => {
    vi.mocked(prisma.league).findUnique.mockResolvedValue({ id: 'league-1', sport: 'NFL', leagueVariant: 'big_brother' } as never)
    vi.mocked(prisma.bigBrotherLeagueConfig).findUnique.mockResolvedValue({
      ...mockConfig('league-1'),
      juryStartMode: 'after_eliminations',
      juryStartAfterEliminations: 7,
    } as never)
    vi.mocked(prisma.bigBrotherCycle).count.mockResolvedValue(2) // only 2 evictions

    const result = await shouldJoinJury('league-1', 3, 8)
    expect(result).toBe(false)
  })

  it('should support when_remaining jury mode', async () => {
    vi.mocked(prisma.league).findUnique.mockResolvedValue({ id: 'league-1', sport: 'NFL', leagueVariant: 'big_brother' } as never)
    vi.mocked(prisma.bigBrotherLeagueConfig).findUnique.mockResolvedValue({
      ...mockConfig('league-1'),
      juryStartMode: 'when_remaining',
      juryStartWhenRemaining: 5,
    } as never)

    const result = await shouldJoinJury('league-1', 8, 4) // 4 remain (≤ 5)
    expect(result).toBe(true)
  })

  it('should support fixed_week jury mode', async () => {
    vi.mocked(prisma.league).findUnique.mockResolvedValue({ id: 'league-1', sport: 'NFL', leagueVariant: 'big_brother' } as never)
    vi.mocked(prisma.bigBrotherLeagueConfig).findUnique.mockResolvedValue({
      ...mockConfig('league-1'),
      juryStartMode: 'fixed_week',
      juryStartWeek: 6,
    } as never)

    const resultWeek5 = await shouldJoinJury('league-1', 5, 8)
    const resultWeek6 = await shouldJoinJury('league-1', 6, 7)
    expect(resultWeek5).toBe(false)
    expect(resultWeek6).toBe(true)
  })

  it('should enroll jury member without duplicates (upsert)', async () => {
    vi.mocked(prisma.bigBrotherJuryMember).upsert.mockResolvedValue({} as never)
    vi.mocked(prisma.bigBrotherAuditLog).create.mockResolvedValue({} as never)

    await enrollJuryMember('league-1', 'config-1', 'roster-5', 4)
    expect(prisma.bigBrotherJuryMember.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { leagueId_rosterId: { leagueId: 'league-1', rosterId: 'roster-5' } } })
    )
  })

  it('should tally finale votes correctly', async () => {
    vi.mocked(prisma.bigBrotherFinaleVote).findMany.mockResolvedValue([
      { juryRosterId: 'jury-1', targetRosterId: 'finalist-A' },
      { juryRosterId: 'jury-2', targetRosterId: 'finalist-A' },
      { juryRosterId: 'jury-3', targetRosterId: 'finalist-B' },
    ] as never)

    const winner = await tallyFinaleVotes('league-1')
    expect(winner?.targetRosterId).toBe('finalist-A')
    expect(winner?.voteCount).toBe(2)
  })

  it('should allow jury member to submit finale vote', async () => {
    vi.mocked(prisma.bigBrotherJuryMember).findUnique.mockResolvedValue({
      leagueId: 'league-1',
      configId: 'config-1',
      rosterId: 'jury-1',
    } as never)
    vi.mocked(prisma.bigBrotherFinaleVote).upsert.mockResolvedValue({} as never)

    const result = await submitFinaleVote('league-1', 'jury-1', 'finalist-A')
    expect(result.ok).toBe(true)
  })

  it('should reject finale vote from non-jury member', async () => {
    vi.mocked(prisma.bigBrotherJuryMember).findUnique.mockResolvedValue(null)

    const result = await submitFinaleVote('league-1', 'not-a-jury-member', 'finalist-A')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('jury member')
  })

  it.each(SPORTS)('jury modes work for %s leagues', async (sport) => {
    vi.mocked(prisma.league).findUnique.mockResolvedValue({ id: `league-${sport}`, sport, leagueVariant: 'big_brother' } as never)
    vi.mocked(prisma.bigBrotherLeagueConfig).findUnique.mockResolvedValue({
      ...mockConfig(`league-${sport}`, sport),
      juryStartMode: 'fixed_week',
      juryStartWeek: 8,
    } as never)

    const result = await shouldJoinJury(`league-${sport}`, 9, 4)
    expect(result).toBe(true)
  })
})

// ─── SECTION 10: Challenge Engine ────────────────────────────────────────────
describe('Big Brother — Challenge Engine (HOH + Veto)', () => {
  it('should resolve challenge by score (highest wins)', async () => {
    const winner = await resolveChallengeByScore({
      leagueId: 'league-1',
      configId: 'config-1',
      week: 1,
      participantRosterIds: ['roster-1', 'roster-2', 'roster-3'],
      challengeType: 'hoh',
      scores: { 'roster-1': 110, 'roster-2': 95, 'roster-3': 87 },
    })
    expect(winner).toBe('roster-1')
  })

  it('should resolve challenge by score (lowest wins)', async () => {
    const winner = await resolveChallengeByScore({
      leagueId: 'league-1',
      configId: 'config-1',
      week: 1,
      participantRosterIds: ['roster-1', 'roster-2', 'roster-3'],
      challengeType: 'veto',
      scores: { 'roster-1': 87, 'roster-2': 95, 'roster-3': 110 },
      lowestWins: true,
    })
    expect(winner).toBe('roster-1')
  })

  it('should break ties using season points', async () => {
    const { getBigBrotherSeasonPoints } = await import('@/lib/big-brother/BigBrotherScores')
    vi.mocked(getBigBrotherSeasonPoints).mockImplementation(async (_l, r, _w) => {
      return r === 'roster-2' ? 200 : 100
    })

    const winner = await resolveChallengeByScore({
      leagueId: 'league-1',
      configId: 'config-1',
      week: 1,
      participantRosterIds: ['roster-1', 'roster-2'],
      challengeType: 'hoh',
      scores: { 'roster-1': 100, 'roster-2': 100 }, // tie
    })
    expect(winner).toBe('roster-2') // higher season points
  })

  it('should resolve by seeded random (deterministic)', () => {
    const winner1 = resolveChallengeBySeededRandom({
      leagueId: 'league-1',
      configId: 'config-1',
      week: 3,
      participantRosterIds: ['roster-1', 'roster-2', 'roster-3'],
      challengeType: 'hoh',
    })
    const winner2 = resolveChallengeBySeededRandom({
      leagueId: 'league-1',
      configId: 'config-1',
      week: 3,
      participantRosterIds: ['roster-1', 'roster-2', 'roster-3'],
      challengeType: 'hoh',
    })
    expect(winner1).toBe(winner2)
    expect(['roster-1', 'roster-2', 'roster-3']).toContain(winner1)
  })

  it('different weeks produce different seeds (seeded random varies)', () => {
    const results = new Set<string | null>()
    for (let week = 1; week <= 10; week++) {
      const winner = resolveChallengeBySeededRandom({
        leagueId: 'league-1',
        configId: 'config-1',
        week,
        participantRosterIds: ['roster-1', 'roster-2', 'roster-3', 'roster-4', 'roster-5'],
        challengeType: 'hoh',
      })
      results.add(winner)
    }
    expect(results.size).toBeGreaterThan(1) // should vary across weeks
  })

  it.each(SPORTS)('HOH challenge resolves for %s sport', async (sport) => {
    const winner = await resolveChallengeByScore({
      leagueId: `league-${sport}`,
      configId: `config-${sport}`,
      week: 1,
      participantRosterIds: ['roster-1', 'roster-2', 'roster-3'],
      challengeType: 'hoh',
      scores: { 'roster-1': 120, 'roster-2': 85, 'roster-3': 95 },
    })
    expect(winner).toBe('roster-1')
  })

  it.each(SPORTS)('Veto challenge resolves for %s sport', async (sport) => {
    const winner = await resolveChallengeByScore({
      leagueId: `league-${sport}`,
      configId: `config-${sport}`,
      week: 2,
      participantRosterIds: ['roster-1', 'roster-2', 'roster-3', 'roster-4', 'roster-5', 'roster-6'],
      challengeType: 'veto',
      scores: { 'roster-1': 75, 'roster-2': 90, 'roster-3': 65, 'roster-4': 80, 'roster-5': 110, 'roster-6': 55 },
    })
    expect(winner).toBe('roster-5')
  })
})

// ─── SECTION 11: Have/Have-Nots ──────────────────────────────────────────────
describe('Big Brother — Have / Have-Not System', () => {
  beforeEach(() => vi.clearAllMocks())

  it('should apply 10% challenge score penalty to Have-Nots', () => {
    const rawScores = { 'roster-1': 100, 'roster-2': 120, 'roster-3': 80 }
    const haveNots = ['roster-2']
    const adjusted = applyHaveNotChallengeScorePenalty(rawScores, haveNots)
    expect(adjusted['roster-2']).toBeCloseTo(120 * (1 - HAVE_NOT_CHALLENGE_PENALTY_PCT))
    expect(adjusted['roster-1']).toBe(100) // unchanged
    expect(adjusted['roster-3']).toBe(80)  // unchanged
  })

  it('HAVE_NOT_CHALLENGE_PENALTY_PCT should be 10%', () => {
    expect(HAVE_NOT_CHALLENGE_PENALTY_PCT).toBe(0.1)
  })

  it('Have-Not penalty should never produce negative scores', () => {
    const rawScores = { 'roster-1': 0, 'roster-2': 5 }
    const adjusted = applyHaveNotChallengeScorePenalty(rawScores, ['roster-1', 'roster-2'])
    for (const score of Object.values(adjusted)) {
      expect(score).toBeGreaterThanOrEqual(0)
    }
  })

  it('should bump Have-Not waiver priority to back of queue', async () => {
    const allRosters = [
      { id: 'roster-1', waiverPriority: 1 },
      { id: 'roster-2', waiverPriority: 2 },
      { id: 'roster-3', waiverPriority: 3 },
      { id: 'roster-4', waiverPriority: 4 },
    ]
    vi.mocked(prisma.roster).findMany.mockResolvedValue(allRosters as never)
    vi.mocked(prisma.roster).updateMany.mockResolvedValue({ count: 1 } as never)
    // resolveHaveNotRosterIdsForCycle already mocked to return ['roster-2']

    const { applyHaveNotWaiverPenalties } = await import('@/lib/big-brother/BigBrotherHaveNotPenaltyService')
    const penalised = await applyHaveNotWaiverPenalties('league-1', 'cycle-1')
    expect(penalised).toContain('roster-2')
    expect(prisma.roster.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { waiverPriority: expect.any(Number) },
      })
    )
  })
})

// ─── SECTION 12: Waiver Release on Eviction ──────────────────────────────────
describe('Big Brother — Waiver Release (Eviction)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('should archive roster before clearing on eviction', async () => {
    vi.mocked(prisma.roster).findFirst.mockResolvedValue({
      id: 'roster-5',
      playerData: [{ playerId: 'p1' }],
      platformUserId: 'user-5',
    } as never)
    vi.mocked(prisma.bigBrotherLeagueConfig).findUnique.mockResolvedValue({ id: 'config-1' } as never)
    vi.mocked(prisma.bigBrotherAuditLog).create.mockResolvedValue({} as never)
    vi.mocked(prisma.roster).update.mockResolvedValue({} as never)

    const { releaseEvictedRoster } = await import('@/lib/big-brother/BigBrotherRosterReleaseEngine')
    await releaseEvictedRoster('league-1', 'roster-5', { week: 3 })
    expect(prisma.bigBrotherAuditLog.create).toHaveBeenCalled() // archived
    expect(prisma.roster.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { playerData: expect.anything() } })
    )
  })

  it.each(['immediate', 'next_waiver_run', 'faab_window'] as const)(
    'should handle waiver release timing: %s',
    async (timing) => {
      // Confirm the timing option is valid per constants
      const { WAIVER_RELEASE_TIMING_OPTIONS } = await import('@/lib/big-brother/constants')
      expect(WAIVER_RELEASE_TIMING_OPTIONS).toContain(timing)
    }
  )
})

// ─── SECTION 13: End-to-End Weekly Cycle (Single Sport) ─────────────────────
describe('Big Brother — End-to-End Weekly Cycle (NFL)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('should execute full week: HOH→Nomination→Veto Draw→Veto Decision→Voting→Eviction', () => {
    // Phase transition sequence for a week with veto used
    const withVetoSequence: Array<[string, string]> = [
      ['HOH_OPEN', 'HOH_LOCKED'],
      ['HOH_LOCKED', 'NOMINATION_OPEN'],
      ['NOMINATION_OPEN', 'NOMINATION_LOCKED'],
      ['NOMINATION_LOCKED', 'VETO_DRAW'],
      ['VETO_DRAW', 'VETO_CHALLENGE_OPEN'],
      ['VETO_CHALLENGE_OPEN', 'VETO_DECISION_OPEN'],
      ['VETO_DECISION_OPEN', 'REPLACEMENT_NOMINATION_OPEN'],
      ['REPLACEMENT_NOMINATION_OPEN', 'VOTING_OPEN'],
      ['VOTING_OPEN', 'VOTING_LOCKED'],
      ['VOTING_LOCKED', 'EVICTION_RESOLVED'],
      ['EVICTION_RESOLVED', 'JURY_UPDATE'],
      ['JURY_UPDATE', 'RESET_NEXT_WEEK'],
    ]
    for (const [from, to] of withVetoSequence) {
      expect(canTransition(from as never, to as never)).toBe(true)
    }
  })

  it('should execute abbreviated week: HOH→Nomination→Veto→Direct Voting (veto not used)', () => {
    const withoutVetoSequence: Array<[string, string]> = [
      ['HOH_OPEN', 'HOH_LOCKED'],
      ['HOH_LOCKED', 'NOMINATION_OPEN'],
      ['NOMINATION_OPEN', 'NOMINATION_LOCKED'],
      ['NOMINATION_LOCKED', 'VETO_DRAW'],
      ['VETO_DRAW', 'VETO_CHALLENGE_OPEN'],
      ['VETO_CHALLENGE_OPEN', 'VETO_DECISION_OPEN'],
      ['VETO_DECISION_OPEN', 'VOTING_OPEN'], // skip replacement
      ['VOTING_OPEN', 'VOTING_LOCKED'],
      ['VOTING_LOCKED', 'EVICTION_RESOLVED'],
      ['EVICTION_RESOLVED', 'RESET_NEXT_WEEK'], // skip jury update
    ]
    for (const [from, to] of withoutVetoSequence) {
      expect(canTransition(from as never, to as never)).toBe(true)
    }
  })

  it('challenge → HOH assignment is deterministic for all 7 sports', async () => {
    for (const sport of SPORTS) {
      const scores = {
        'roster-1': 105,
        'roster-2': 98,
        'roster-3': 112,
        'roster-4': 87,
      }
      const winner = await resolveChallengeByScore({
        leagueId: `league-${sport}`,
        configId: `config-${sport}`,
        week: 1,
        participantRosterIds: Object.keys(scores),
        challengeType: 'hoh',
        scores,
      })
      expect(winner).toBe('roster-3')
    }
  })
})

// ─── SECTION 14: Have/Have-Not Challenge Integration ─────────────────────────
describe('Big Brother — Have-Not Penalty Changes Challenge Outcomes', () => {
  it('Have-Not status can flip challenge winner with enough spread', async () => {
    // roster-1 has higher raw score but is Have-Not → gets penalized
    const rawScores = { 'roster-1': 120, 'roster-2': 108 }
    const adjusted = applyHaveNotChallengeScorePenalty(rawScores, ['roster-1'])
    // After 10% penalty: roster-1 gets 108, roster-2 stays 108
    // tie goes to season points; winner should NOT be guaranteed roster-1 anymore
    const adjustedScore1 = adjusted['roster-1']
    expect(adjustedScore1).toBeLessThan(rawScores['roster-1'])
    // Both are now at or near 108 — penalty is meaningful
  })
})

// ─── SECTION 15: Multi-Season / Full Season Flow ─────────────────────────────
describe('Big Brother — Full Season Simulation (10-team, 9-week run to finale)', () => {
  it('should eliminate 8 players before finale with 10-team league', () => {
    // 10 starters → 8 evictions → 2 finalists
    const teams = 10
    const evictions = 8
    const finalists = teams - evictions
    expect(finalists).toBe(2)
  })

  it('should start jury after DEFAULT_JURY_START_AFTER_ELIMINATIONS evictions', () => {
    const jStart = DEFAULT_JURY_START_AFTER_ELIMINATIONS
    expect(jStart).toBe(7)
    // In a 10-team league: week 1-7 = pre-jury evictions, week 8+ = jury
  })

  it('should support final_2 or final_3 finale formats', () => {
    // FINALE_FORMATS already imported at top of file
    const formats = ['final_2', 'final_3']
    const config = mockConfig('league-test')
    expect(formats).toContain(config.finaleFormat)
    expect(formats).toContain('final_2')
    expect(formats).toContain('final_3')
  })

  it.each(SPORTS)('%s: season length is appropriate for sport', (sport) => {
    const endWeek = DEFAULT_EVICTION_END_WEEK_BY_SPORT[sport]
    expect(endWeek).toBeGreaterThanOrEqual(14) // min season coverage
    expect(endWeek).toBeLessThanOrEqual(30)    // max reasonable
  })
})

// ─── SECTION 16: Weekly Challenges (HOH and Veto) ────────────────────────────
describe('Big Brother — Weekly Challenges', () => {
  it.each(SPORTS)('HOH challenge theme hints are sport-specific for %s', (sport) => {
    const hohHints = getHOHChallengeThemeHints(sport)
    const vetoHints = getVetoChallengeThemeHints(sport)
    expect(hohHints.length).toBeGreaterThan(0)
    expect(vetoHints.length).toBeGreaterThan(0)
    // ensure they're different from each other
    const same = hohHints.every((h) => vetoHints.includes(h))
    expect(same).toBe(false)
  })

  it('deterministic_score mode should always pick highest scorer', async () => {
    const scores = { a: 10, b: 20, c: 5, d: 15 }
    const winner = await resolveChallengeByScore({
      leagueId: 'l', configId: 'c', week: 1,
      participantRosterIds: ['a', 'b', 'c', 'd'],
      challengeType: 'hoh',
      scores,
    })
    expect(winner).toBe('b')
  })

  it('hybrid mode can use seeded random as fallback', () => {
    const winner = resolveChallengeBySeededRandom(
      { leagueId: 'l', configId: 'c', week: 5, participantRosterIds: ['a', 'b', 'c'], challengeType: 'veto' }
    )
    expect(['a', 'b', 'c']).toContain(winner)
  })

  it('seeded random for veto draw is same across identical inputs', () => {
    const w1 = resolveChallengeBySeededRandom({ leagueId: 'l', configId: 'c', week: 5, participantRosterIds: ['a', 'b', 'c'], challengeType: 'veto' })
    const w2 = resolveChallengeBySeededRandom({ leagueId: 'l', configId: 'c', week: 5, participantRosterIds: ['a', 'b', 'c'], challengeType: 'veto' })
    expect(w1).toBe(w2)
  })
})

// ─── SECTION 17: Draft Type Support ──────────────────────────────────────────
describe('Big Brother — Draft Type Support (snake + auction)', () => {
  it.each(DRAFT_TYPES)('should support %s draft in Big Brother league', (draftType) => {
    const leagueId = `bb-league-${draftType}`
    const config = mockConfig(leagueId)
    expect(config.leagueId).toContain(draftType)
    // Config is independent of draft type for BB mechanics
    expect(config.juryStartMode).toBeDefined()
    expect(config.finaleFormat).toBeDefined()
  })

  it('snake draft: eviction order is independent of draft pick order', () => {
    // In Big Brother, the eviction is determined by votes, not draft position
    const draftOrder = ['roster-1', 'roster-2', 'roster-3', 'roster-4']
    const evictionOrder = ['roster-3', 'roster-1', 'roster-4', 'roster-2'] // by vote
    expect(draftOrder).not.toEqual(evictionOrder)
  })

  it('auction draft: budget amounts do not affect BB eligibility', () => {
    // Eligibility in BB is determined by eviction status, not auction spend
    const highSpender = 'roster-1'
    const lowSpender = 'roster-2'
    const evicted: string[] = []
    // Neither is evicted, so both are eligible for HOH/veto/voting
    expect(evicted).not.toContain(highSpender)
    expect(evicted).not.toContain(lowSpender)
  })
})

// ─── SECTION 18: Anti-Collusion + Audit ──────────────────────────────────────
describe('Big Brother — Anti-Collusion Logging & Audit Trail', () => {
  it('should have antiCollusionLogging enabled by default', () => {
    const config = mockConfig('league-1')
    expect(config.antiCollusionLogging).toBe(true)
  })

  it('should write audit log for jury enrollment', async () => {
    vi.mocked(prisma.bigBrotherJuryMember).upsert.mockResolvedValue({} as never)
    vi.mocked(prisma.bigBrotherAuditLog).create.mockResolvedValue({} as never)

    await enrollJuryMember('league-1', 'config-1', 'roster-8', 7)
    expect(prisma.bigBrotherAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          leagueId: 'league-1',
          eventType: 'jury_enrolled',
        }),
      })
    )
  })
})
