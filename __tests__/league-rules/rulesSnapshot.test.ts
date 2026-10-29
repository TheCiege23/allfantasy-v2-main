/**
 * "Rules changed" (2026-10-29): the rules a manager last saw against the rules now — any save route,
 * several edits as one card, and nothing for a change that is not a rule.
 */
import { describe, expect, it } from 'vitest'
import { buildLeagueRulebook, type BuildRulebookInput } from '@/lib/league-rules/buildLeagueRulebook'
import {
  diffRulebook,
  isRulebookComplete,
  readRulesSnapshot,
  rulebookSnapshot,
  RULEBOOK_SNAPSHOT_VERSION,
  SNAPSHOT_MAX_VALUE_CHARS,
} from '@/lib/league-rules/rulesSnapshot'

function book(league: Partial<BuildRulebookInput['league']> = {}, overrides: Partial<BuildRulebookInput> = {}) {
  return buildLeagueRulebook({
    league: {
      id: 'lg1', name: 'Sunday Crew', sport: 'NFL', waiverType: 'faab', waiverBudget: 100, tradeDeadlineWeek: 11,
      playoffTeams: 6, playoffStartWeek: 15, settings: { scoring_mode: 'points', trade_review_mode: 'commissioner' }, ...league,
    },
    formatLabel: 'Redraft',
    scoringLabel: 'PPR',
    rosterSlots: { QB: 1, RB: 2, WR: 2, BN: 6 },
    draft: { dateIso: '2026-09-01T00:00:00.000Z', type: 'snake', rounds: 15, timerSeconds: 90, autostart: true },
    guillotine: null,
    viewerTimeZone: 'America/New_York',
    ...overrides,
  })
}

describe('diffRulebook', () => {
  it('nothing changed: no card', () => {
    expect(diffRulebook(rulebookSnapshot(book()), book())).toEqual([])
  })

  it('a changed rule shows before, after, and what the new rule means', () => {
    const changes = diffRulebook(rulebookSnapshot(book()), book({ waiverBudget: 200 }))
    expect(changes).toEqual([
      {
        id: 'waivers',
        label: 'Waivers',
        before: 'FAAB · $100',
        after: 'FAAB · $200',
        meaning: 'Each team has $200 for the season to bid on free agents. The highest bid wins the player, and the amount comes off your budget.',
      },
    ])
  })

  it('several edits since the last look are one list, in rulebook order', () => {
    const changes = diffRulebook(rulebookSnapshot(book()), book({ waiverBudget: 200, tradeDeadlineWeek: 9, playoffTeams: 4 }))
    expect(changes.map((c) => c.id)).toEqual(['waivers', 'trades', 'playoffs'])
  })

  it('a change that is not a rule (the league name) is no change', () => {
    expect(diffRulebook(rulebookSnapshot(book()), book({ name: 'New Name' }))).toEqual([])
  })

  it('a rule that appears is New; one that disappears no longer applies', () => {
    const redraft = rulebookSnapshot(book())
    const guilly = book({ leagueVariant: 'guillotine', guillotineMode: true }, {
      guillotine: { firstChopWeek: 1, endWeek: 18, locked: false, teamsPerChop: 1, blindAuction: true },
    })
    const changes = diffRulebook(redraft, guilly)
    expect(changes.find((c) => c.id === 'blind-auction')).toMatchObject({ before: null, after: 'Blind auction' })
    expect(changes.find((c) => c.id === 'playoffs')).toMatchObject({ before: '6 teams · starts Wk 15', after: null, meaning: null })
  })
})

describe('snapshots', () => {
  it('round-trip through storage', () => {
    const snap = rulebookSnapshot(book())
    expect(readRulesSnapshot(JSON.parse(JSON.stringify(snap)))).toEqual(snap)
    expect(snap.v).toBe(RULEBOOK_SNAPSHOT_VERSION)
  })

  it('an older template version, or anything malformed, reads as "never seen" so it is replaced silently', () => {
    expect(readRulesSnapshot({ v: RULEBOOK_SNAPSHOT_VERSION - 1, rules: {} })).toBeNull()
    expect(readRulesSnapshot(null)).toBeNull()
    expect(readRulesSnapshot({ v: RULEBOOK_SNAPSHOT_VERSION, rules: [] })).toBeNull()
    // Bad rows are dropped, not trusted; long values are cut to the stored bound.
    const read = readRulesSnapshot({ v: RULEBOOK_SNAPSHOT_VERSION, rules: { ok: { label: 'A', value: 'x'.repeat(500) }, bad: { label: 1, value: 'y' } } })
    expect(Object.keys(read!.rules)).toEqual(['ok'])
    expect(read!.rules.ok!.value).toHaveLength(SNAPSHOT_MAX_VALUE_CHARS)
  })

  it('a rulebook still loading cannot be compared', () => {
    expect(isRulebookComplete(book())).toBe(true)
    expect(isRulebookComplete(book({}, { draft: null }))).toBe(false)
  })
})
