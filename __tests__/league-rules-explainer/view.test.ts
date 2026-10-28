/**
 * Seen-state and the league home view for the rules popup / "What changed" card
 * (lib/league-rules-explainer/view.ts).
 */
import { describe, expect, it } from 'vitest'
import {
  EMPTY_LEAGUE_RULES_SEEN,
  buildRulesExplainerView,
  isSettingsEventSeen,
  nextLeagueRulesSeen,
  parseSettingsChangeEvents,
  readLeagueRulesSeen,
  type LeagueRulesSeen,
} from '@/lib/league-rules-explainer/view'
import type { RuleSnapshot, SettingsChangeEvent } from '@/lib/league-rules-explainer/types'

const snapshot: RuleSnapshot = { sport: 'NFL', format: 'redraft', teamCount: 12, tradeDeadlineWeek: 13 }
const at = (min: number) => new Date(Date.UTC(2026, 9, 1, 12, 0) + min * 60_000).toISOString()
const ev = (id: string, min: number, actor = 'commish'): SettingsChangeEvent => ({
  id,
  createdAt: at(min),
  actorUserId: actor,
  changes: [{ key: 'tradeDeadlineWeek', before: 12, after: 13 }],
})
const seenAt = (id: string, min: number): LeagueRulesSeen => ({ rulesSeenAt: at(-100), lastSeenSettingsEventId: id, lastSeenSettingsEventAt: at(min) })

const view = (over: Partial<Parameters<typeof buildRulesExplainerView>[0]>) =>
  buildRulesExplainerView({ snapshot, events: [], seen: EMPTY_LEAGUE_RULES_SEEN, viewerUserId: 'member', isCommissioner: false, broadcastsEnabled: true, ...over })

describe('first visit', () => {
  it('shows the full rules popup, and no change cards (the popup already shows the current rules)', () => {
    const v = view({ events: [ev('a', 0)] })
    expect(v.showRulesPopup).toBe(true)
    expect(v.pendingChanges).toEqual([])
    expect(v.history.map((g) => g.lastEventId)).toEqual(['a'])
    expect(v.latestEvent).toEqual({ id: 'a', createdAt: at(0) })
  })

  it('the commissioner gets the same popup, framed as the members’ view', () => {
    const v = view({ isCommissioner: true, viewerUserId: 'commish' })
    expect(v.showRulesPopup).toBe(true)
    expect(v.sections[0]!.lines[0]!.text.k).toBe('leagueRules.overview.commissionerPreview')
  })
})

describe('after the rules were seen', () => {
  it('a newer change by the commissioner is a card; an older one is history', () => {
    const v = view({ events: [ev('old', 0), ev('new', 60)], seen: seenAt('old', 0) })
    expect(v.showRulesPopup).toBe(false)
    expect(v.pendingChanges.map((g) => g.lastEventId)).toEqual(['new'])
    expect(v.history.map((g) => g.lastEventId)).toEqual(['old'])
  })

  it('your own change is never news to you', () => {
    const v = view({ events: [ev('mine', 60, 'member')], seen: seenAt('x', 0) })
    expect(v.pendingChanges).toEqual([])
    expect(v.history).toHaveLength(1)
  })

  it('commissionerBroadcasts off: no card, the change still goes to history', () => {
    const v = view({ events: [ev('new', 60)], seen: seenAt('x', 0), broadcastsEnabled: false })
    expect(v.pendingChanges).toEqual([])
    expect(v.history.map((g) => g.lastEventId)).toEqual(['new'])
  })

  it('changes saved within ten minutes form one card', () => {
    const v = view({ events: [ev('a', 30), ev('b', 35), ev('c', 80)], seen: seenAt('x', 0) })
    expect(v.pendingChanges.map((g) => g.eventIds)).toEqual([['c'], ['a', 'b']])
  })
})

