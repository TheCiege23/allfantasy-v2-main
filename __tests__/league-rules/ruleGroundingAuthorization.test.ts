import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  resolveLeagueMembership: vi.fn(),
  findUnique: vi.fn(),
}))

vi.mock('@/lib/league-access', () => ({ resolveLeagueMembership: h.resolveLeagueMembership }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: h.findUnique } } }))

import { buildLeagueRulesGrounding, buildRuleGroundingGap } from '@/lib/chimmy/leagueRulesGrounding'
import { loadLeagueGroundingForUser } from '@/lib/chimmy/chimmy-league-snapshot'

/**
 * EXECUTABLE authorization coverage for rule grounding.
 *
 * 🛑 THIS DRIVES THE REAL BOUNDARY, NOT A STRING MATCH. The structural tests in
 * `step3Acceptance.test.ts` read the route source and assert it reads
 * `leagueSnapshot.` — useful, and strictly weaker than this, because a source
 * scan cannot tell whether the boundary it names actually refuses anyone. Here
 * `loadLeagueGroundingForUser` runs for real against a mocked membership
 * resolver and a mocked prisma, and the route's own composition is reproduced
 * on top of its result.
 *
 * The four required cases: authorized, a different unauthorized user, a
 * nonexistent league, and a membership lookup that throws.
 */

/** Everything a leaked league row would contain, so a leak is detectable. */
const SECRET_ROW = {
  id: 'league-private',
  name: 'The Secret Cartel',
  sport: 'NFL',
  platform: 'sleeper',
  platformLeagueId: 'sleeper-999',
  season: 2026,
  leagueSize: 12,
  scoring: 'PPR Superflex',
  leagueVariant: 'keeper',
  isDynasty: false,
  status: 'active',
  timezone: 'America/New_York',
  lastSyncedAt: null,
  importBatchId: null,
  importedAt: null,
  leagueType: 'keeper',
  settings: { conceptRules: { extensions: { aliasTags: ['king_of_the_hill'] } } },
  keeperCount: 7,
  keeperCostSystem: 'auction_pct',
  keeperRoundPenalty: 4,
}

/**
 * Exactly what the route does: ground, then build rules only from the grounded
 * snapshot, and emit an explicit gap when there is none.
 *
 * ⚠ THIS MIRRORS THE ROUTE'S COMPOSITION RATHER THAN IMPORTING IT. The route is
 * a 3,100-line POST handler that needs auth, an AI provider and a dozen other
 * mocks to enter; standing all that up would test the mocks. The property under
 * test is the gate, and the gate is these four lines. `step3Acceptance` asserts
 * separately that the route's own copy still has this shape.
 */
async function groundingContextFor(userId: string | null, leagueId: string): Promise<string> {
  const grounding = await loadLeagueGroundingForUser(userId, leagueId)
  const snapshot = grounding.ok ? grounding.snapshot : null
  if (!snapshot) return buildRuleGroundingGap('not_grounded')
  return (
    buildLeagueRulesGrounding({
      leagueType: snapshot.leagueType,
      isDynasty: snapshot.isDynasty,
      keeperCount: snapshot.keeperCount,
      keeperCostSystem: snapshot.keeperCostSystem,
      keeperRoundPenalty: snapshot.keeperRoundPenalty,
      settings: snapshot.settings,
      sport: snapshot.sport,
    }) ?? buildRuleGroundingGap('not_grounded')
  )
}

/** Every league-identifying value that must never appear for an outsider. */
const LEAKABLE = [
  'The Secret Cartel',
  'sleeper-999',
  'PPR Superflex',
  'auction_pct',
  'America/New_York',
  'King of the Hill',
  'league-private',
]

beforeEach(() => {
  vi.clearAllMocks()
  h.findUnique.mockResolvedValue(SECRET_ROW)
})

describe('authorized member', () => {
  beforeEach(() => h.resolveLeagueMembership.mockResolvedValue({ ok: true }))

  it('receives the league rules', async () => {
    const ctx = await groundingContextFor('owner-1', 'league-private')
    expect(ctx).toContain('LEAGUE RULES')
    expect(ctx).not.toContain('EVIDENCE GAP')
  })

  it('and the rules are the real ones — the positive control for every leak assertion below', async () => {
    /*
     * 🛑 WITHOUT THIS, THE NEGATIVE TESTS ARE VACUOUS. If the fixture never
     * reached the prompt for anybody, "the outsider did not see it" would pass
     * with the whole feature deleted.
     */
    const ctx = await groundingContextFor('owner-1', 'league-private')
    expect(ctx).toContain('King of the Hill')
    expect(ctx).toContain('auction_pct')
  })
})

