/**
 * The asker's roster, priced under THIS league's scoring for Chimmy — the number My Team shows (build list #4).
 *
 * Pinned: the same rescore (`computeLeagueProjectedPoints` via `priceLeagueWeek`) so a TE-premium league's tight end
 * reads its own number; foreign ids go through the crosswalk and an unmapped one is never read as a Sleeper id; an
 * unpriced player is said in words, never 0; and the serializer labels these rows as the league's, not canonical.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import {
  loadRosterProjectionBasis,
  priceRosterForLeague,
  type RosterLeagueProjectionDeps,
} from '@/lib/decision-os/grounding/rosterLeagueProjections'
import { serializeDecisionOsGroundingForPrompt } from '@/lib/decision-os/grounding/serialize'

const WEEK = { season: '2026', week: 12 }
/** Full PPR with a 0.5 TE premium and 6-point passing TDs. */
const RULES = { rec: 1, rec_yd: 0.1, rec_td: 6, bonus_rec_te: 0.5, pass_td: 6, pass_yd: 0.04 }

const LINES: Record<string, { position: string; componentStats: Record<string, number> }> = {
  '4866': { position: 'TE', componentStats: { rec: 6, rec_yd: 60, bonus_rec_te: 6 } },
  '4046': { position: 'QB', componentStats: { pass_td: 2, pass_yd: 250 } },
}

function deps(over: Partial<RosterLeagueProjectionDeps> = {}): RosterLeagueProjectionDeps {
  return {
    latestWeek: async () => WEEK,
    loadWeekLines: async ({ playerIds }) => new Map(playerIds.flatMap((id) => (LINES[id] ? [[id, LINES[id]!] as const] : []))),
    loadLeague: async () => ({ sport: 'NFL', platform: 'sleeper', settings: { scoring_settings: RULES } }),
    crosswalk: async () => new Map(),
    ...over,
  }
}

const roster = {
  starters: [
    { playerId: '4046', name: 'Patrick Mahomes', position: 'QB' },
    { playerId: '4866', name: 'Travis Kelce', position: 'TE' },
  ],
  bench: [{ playerId: '9999', name: 'Deep Bench', position: 'WR' }],
}

describe("priced under the league's own rules", () => {
  it('scores each line with the league rulebook: TE premium and 6-point passing TDs land', async () => {
    const d = deps()
    const basis = await loadRosterProjectionBasis({ leagueId: 'lg', sport: 'NFL' }, d)
    const slice = await priceRosterForLeague({ basis, rosterValue: roster, sport: 'NFL' }, d)
    expect(slice.present).toBe(true)
    const by = Object.fromEntries((slice.value ?? []).map((r) => [r.playerName, r]))
    // 6 rec + 6 yds + 6×0.5 premium = 15
    expect(by['Travis Kelce']!.points).toBe(15)
    // 2×6 + 250×0.04 = 22
    expect(by['Patrick Mahomes']!.points).toBe(22)
    expect(by['Travis Kelce']!.week).toBe(12)
  })

  it('a player with no line is kept with points null — never 0, never dropped', async () => {
    const d = deps()
    const basis = await loadRosterProjectionBasis({ leagueId: 'lg', sport: 'NFL' }, d)
    const slice = await priceRosterForLeague({ basis, rosterValue: roster, sport: 'NFL' }, d)
    const bench = slice.value!.find((r) => r.playerId === '9999')!
    expect(bench.points).toBeNull()
    expect(bench.slot).toBe('bench')
  })
})

describe('🛑 foreign roster ids', () => {
  it('an ESPN id reaches the feed only through the crosswalk; an unmapped one is never read as a Sleeper id', async () => {
    const seen: string[][] = []
    const d = deps({
      loadLeague: async () => ({ sport: 'NFL', platform: 'espn', settings: { scoring_settings: RULES } }),
      // ESPN 15847 is Kelce; ESPN 4046 is unmapped and must NOT be priced as Sleeper's 4046.
      crosswalk: async () => new Map([['15847', '4866']]),
      loadWeekLines: async (a) => {
        seen.push([...a.playerIds])
        return new Map(a.playerIds.flatMap((id) => (LINES[id] ? [[id, LINES[id]!] as const] : [])))
      },
    })
    const basis = await loadRosterProjectionBasis({ leagueId: 'lg', sport: 'NFL' }, d)
    const slice = await priceRosterForLeague({
      basis,
      rosterValue: { starters: [{ playerId: '15847', name: 'Travis Kelce', position: 'TE' }, { playerId: '4046', name: 'Someone Else', position: 'RB' }] },
      sport: 'NFL',
    }, d)
    expect(seen).toEqual([['4866']])
    const by = Object.fromEntries(slice.value!.map((r) => [r.playerId, r.points]))
    expect(by['15847']).toBe(15)
    expect(by['4046']).toBeNull()
  })
})