describe('the seen marker', () => {
  it('equal timestamps compare by id, so the marker event itself is seen', () => {
    const seen = seenAt('b', 10)
    expect(isSettingsEventSeen({ id: 'b', createdAt: at(10) }, seen)).toBe(true)
    expect(isSettingsEventSeen({ id: 'a', createdAt: at(10) }, seen)).toBe(true)
    expect(isSettingsEventSeen({ id: 'c', createdAt: at(10) }, seen)).toBe(false)
    expect(isSettingsEventSeen({ id: 'z', createdAt: at(9) }, seen)).toBe(true)
    expect(isSettingsEventSeen({ id: 'a', createdAt: at(11) }, seen)).toBe(false)
    expect(isSettingsEventSeen({ id: 'a', createdAt: at(0) }, EMPTY_LEAGUE_RULES_SEEN)).toBe(false)
  })

  it('closing the rules popup records the newest event, so a new member gets no card for old changes', () => {
    const next = nextLeagueRulesSeen(EMPTY_LEAGUE_RULES_SEEN, { kind: 'rules', now: at(100), latestEvent: { id: 'e9', createdAt: at(50) } })
    expect(next).toEqual({ rulesSeenAt: at(100), lastSeenSettingsEventId: 'e9', lastSeenSettingsEventAt: at(50) })
    const v = view({ events: [ev('e9', 50)], seen: next })
    expect(v.showRulesPopup).toBe(false)
    expect(v.pendingChanges).toEqual([])
  })

  it('never moves backwards, and rulesSeenAt is set once', () => {
    const current = seenAt('e5', 50)
    const stale = nextLeagueRulesSeen(current, { kind: 'changes', event: { id: 'e1', createdAt: at(10) } })
    expect(stale).toEqual(current)
    const fwd = nextLeagueRulesSeen(current, { kind: 'changes', event: { id: 'e6', createdAt: at(60) } })
    expect(fwd.lastSeenSettingsEventId).toBe('e6')
    expect(nextLeagueRulesSeen(current, { kind: 'rules', now: at(999), latestEvent: null }).rulesSeenAt).toBe(current.rulesSeenAt)
  })

  it('reads a malformed stored entry as nothing seen', () => {
    expect(readLeagueRulesSeen(null)).toEqual(EMPTY_LEAGUE_RULES_SEEN)
    expect(readLeagueRulesSeen([1])).toEqual(EMPTY_LEAGUE_RULES_SEEN)
    expect(readLeagueRulesSeen({ rulesSeenAt: 'not a date', lastSeenSettingsEventId: 5 })).toEqual(EMPTY_LEAGUE_RULES_SEEN)
    expect(readLeagueRulesSeen({ rulesSeenAt: at(0), lastSeenSettingsEventId: 'x', lastSeenSettingsEventAt: at(1) })).toEqual({
      rulesSeenAt: at(0),
      lastSeenSettingsEventId: 'x',
      lastSeenSettingsEventAt: at(1),
    })
  })
})

describe('stored events', () => {
  it('only events carrying before/after values count, and unknown keys are dropped', () => {
    const parsed = parseSettingsChangeEvents([
      { id: 'legacy', createdAt: new Date(at(0)), payload: { section: 'trades', updatedFields: ['tradeDeadlineWeek'] } },
      { id: 'new', createdAt: new Date(at(5)), payload: { actorUserId: 'c', ruleChanges: [{ key: 'tradeDeadlineWeek', before: 12, after: 13 }, { key: 'rscToken', before: 'x', after: 'y' }] } },
      { id: 'junk', createdAt: new Date(at(6)), payload: { ruleChanges: [{ key: 'secret', before: 1, after: 2 }] } },
      { id: 'array', createdAt: new Date(at(7)), payload: [] },
    ])
    expect(parsed).toEqual([{ id: 'new', createdAt: at(5), actorUserId: 'c', changes: [{ key: 'tradeDeadlineWeek', before: 12, after: 13 }] }])
  })
})
