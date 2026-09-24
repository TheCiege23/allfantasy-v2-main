import { describe, expect, it } from 'vitest'

import type { LineupOptimization, OptimizerPlayer } from '@/lib/chimmy/lineupOptimizerGrounding'
import {
  countFixes,
  findLineupIssues,
  isLockedAt,
  LINEUP_CHECK_PROMPT,
  lineupCheckDedupeKey,
  lineupCheckHref,
  lineupCheckMutedBy,
  lineupCheckWindow,
  mainSlateKickoff,
  PROACTIVE_MIN_GAIN,
  renderLineupCheck,
  teamKickoffs,
  type LineupIssue,
} from '@/lib/chimmy-alerts/lineupCheck'

/**
 * Chimmy's lineup check: what counts as worth a message, when it goes, and what it says. Every
 * rule here has a failure a manager would feel — a Thursday-night starter Chimmy says to bench on
 * Sunday, a coin-flip swap that teaches people to ignore the next message, a check sent before the
 * injury reports it exists to catch.
 */

const at = (iso: string) => new Date(iso)
// Week 3, 2026, as the schedule table actually holds it (UTC): TNF, then the 1pm ET main slate.
const TNF = at('2026-09-25T00:15:00Z')
const MAIN = at('2026-09-27T17:00:00Z')
const LATE = at('2026-09-27T20:25:00Z')
const GAMES = [
  { homeTeam: 'GB', awayTeam: 'DAL', startTime: TNF },
  { homeTeam: 'Green Bay Packers', awayTeam: 'Dallas Cowboys', startTime: TNF },
  { homeTeam: 'BUF', awayTeam: 'MIA', startTime: MAIN },
  { homeTeam: 'Buffalo Bills', awayTeam: 'Miami Dolphins', startTime: MAIN },
  { homeTeam: 'CHI', awayTeam: 'DET', startTime: MAIN },
  { homeTeam: 'SF', awayTeam: 'LAR', startTime: LATE },
]

const p = (id: string, name: string, over: Partial<OptimizerPlayer> = {}): OptimizerPlayer => ({
  playerId: id,
  name,
  position: 'WR',
  team: 'BUF',
  injury: null,
  points: 10,
  ...over,
})

function ready(over: Partial<Extract<LineupOptimization, { status: 'ready' }>> = {}): LineupOptimization {
  return {
    status: 'ready',
    week: { season: '2026', week: 3 },
    best: { points: 100, slots: [] },
    current: { starters: [], points: 100, emptySlots: 0, known: true },
    startInstead: [],
    benchInstead: [],
    gain: 0,
    unpricedStarters: [],
    injuredStarters: [],
    bench: [],
    unpricedActive: 0,
    unfilledSlots: [],
    ...over,
  }
}

const SUNDAY_9AM_ET = at('2026-09-27T13:00:00Z')
const lockedSunday = isLockedAt(teamKickoffs(GAMES), SUNDAY_9AM_ET)
const kinds = (issues: LineupIssue[]) => issues.map((i) => i.kind)

describe('when the check goes', () => {
  it('keys on the MAIN slate — the kickoff most games share — not Thursday night', () => {
    expect(mainSlateKickoff(GAMES)?.toISOString()).toBe(MAIN.toISOString())
    expect(mainSlateKickoff([])).toBeNull()
  })

  it('breaks a tie toward the earlier kickoff', () => {
    const tie = [
      { homeTeam: 'A', awayTeam: 'B', startTime: LATE },
      { homeTeam: 'C', awayTeam: 'D', startTime: MAIN },
    ]
    expect(mainSlateKickoff(tie)?.toISOString()).toBe(MAIN.toISOString())
  })

  it('is open from four hours before the main slate to one hour before', () => {
    const h = (n: number) => new Date(MAIN.getTime() - n * 3_600_000)
    expect(lineupCheckWindow(MAIN, h(4.01))).toBe('early')
    expect(lineupCheckWindow(MAIN, h(4))).toBe('open')
    expect(lineupCheckWindow(MAIN, h(1))).toBe('open')
    expect(lineupCheckWindow(MAIN, h(0.99))).toBe('closed')
    expect(lineupCheckWindow(MAIN, h(-2))).toBe('closed')
  })
})

