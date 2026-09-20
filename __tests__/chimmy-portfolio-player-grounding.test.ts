// @vitest-environment node
/**
 * Cross-league player grounding for Chimmy — the resolution rule and what it refuses.
 *
 * The risky part of this feature is not the search, it is deciding what counts as a confident
 * hit. `chimmyPlayerCards` measured that matching prose against 13,010 players is a coin flip
 * (~900 real duplicate names), so these tests pin the three refusals that keep it honest.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
/* Only the pure exports are under test; the readers are mocked away so no DB is reachable. */
vi.mock('@/lib/core-app/playerFinder', () => ({
  getPlayerDetail: vi.fn(),
  searchPlayers: vi.fn(),
}))
vi.mock('@/lib/dashboard/get-dashboard-league-list', () => ({
  getDashboardLeagueListForUser: vi.fn(),
}))

import {
  extractNameCandidates,
  resolveFromMatches,
  serializePortfolioPlayerGrounding,
} from '@/lib/chimmy/chimmyPortfolioPlayerGrounding'

const match = (over: Partial<Record<string, unknown>> = {}) =>
  ({
    externalId: '1',
    sleeperId: '1',
    name: 'Rashee Rice',
    position: 'WR',
    team: 'KC',
    imageUrl: null,
    number: null,
    rosteredIn: null,
    platforms: [],
    sport: 'NFL',
    ...over,
  }) as never

describe('extractNameCandidates', () => {
  it('finds a name in an ordinary question, and keeps punctuation that belongs to names', () => {
    expect(extractNameCandidates('Should I trade for Rashee Rice?')).toContain('Rashee Rice')
    expect(extractNameCandidates('What about Amon-Ra St. Brown')).toContain('Amon-Ra St. Brown')
    expect(extractNameCandidates("Is Ja'Marr Chase worth it")).toContain("Ja'Marr Chase")
  })

  it('returns nothing for a message with no capitalised run', () => {
    expect(extractNameCandidates('who should i start this week')).toEqual([])
  })

  /*
   * It is allowed to be over-eager — every candidate still goes through a real search AND
   * `answerMentions` before it can ground anything. This pins the division of labour rather than
   * pretending the extractor is a resolver.
   */
  it('may over-generate, which is safe by design', () => {
    const out = extractNameCandidates('Should I Trade Rashee Rice')
    expect(out.length).toBeGreaterThan(0)
  })

  /*
   * 🛑 THE SENTENCE-OPENING CAPITAL. English capitalises the first word of a question whether or
   * not it is a name, so "Is Ja'Marr Chase worth it" yields the run "Is Ja'Marr Chase" — and
   * searching THAT is not searching for the player. The tail must be offered, and offered FIRST,
   * because the candidate cap decides which forms actually reach the search.
   */
  it("offers the tail of a run before the head, so a leading 'Is' cannot crowd out the name", () => {
    const out = extractNameCandidates("Is Ja'Marr Chase worth it")
    expect(out).toContain("Ja'Marr Chase")
    expect(out.indexOf("Ja'Marr Chase")).toBeLessThan(out.indexOf("Is Ja'Marr"))
  })
})

describe('resolveFromMatches', () => {
  it('resolves when the hit name is genuinely in the message', () => {
    const r = resolveFromMatches('Should I trade for Rashee Rice?', [match()])
    expect(r.kind).toBe('resolved')
  })

  /*
   * 🛑 THE CORE REFUSAL. A ranked search always returns something, so a hit whose name is not in
   * the message would otherwise ground a player nobody asked about.
   */
  it('refuses a hit whose name does not appear in the message', () => {
    const r = resolveFromMatches('Should I trade for Rashee Rice?', [match({ name: 'Justin Jefferson' })])
    expect(r.kind).toBe('none')
  })

  /*
   * 🛑 AMBIGUITY IS REPORTED, NOT RESOLVED. Two different people sharing a name is the exact case
   * `chimmyPlayerCards` calls a coin flip; picking the top hit is what must not happen.
   */
  it('reports ambiguity rather than picking when one name is two different players', () => {
    const r = resolveFromMatches('Thoughts on Josh Allen?', [
      match({ name: 'Josh Allen', position: 'QB', team: 'BUF', externalId: '1' }),
      match({ name: 'Josh Allen', position: 'LB', team: 'JAX', externalId: '2' }),
    ])
    expect(r.kind).toBe('ambiguous')
    if (r.kind === 'ambiguous') expect(r.options).toHaveLength(2)
  })

  it('does NOT call one athlete under two ids ambiguous', () => {
    const r = resolveFromMatches('Thoughts on Rashee Rice?', [
      match({ externalId: 'sleeper:1' }),
      match({ externalId: 'name:Rashee Rice:WR:KC' }),
    ])
    expect(r.kind).toBe('resolved')
  })
})

describe('serializePortfolioPlayerGrounding', () => {
  const detail = (over: Record<string, unknown> = {}) =>
    ({
      player: { name: 'Rashee Rice', position: 'WR', team: 'KC' },
      identityResolved: true,
      bio: {},
      injury: { available: false, reason: 'none' },
      seasonStats: { available: false, reason: 'none' },
      leagues: { available: true, data: [] },
      rosterCoverage: { unmatched: [] },
      ...over,
    }) as never

  it('always names the resolved player, so a wrong resolution is visible', () => {
    const out = serializePortfolioPlayerGrounding(detail())
    expect(out).toContain('Rashee Rice')
    expect(out).toContain('WR')
    expect(out).toContain('KC')
  })

  it('separates your rosters from other managers', () => {
    const out = serializePortfolioPlayerGrounding(
      detail({
        leagues: {
          available: true,
          data: [
            { leagueName: 'Turf Wars', platform: 'sleeper', slot: 'STARTER', isYours: true, owner: null },
            { leagueName: 'Dynasty Dragons', platform: 'sleeper', slot: 'BENCH', isYours: false, owner: { teamName: 'GridIron Ghosts' } },
          ],
        },
      }),
    )
    expect(out).toContain('ON YOUR ROSTER in 1 league: Turf Wars (sleeper, STARTER)')
    expect(out).toContain('Rostered by another manager in 1 league: Dynasty Dragons (GridIron Ghosts)')
  })

  /*
   * 🛑 THE FALSE-NEGATIVE GUARD. ESPN and Yahoo rosters arrive under the provider's own ids and do
   * not resolve to our player table, so those leagues are UNCHECKED. Without this line the packet
   * says "not on any of your rosters" about leagues nobody looked at.
   */
  it('states which leagues were NOT checked, so absence is not read as a fact', () => {
    const out = serializePortfolioPlayerGrounding(
      detail({
        leagues: { available: true, data: [] },
        rosterCoverage: { unmatched: [{ leagueId: 'x', leagueName: 'Yahoo Keepers', platform: 'yahoo' }] },
      }),
    )
    expect(out).toContain('NOT CHECKED')
    expect(out).toContain('Yahoo Keepers')
    expect(out).toContain('Absence above is not evidence')
  })

  it('reports an unavailable roster read as unavailable, not as empty', () => {
    const out = serializePortfolioPlayerGrounding(
      detail({ leagues: { available: false, reason: 'identity unresolved' } }),
    )
    expect(out).toContain('Roster status unavailable: identity unresolved')
    expect(out).not.toContain('Not on any of your rosters')
  })
})
