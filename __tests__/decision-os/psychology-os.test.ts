import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

const { listProfilesByLeague, readLeagueTrajectories, summariseTrajectory } = vi.hoisted(() => ({
  listProfilesByLeague: vi.fn(),
  readLeagueTrajectories: vi.fn(),
  summariseTrajectory: vi.fn(),
}))
vi.mock('@/lib/psychological-profiles/ManagerBehaviorQueryService', () => ({ listProfilesByLeague }))
vi.mock('@/lib/psychological-profiles/ProfileSeasonSnapshot', () => ({ readLeagueTrajectories, summariseTrajectory }))

import { psychologyProfileSource, createPsychologyOsLoaders } from '@/lib/decision-os/psychology-os'

const NO_TRAJECTORY = { hasTrajectory: false, summary: 'No season history has been recorded for this manager yet.', seasonsRecorded: 0 }
import { OS_SCOPE_LEVELS, HOURS } from '@/lib/decision-os/domain-os/types'

/**
 * Psychology OS — the feed that brings `lib/psychological-profiles` behind Decision OS (R4b).
 *
 * ── 🛑 THE ENGINE WAS NEVER THE MISSING PIECE ───────────────────────────────────────────────
 * 16 modules, all seven sports, migrated tables, 15 labels, an evidence floor, a viewer-scoped
 * cross-league rollup, 8 API routes and two user-facing pages — all of it built, and **zero
 * references to it anywhere in `lib/decision-os/`**. What was missing was a seam.
 *
 * ⚠ P6 IS NOT REIMPLEMENTED HERE. `gateScores` already nulls any score whose dimension is below
 * the evidence floor, and its own comment says a profile written before the counts existed is
 * "reported as unmeasured rather than assumed sufficient". This feed carries that decision
 * through rather than making a second one — a rival floor would be the two-implementations-of-
 * one-rule bug this repo keeps recording.
 */
const view = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  leagueId: 'L1',
  managerId: 'm1',
  sport: 'NFL',
  sportLabel: 'NFL',
  profileLabels: ['trade-heavy'],
  aggressionScore: 71,
  activityScore: 60,
  tradeFrequencyScore: 80,
  waiverFocusScore: 40,
  riskToleranceScore: 55,
  updatedAt: new Date('2026-09-01T00:00:00.000Z'),
  evidenceCount: 42,
  displayScores: {
    aggressionScore: 71,
    activityScore: 60,
    tradeFrequencyScore: 80,
    waiverFocusScore: null,
    riskToleranceScore: 55,
  },
  evidenceSummary: {
    dimensions: {
      trade: { evidenceCount: 30, sufficient: true, confidence: 'high' },
      draft: { evidenceCount: 12, sufficient: true, confidence: 'moderate' },
      roster: { evidenceCount: 0, sufficient: false, confidence: null },
    },
    observedDimensions: ['trade', 'draft'],
    missingDimensions: ['roster'],
    anySufficient: true,
  },
  ...over,
})