describe('a DIFFERENT, unauthorized user asking for that same league', () => {
  beforeEach(() => h.resolveLeagueMembership.mockResolvedValue({ ok: false, reason: 'not_member' }))

  it('gets an explicit evidence gap, not rules', async () => {
    const ctx = await groundingContextFor('stranger-9', 'league-private')
    expect(ctx).toContain('EVIDENCE GAP')
    expect(ctx).not.toContain('LEAGUE RULES (catalog')
  })

  it('🛑 no league name, settings, scoring, keeper rule or concept reaches the context', async () => {
    const ctx = await groundingContextFor('stranger-9', 'league-private')
    for (const secret of LEAKABLE) {
      expect(ctx, `leaked: ${secret}`).not.toContain(secret)
    }
  })

  it('and the row is never even read — refusal happens before the query', async () => {
    /*
     * Stronger than checking the output: the data does not enter the process.
     * A future edit that reads first and filters later would fail here.
     */
    await groundingContextFor('stranger-9', 'league-private')
    expect(h.findUnique).not.toHaveBeenCalled()
  })

  it('is told not to state league rules rather than left to guess', async () => {
    const ctx = await groundingContextFor('stranger-9', 'league-private')
    expect(ctx).toContain('Do NOT state them')
    expect(ctx).toContain('do NOT infer them from the league name')
  })
})

describe('anonymous caller', () => {
  it('is refused the same way', async () => {
    h.resolveLeagueMembership.mockResolvedValue({ ok: false, reason: 'anonymous' })
    const ctx = await groundingContextFor(null, 'league-private')
    expect(ctx).toContain('EVIDENCE GAP')
    for (const secret of LEAKABLE) expect(ctx).not.toContain(secret)
  })
})

describe('nonexistent league', () => {
  it('membership miss yields a gap and no read', async () => {
    h.resolveLeagueMembership.mockResolvedValue({ ok: false, reason: 'not_found' })
    const ctx = await groundingContextFor('owner-1', 'no-such-league')
    expect(ctx).toContain('EVIDENCE GAP')
    expect(h.findUnique).not.toHaveBeenCalled()
  })

  it('a membership pass with a vanished row still yields a gap, not a guess', async () => {
    // The race: membership proved it existed, the row is gone by the time we read.
    h.resolveLeagueMembership.mockResolvedValue({ ok: true })
    h.findUnique.mockResolvedValue(null)
    const ctx = await groundingContextFor('owner-1', 'league-private')
    expect(ctx).toContain('EVIDENCE GAP')
    expect(ctx).not.toContain('LEAGUE RULES (catalog')
  })
})

describe('membership lookup failure', () => {
  it('a throwing resolver is a refusal, never an open door', async () => {
    /*
     * ⚠ FAIL CLOSED. An authorization check that throws must not be read as
     * "no objection raised" — the shape this repo has been bitten by, where a
     * non-zero status was treated as a verdict.
     */
    h.resolveLeagueMembership.mockRejectedValue(new Error('db down'))
    const ctx = await groundingContextFor('stranger-9', 'league-private')
    expect(ctx).toContain('EVIDENCE GAP')
    for (const secret of LEAKABLE) expect(ctx).not.toContain(secret)
  })

  it('a throwing row read is also a refusal', async () => {
    h.resolveLeagueMembership.mockResolvedValue({ ok: true })
    h.findUnique.mockRejectedValue(new Error('db down'))
    const ctx = await groundingContextFor('owner-1', 'league-private')
    expect(ctx).toContain('EVIDENCE GAP')
  })

  it('the gap never contains the underlying error text', async () => {
    /*
     * An upstream message can carry a URL, and this repo has recorded a
     * credential escaping through exactly that route.
     */
    h.resolveLeagueMembership.mockRejectedValue(new Error('connect postgres://user:hunter2@db/x'))
    const ctx = await groundingContextFor('owner-1', 'league-private')
    expect(ctx).not.toContain('hunter2')
    expect(ctx).not.toContain('postgres://')
  })
})