describe('refusals', () => {
  it('a league outside NFL, NCAAF and the board sports is not_requested, with no query', async () => {
    const loadLeague = vi.fn()
    // NCAAF is priced since 2026-11-23 (roster-season-rate-projections.test.ts); a sport nothing prices stays refused.
    const basis = await loadRosterProjectionBasis({ leagueId: 'lg', sport: 'WNBA' }, deps({ loadLeague }))
    expect(basis).toMatchObject({ ok: false, gap: { reason: 'not_requested' } })
    expect(loadLeague).not.toHaveBeenCalled()
  })

  it('no stored rulebook refuses by name — a settings blob of team counts is not a rulebook', async () => {
    const basis = await loadRosterProjectionBasis(
      { leagueId: 'lg', sport: 'NFL' },
      deps({ loadLeague: async () => ({ sport: 'NFL', platform: 'sleeper', settings: { num_teams: 12 } }) }),
    )
    expect(basis).toMatchObject({ ok: false, gap: { reason: 'not_computed' } })
  })

  it('a dependency that throws synchronously never rejects (the packet build awaits it)', async () => {
    const d = deps({
      loadLeague: (() => {
        throw new Error('prisma.league is undefined')
      }) as RosterLeagueProjectionDeps['loadLeague'],
    })
    await expect(loadRosterProjectionBasis({ leagueId: 'lg', sport: 'NFL' }, d)).resolves.toMatchObject({ ok: false })
    const basis = await loadRosterProjectionBasis({ leagueId: 'lg', sport: 'NFL' }, deps())
    const slice = await priceRosterForLeague({ basis, rosterValue: roster, sport: 'NFL' }, deps({
      loadWeekLines: (() => {
        throw new Error('boom')
      }) as RosterLeagueProjectionDeps['loadWeekLines'],
    }))
    expect(slice.present).toBe(false)
  })

  it('nobody priced is an absent slice with a reason, not an all-null list', async () => {
    const d = deps({ loadWeekLines: async () => new Map() })
    const basis = await loadRosterProjectionBasis({ leagueId: 'lg', sport: 'NFL' }, d)
    const slice = await priceRosterForLeague({ basis, rosterValue: roster, sport: 'NFL' }, d)
    expect(slice.present).toBe(false)
    expect(slice.gap?.reason).toBe('not_computed')
  })
})

describe('in the prompt', () => {
  it("renders as THIS league's number with the week, never as the canonical-preset label", async () => {
    const d = deps()
    const basis = await loadRosterProjectionBasis({ leagueId: 'lg', sport: 'NFL' }, d)
    const rosterProjections = await priceRosterForLeague({ basis, rosterValue: roster, sport: 'NFL' }, d)
    const absent = { present: false, value: null, asOf: null, servedFrom: null, confidence: null, conclusive: { ok: true }, gap: null }
    const text = serializeDecisionOsGroundingForPrompt({
      leagueId: 'lg',
      userId: 'u',
      builtAt: new Date().toISOString(),
      importAssertions: absent,
      leagueRules: absent,
      marketValues: absent,
      devyValues: absent,
      projections: absent,
      contextFacts: null,
      contextLookups: null,
      commissionerIntelligence: absent,
      leagueIntelligence: absent,
      portfolio: absent,
      rosterProjections,
      gaps: [],
      meta: { durationMs: 1, engineMs: null, sources: [], killedFeeds: [] },
    } as unknown as Parameters<typeof serializeDecisionOsGroundingForPrompt>[0])
    expect(text).toMatch(/Your roster this week \(this league's scoring\): available/)
    expect(text).toMatch(/Week 12 2026, scored under this league's own rules — the same numbers My Team shows/)
    expect(text).toMatch(/starter: Travis Kelce \(TE\) 15 pts/)
    expect(text).toMatch(/bench: Deep Bench \(WR\) no projection line this week \(NOT zero\)/)
    expect(text).not.toMatch(/Travis Kelce \(TE\) 15 pts.*canonical preset/)
  })
})