describe('Psychology OS — the feed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    readLeagueTrajectories.mockResolvedValue(new Map())
    summariseTrajectory.mockReturnValue(NO_TRAJECTORY)
  })

  it('is LEAGUE level, keyed on the league alone, so the refresh cron can warm it', () => {
    // The three-part rule 1.1b had to retrofit onto Waiver OS and Trade OS: a source is only
    // schedulable if its derive is satisfiable from its own scope key. This one is.
    expect(psychologyProfileSource.level).toBe('league')
    expect(OS_SCOPE_LEVELS).toContain(psychologyProfileSource.level)
    expect(psychologyProfileSource.scopeKey({ leagueId: 'L9', sport: 'NFL' })).toBe('L9')
  })

  it('expires in hours, not minutes — a psych profile is the slowest-moving fact in the system', () => {
    // It is rebuilt from seasons of transactions. A short TTL would re-derive a row that
    // provably has not moved, which is the cost `domain-os/types.ts` warns about.
    expect(psychologyProfileSource.ttlMs).toBeGreaterThanOrEqual(6 * HOURS)
  })

  it('🛑 returns NULL rather than an empty array when a league has no profiles', async () => {
    // An empty array is not a fact. `createOsFeed` never caches an unavailable result, so
    // returning [] here would cache "this league has no managers" for the whole TTL.
    listProfilesByLeague.mockResolvedValue([])
    expect(await psychologyProfileSource.derive({ leagueId: 'L1', sport: 'NFL' })).toBeNull()
  })

  it('never throws when the query fails — an unavailable fact is not an exception', async () => {
    listProfilesByLeague.mockRejectedValue(new Error('db down'))
    await expect(psychologyProfileSource.derive({ leagueId: 'L1', sport: 'NFL' })).resolves.toBeNull()
  })

  it('🛑 carries the GATED scores, not the raw ones', async () => {
    // waiverFocusScore is null in displayScores because its dimension is below the floor. The raw
    // 40 must not survive into the feed — that is the number that would be rendered as fact.
    listProfilesByLeague.mockResolvedValue([view()])
    const out = await psychologyProfileSource.derive({ leagueId: 'L1', sport: 'NFL' })
    expect(out?.[0].scores.waiverFocusScore).toBeNull()
    expect(out?.[0].scores.tradeFrequencyScore).toBe(80)
  })

  it('reports WHICH dimensions are unmeasured, not just that something is missing', async () => {
    listProfilesByLeague.mockResolvedValue([view()])
    const out = await psychologyProfileSource.derive({ leagueId: 'L1', sport: 'NFL' })
    expect(out?.[0].unmeasuredDimensions).toEqual(['roster'])
  })

  it('measures confidence from evidence, and reports sampleSize', async () => {
    // Mirrors the learning trio: a fact from 2 observations and one from 200 are not the same
    // fact, and without the sample a consumer cannot tell them apart.
    const m = psychologyProfileSource.measure?.([
      { managerId: 'm1', evidenceCount: 42, anySufficient: true } as never,
    ])
    expect(m?.sampleSize).toBe(42)
    expect(m?.confidence).not.toBeNull()
  })

  it('🛑 expresses NO confidence when nothing clears the floor', async () => {
    // Null means "the producer does not express one" — never 0, which reads as measured certainty
    // that the manager is unpredictable.
    const m = psychologyProfileSource.measure?.([
      { managerId: 'm1', evidenceCount: 1, anySufficient: false } as never,
    ])
    expect(m?.confidence).toBeNull()
  })

  /**
   * ── R4b.5 — trajectory joins the feed, ONE query for the whole league ──────────────────────
   * `psychology-os/index.ts`'s own header used to say "IT DOES NOT CARRY A TRAJECTORY YET" —
   * these tests pin that it now does, and that the batching (readLeagueTrajectories once, not
   * readManagerTrajectory per row) is real, not just documented.
   */
  it('🛑 fetches trajectories ONCE for the whole league, not once per manager', async () => {
    listProfilesByLeague.mockResolvedValue([view({ managerId: 'm1' }), view({ managerId: 'm2' })])
    await psychologyProfileSource.derive({ leagueId: 'L1', sport: 'NFL' })
    expect(readLeagueTrajectories).toHaveBeenCalledTimes(1)
    expect(readLeagueTrajectories).toHaveBeenCalledWith('L1')
  })

  it('attaches each manager\'s OWN trajectory, not the same one to everybody', async () => {
    listProfilesByLeague.mockResolvedValue([view({ managerId: 'm1' }), view({ managerId: 'm2' })])
    const m1Points = [{ season: 2026, labels: [], aggressionScore: null, sampleSize: 1, confidence: 0.5 }]
    readLeagueTrajectories.mockResolvedValue(new Map([['m1', m1Points]]))
    summariseTrajectory.mockImplementation((points: unknown[]) =>
      points.length > 0 ? { hasTrajectory: true, summary: 'm1 has history', seasonsRecorded: 1 } : NO_TRAJECTORY,
    )
    const out = await psychologyProfileSource.derive({ leagueId: 'L1', sport: 'NFL' })
    expect(out?.find((f) => f.managerId === 'm1')?.trajectory.hasTrajectory).toBe(true)
    expect(out?.find((f) => f.managerId === 'm2')?.trajectory.hasTrajectory).toBe(false)
    // The manager with no rows in the map gets an empty array, not undefined passed to the summariser.
    expect(summariseTrajectory).toHaveBeenCalledWith([])
  })

  it('exposes a read-through loader', () => {
    const l = createPsychologyOsLoaders({ store: { read: async () => null, write: async () => true } as never })
    expect(typeof l.loadProfiles).toBe('function')
    expect(typeof l.drainOutcomes).toBe('function')
  })
})