describe('who is locked', () => {
  it('locks a player once his team has kicked off, matching either spelling of the team', () => {
    expect(lockedSunday({ team: 'GB' })).toBe(true)
    expect(lockedSunday({ team: 'DAL' })).toBe(true)
    expect(lockedSunday({ team: 'BUF' })).toBe(false)
    // Provider rows spell teams in full; the player row uses the abbreviation.
    const kickoffs = teamKickoffs([{ homeTeam: 'Jacksonville Jaguars', awayTeam: 'Houston Texans', startTime: TNF }])
    expect(isLockedAt(kickoffs, SUNDAY_9AM_ET)({ team: 'JAC' })).toBe(true)
  })

  it('never locks a player on bye or with no team', () => {
    expect(lockedSunday({ team: 'NYJ' })).toBe(false)
    expect(lockedSunday({ team: null })).toBe(false)
  })
})

describe('what is worth a message', () => {
  it('says nothing about a lineup the platform never sent', () => {
    const r = ready({ current: { starters: [], points: null, emptySlots: 0, known: false }, gain: null })
    expect(findLineupIssues(r, lockedSunday)).toEqual([])
    expect(findLineupIssues({ status: 'unresolved', reason: 'no_viewer_roster', detail: '' }, lockedSunday)).toEqual([])
  })

  it('flags an empty slot, a starter with no projection, and a starter ruled out', () => {
    const bye = p('1', 'Bye Guy', { team: 'NYJ', points: null })
    const out = p('2', 'Out Guy', { injury: 'Out' })
    const r = ready({
      current: { starters: [bye, out], points: null, emptySlots: 1, known: true },
      unpricedStarters: [bye],
      injuredStarters: [out],
      gain: null,
    })
    expect(kinds(findLineupIssues(r, lockedSunday))).toEqual(['empty_slots', 'no_projection', 'ruled_out'])
  })

  it('leaves a Questionable starter alone — uncertainty is not absence', () => {
    const q = p('2', 'Maybe Guy', { injury: 'Questionable' })
    expect(findLineupIssues(ready({ injuredStarters: [q] }), lockedSunday)).toEqual([])
  })

  it(`calls a reshuffle only at ${PROACTIVE_MIN_GAIN}+ projected points`, () => {
    const moves = { startInstead: [p('3', 'Bench Star')], benchInstead: [p('4', 'Starter')] }
    expect(findLineupIssues(ready({ ...moves, gain: PROACTIVE_MIN_GAIN - 0.1 }), lockedSunday)).toEqual([])
    expect(kinds(findLineupIssues(ready({ ...moves, gain: PROACTIVE_MIN_GAIN }), lockedSunday))).toEqual(['reshuffle'])
  })

  it('drops a reshuffle that touches a player whose game has started', () => {
    const played = p('5', 'Thursday Guy', { team: 'GB' })
    const lockedBench = ready({ startInstead: [p('3', 'Bench Star')], benchInstead: [played], gain: 8 })
    const lockedStart = ready({ startInstead: [played], benchInstead: [p('4', 'Starter')], gain: 8 })
    expect(findLineupIssues(lockedBench, lockedSunday)).toEqual([])
    expect(findLineupIssues(lockedStart, lockedSunday)).toEqual([])
  })

  it('does not flag a locked starter with no projection — nothing can be done about him', () => {
    const played = p('5', 'Thursday Guy', { team: 'GB', points: null })
    const r = ready({ current: { starters: [played], points: null, emptySlots: 0, known: true }, unpricedStarters: [played], gain: null })
    expect(findLineupIssues(r, lockedSunday)).toEqual([])
  })

  it('names the fix for an unpriced starter even though no total can be compared', () => {
    const bye = p('1', 'Bye Guy', { team: 'NYJ', points: null })
    const r = ready({
      current: { starters: [bye], points: null, emptySlots: 0, known: true },
      unpricedStarters: [bye],
      startInstead: [p('3', 'Bench Star')],
      benchInstead: [bye],
      gain: null,
    })
    const issues = findLineupIssues(r, lockedSunday)
    expect(kinds(issues)).toEqual(['no_projection', 'reshuffle'])
    expect(issues[1]).toMatchObject({ kind: 'reshuffle', gain: null })
  })
})

