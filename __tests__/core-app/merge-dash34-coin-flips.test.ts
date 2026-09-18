import { describe, expect, it } from 'vitest'
import { mergeDash34Issues, type CoinFlipSchedule } from '@/lib/core-app/mergeDash34Issues'
import { rankDecisions } from '@/lib/core-app/decisionQueue'
import type { Dash34Data, Dash34League } from '@/components/core-app/screens/Dashboard34'

/**
 * "Close matchups" in the decision queue — the brief's fifth kind of action (2026-09-17).
 *
 * ⚠ THE PLACEMENT IS THE CLAIM, NOT THE PRESENCE. A coin flip is `warn`: nothing is broken, so it
 * must never outrank an empty slot or a ruled-out starter, and it must sit above a timed `info`
 * like a draft thirty days out. Asserting only that the row exists would pass with the severity
 * set to anything at all.
 */

function league(over: Partial<Dash34League> & { id: string }): Dash34League {
  return {
    name: over.id,
    platform: 'sleeper' as Dash34League['platform'],
    href: `/core?league=${over.id}`,
    ...over,
  } as Dash34League
}

function data(leagues: Dash34League[]): Dash34Data {
  return { leagues, allLeagues: leagues, totalLeagues: leagues.length } as unknown as Dash34Data
}

function flip(leagueId: string, margin = 1.4): CoinFlipSchedule['coinFlips'][number] {
  return {
    leagueId,
    leagueName: leagueId,
    platform: 'sleeper',
    href: `/core/matchup?league=${leagueId}`,
    projection: { margin },
  }
}

const schedule = (...ids: string[]): CoinFlipSchedule => ({ coinFlips: ids.map((id) => flip(id)) })
const ids = (rows: ReturnType<typeof mergeDash34Issues>) => rows.map((r) => r.id)

describe('mergeDash34Issues — close matchups', () => {
  it('states the projected gap and links to that matchup', () => {
    const [row] = mergeDash34Issues([], data([]), { coinFlips: [flip('alpha', -2.35)] })
    expect(row!.id).toBe('alpha:coin-flip')
    expect(row!.meta).toContain('2.4 projected points apart')
    expect(row!.action?.href).toBe('/core/matchup?league=alpha')
  })

  it('is warn, so every real problem outranks it', () => {
    const merged = mergeDash34Issues(
      [],
      data([league({ id: 'broken', priority: 'urgent', emptyStarters: 1 })]),
      schedule('close'),
    )
    expect(ids(rankDecisions(merged))).toEqual(['broken:empty-slot', 'close:coin-flip'])
  })

  /*
   * 🛑 WHY NOT `info`. An untimed `info` sinks BELOW a timed one, so a coin flip this week would
   * have filed under a draft a month away. This is the assertion that pins the choice.
   */
  it('outranks a distant timed draft, which info severity would not have', () => {
    const draft = {
      id: 'league:draft',
      severity: 'info' as const,
      glyph: '▤',
      title: 'Draft coming up',
      meta: '',
      leagueId: 'other',
      leagueName: 'other',
      platform: 'sleeper',
      deadline: new Date(Date.now() + 30 * 24 * 3_600_000),
      action: null,
    }
    const merged = mergeDash34Issues([draft], data([]), schedule('close'))
    expect(ids(rankDecisions(merged))).toEqual(['close:coin-flip', 'league:draft'])
  })

  it('carries no deadline — the board holds no kickoff for a single matchup', () => {
    const [row] = mergeDash34Issues([], data([]), schedule('alpha'))
    expect(row!.deadline).toBeNull()
  })

  it('says nothing twice about one league that already has a row', () => {
    const merged = mergeDash34Issues(
      [],
      data([league({ id: 'alpha', priority: 'urgent', emptyStarters: 2 })]),
      schedule('alpha'),
    )
    expect(ids(merged)).toEqual(['alpha:empty-slot'])
  })

  /*
   * ⚠ THE 604-ROW RULE, APPLIED AHEAD OF TIME. `deriveOutstandingIssues` collapses stale-sync rows
   * for exactly this reason; a 61-league manager can hold ten coin flips, and ten rows saying one
   * sentence is one fact about the week rather than ten facts about ten leagues.
   */
  it('collapses to a single row once there are more than three', () => {
    const merged = mergeDash34Issues([], data([]), schedule('a', 'b', 'c', 'd'))
    expect(ids(merged)).toEqual(['coin-flip:aggregate'])
    expect(merged[0]!.title).toBe('4 matchups are coin flips this week')
    expect(merged[0]!.leagueId).toBeNull()
    expect(merged[0]!.action?.href).toBe('/core/week')
  })

  it('still lists them one by one at exactly three', () => {
    const merged = mergeDash34Issues([], data([]), schedule('a', 'b', 'c'))
    expect(ids(merged)).toEqual(['a:coin-flip', 'b:coin-flip', 'c:coin-flip'])
  })

  /*
   * ⚠ THE TWO READS FAIL INDEPENDENTLY. The summary rejecting must not throw away close matchups
   * the caller already paid for — there used to be an early return that did exactly that.
   */
  it('still reports close matchups when the dash34 read failed', () => {
    const merged = mergeDash34Issues([], null, schedule('alpha'))
    expect(ids(merged)).toEqual(['alpha:coin-flip'])
  })

  it('adds nothing when no schedule was read, rather than claiming no close games', () => {
    const merged = mergeDash34Issues([], data([league({ id: 'alpha' })]))
    expect(merged).toEqual([])
  })
})