describe('what it says', () => {
  const league = (name: string, issues: LineupIssue[]) => ({ leagueId: `id-${name}`, leagueName: name, week: 3, issues })
  const swap: LineupIssue = { kind: 'reshuffle', gain: 4.26, start: [p('3', 'Tank Dell')], bench: [p('4', 'Rashid Shaheed')] }
  const bye: LineupIssue = { kind: 'no_projection', player: p('1', 'Jayden Reed', { team: 'GB', points: null }) }

  it('says nothing with nothing to fix', () => {
    expect(renderLineupCheck([league('Ice Kings', [])])).toBeNull()
  })

  it('leads with the fixes, in the order to make them, and quotes the numbers it was given', () => {
    const m = renderLineupCheck([league('Ice Kings', [swap, bye])])!
    // The swap is the remedy for the missing projection: one fix, not two.
    expect(m.title).toBe("Chimmy's lineup check: 1 fix for Ice Kings")
    expect(m.body).toBe(
      'Ice Kings: Jayden Reed (WR, GB) is starting with no week 3 projection — a bye, ruled out, or released. ' +
        'Start Tank Dell over Rashid Shaheed (+4.3 projected pts).',
    )
    expect(m.actionHref).toBe(lineupCheckHref('id-Ice Kings'))
  })

  it('counts problems across leagues — each empty slot, and a swap only when it is the whole story', () => {
    expect(countFixes([league('A', [swap])])).toBe(1)
    expect(countFixes([league('A', [bye, swap])])).toBe(1)
    expect(countFixes([league('A', [{ kind: 'empty_slots', count: 2 }, swap])])).toBe(2)
    const m = renderLineupCheck([league('A', [bye]), league('B', [swap, { kind: 'empty_slots', count: 2 }]), league('C', [swap])])!
    expect(m.title).toBe("Chimmy's lineup check: 4 fixes across 3 leagues")
    expect(m.body).toContain('B: 2 starting spots are empty. Start Tank Dell')
  })

  it('links into Chimmy with the lineup question typed and the league chosen', () => {
    const href = lineupCheckHref('L-1')
    const u = new URL(href, 'https://x.test')
    expect(u.pathname).toBe('/chimmy/chat')
    expect(u.searchParams.get('prompt')).toBe(LINEUP_CHECK_PROMPT)
    expect(u.searchParams.get('leagueId')).toBe('L-1')
  })

  it('escapes league and player names in the email', () => {
    const m = renderLineupCheck([league('<img src=x onerror=alert(1)>', [bye])], { baseUrl: 'https://allfantasy.ai' })!
    expect(m.email.html).not.toContain('<img src=x')
    expect(m.email.html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(m.email.html).toContain('https://allfantasy.ai/chimmy/chat?prompt=')
  })

  it('never says AI to a customer', () => {
    const m = renderLineupCheck([league('Ice Kings', [swap, bye, { kind: 'empty_slots', count: 1 }])])!
    for (const text of [m.title, m.body, m.email.html]) expect(text).not.toMatch(/\bAI\b/)
  })

  it('is one message per user per week', () => {
    expect(lineupCheckDedupeKey('2026', 3)).toBe('chimmy-lineup-check:2026-w3')
  })
})

describe('whose switches silence it', () => {
  it('honours the Lineup class, the type, and a league mute from Chimmy alert controls', () => {
    expect(lineupCheckMutedBy(null)).toBeNull()
    expect(lineupCheckMutedBy({ mutedClasses: ['lineup'] })).toBe('muted_class')
    expect(lineupCheckMutedBy({ mutedClasses: ['trade'] })).toBeNull()
    expect(lineupCheckMutedBy({ classPrefs: { lineup: { muted: true } } })).toBe('muted_class_pref')
    expect(lineupCheckMutedBy({ mutedTypes: ['lineup_check'] })).toBe('muted_type')
    const leagueMuted = { leaguePrefs: [{ leagueId: 'L1', mutedClasses: ['lineup' as const] }] }
    expect(lineupCheckMutedBy(leagueMuted)).toBeNull()
    expect(lineupCheckMutedBy(leagueMuted, 'L1')).toBe('league_muted_class')
    expect(lineupCheckMutedBy(leagueMuted, 'L2')).toBeNull()
  })
})
