import { describe, expect, it } from 'vitest'

import type { WaiverBoardRow, WaiverPlayer } from '@/lib/core-app/waiversBoard'
import {
  describePick,
  firstKickoff,
  lastKickoff,
  renderWaiverCheck,
  selectWaiverPicks,
  WAIVER_CHECK_MIN_GAIN,
  waiverBoardHref,
  waiverCheckDedupeKey,
  waiverCheckHref,
  waiverCheckMutedBy,
  waiverCheckPrompt,
  waiverCheckWindow,
  type WaiverPick,
} from '@/lib/chimmy-alerts/waiverCheck'

/**
 * Chimmy's Tuesday waiver check: when it goes, which pickups are worth a message, and what it says.
 * The failures a manager would feel: a Tuesday message during Monday Night Football, an "add him"
 * with nothing to drop, a +0.4 "upgrade" that is projection noise, a link that opens the wrong league.
 */

const at = (iso: string) => new Date(iso)
// Week 4, 2026: Thursday night opener (UTC), after a week 3 that ended Monday night.
const W4_TNF = at('2026-10-02T00:15:00Z')
const W3_MNF = at('2026-09-29T00:15:00Z')

const player = (id: string, name: string, projected: number, over: Partial<WaiverPlayer> = {}): WaiverPlayer => ({
  playerId: id,
  name,
  position: 'RB',
  team: 'PIT',
  imageUrl: null,
  projected,
  ownPct: null,
  startPct: null,
  ...over,
})

const row = (leagueId: string, netGain: number, over: Partial<WaiverBoardRow> = {}): WaiverBoardRow => ({
  leagueId,
  leagueName: `League ${leagueId}`,
  platform: 'sleeper',
  platformLeagueId: `s-${leagueId}`,
  logoUrl: null,
  format: null,
  netGain,
  add: player(`add-${leagueId}`, `Add ${leagueId}`, 10 + netGain),
  drop: player(`drop-${leagueId}`, `Drop ${leagueId}`, 10, { position: 'WR', team: 'NYJ' }),
  faabRemaining: null,
  runsAt: null,
  href: `/core/waivers?league=${leagueId}`,
  reasoning: '',
  ...over,
})

describe('when the check goes', () => {
  it('reads the first and last kickoff of a week, ignoring games with no start time', () => {
    const games = [
      { homeTeam: 'A', awayTeam: 'B', startTime: at('2026-10-04T17:00:00Z') },
      { homeTeam: 'C', awayTeam: 'D', startTime: W4_TNF },
      { homeTeam: 'E', awayTeam: 'F', startTime: null as unknown as Date },
      { homeTeam: 'G', awayTeam: 'H', startTime: at('2026-10-06T00:15:00Z') },
    ]
    expect(firstKickoff(games)?.toISOString()).toBe(W4_TNF.toISOString())
    expect(lastKickoff(games)?.toISOString()).toBe('2026-10-06T00:15:00.000Z')
    expect(firstKickoff([])).toBeNull()
    expect(lastKickoff([])).toBeNull()
  })

  it('opens 60h before the opener — Tuesday midday ET for a Thursday game — and closes 12h before it', () => {
    const w = (iso: string) => waiverCheckWindow({ firstKickoff: W4_TNF, previousLastKickoff: W3_MNF, now: at(iso) })
    expect(w('2026-09-29T11:00:00Z')).toBe('early') // Tuesday 7am ET: 61h out
    expect(w('2026-09-29T12:30:00Z')).toBe('open') // Tuesday 8:30am ET
    expect(w('2026-09-30T18:00:00Z')).toBe('open') // Wednesday afternoon
    expect(w('2026-10-01T12:30:00Z')).toBe('closed') // Thursday morning: 11.75h out
    expect(w('2026-10-02T01:00:00Z')).toBe('closed') // the week has started
  })

  it('🛑 stays shut while last week is still being played', () => {
    // A Tuesday-night game: last week's final kickoff is inside the 60h window.
    const tuesdayNight = at('2026-09-30T00:00:00Z')
    const w = (iso: string) => waiverCheckWindow({ firstKickoff: W4_TNF, previousLastKickoff: tuesdayNight, now: at(iso) })
    expect(w('2026-09-30T01:00:00Z')).toBe('early') // 1h into that game
    expect(w('2026-09-30T03:59:00Z')).toBe('early')
    expect(w('2026-09-30T04:00:00Z')).toBe('open') // 4h after its kickoff
  })

  it('does not need last week when it is week 1 or unknown', () => {
    expect(waiverCheckWindow({ firstKickoff: W4_TNF, previousLastKickoff: null, now: at('2026-09-30T12:00:00Z') })).toBe('open')
  })
})

describe('which pickups are worth a message', () => {
  it('keeps only priced swaps that clear the gain bar, best first, capped', () => {
    const rows = [
      row('small', WAIVER_CHECK_MIN_GAIN - 0.1),
      row('no-drop', 9, { drop: null }),
      row('b', 3),
      row('a', 6),
      row('edge', WAIVER_CHECK_MIN_GAIN),
      row('nan', Number.NaN),
    ]
    const picks = selectWaiverPicks(rows, 4)
    expect(picks.map((p) => p.leagueId)).toEqual(['a', 'b', 'edge'])
    expect(picks[0]).toMatchObject({ week: 4, netGain: 6, add: { name: 'Add a' }, drop: { name: 'Drop a' } })
    expect(selectWaiverPicks(rows, 4, { max: 1 }).map((p) => p.leagueId)).toEqual(['a'])
    expect(selectWaiverPicks(rows, 4, { minGain: 5 }).map((p) => p.leagueId)).toEqual(['a'])
  })

  it('breaks a tie the same way every time', () => {
    const picks = selectWaiverPicks([row('z', 4), row('m', 4), row('a', 4)], 4)
    expect(picks.map((p) => p.leagueId)).toEqual(['a', 'm', 'z'])
  })

  it('names nothing when nothing qualifies', () => {
    expect(selectWaiverPicks([row('a', 1), row('b', 8, { drop: null })], 4)).toEqual([])
  })
})

describe('whose switches silence it', () => {
  it('honours the Waivers class, the type, and a league mute — and the Lineup class does not reach it', () => {
    expect(waiverCheckMutedBy(null)).toBeNull()
    expect(waiverCheckMutedBy({ mutedClasses: ['waiver'] })).toBe('muted_class')
    expect(waiverCheckMutedBy({ mutedClasses: ['lineup'] })).toBeNull()
    expect(waiverCheckMutedBy({ classPrefs: { waiver: { muted: true } } })).toBe('muted_class_pref')
    expect(waiverCheckMutedBy({ mutedTypes: ['waiver_check'] })).toBe('muted_type')
    expect(waiverCheckMutedBy({ mutedTypes: ['lineup_check'] })).toBeNull()
    const leagueMuted = { leaguePrefs: [{ leagueId: 'L1', mutedClasses: ['waiver' as const] }] }
    expect(waiverCheckMutedBy(leagueMuted)).toBeNull()
    expect(waiverCheckMutedBy(leagueMuted, 'L1')).toBe('league_muted_class')
    expect(waiverCheckMutedBy({ leaguePrefs: [{ leagueId: 'L1', disabled: true }] }, 'L1')).toBe('league_disabled')
  })
})

describe('what it says', () => {
  const pick = (leagueId: string, netGain: number, over: Partial<WaiverPick> = {}): WaiverPick => ({
    ...selectWaiverPicks([row(leagueId, netGain)], 4, { minGain: 0 })[0]!,
    ...over,
  })

  it('says nothing with nothing to say', () => {
    expect(renderWaiverCheck([])).toBeNull()
  })

  it('names the one move, with the numbers the board would show', () => {
    const m = renderWaiverCheck([pick('L1', 4.26, { faabRemaining: 57 })])!
    expect(m.title).toBe("Chimmy's waiver pick for League L1: Add L1 (+4.3 pts)")
    expect(m.body).toBe('League L1: add Add L1 (RB, PIT), drop Drop L1 — +4.3 projected pts in week 4 · $57 FAAB left.')
    expect(describePick(pick('L1', 3))).toBe('add Add L1 (RB, PIT), drop Drop L1 — +3.0 projected pts in week 4.')
    expect(m.email.subject).toBe(m.title)
  })

  it('counts several leagues, and keeps the push body short', () => {
    const many = ['L1', 'L2', 'L3', 'L4', 'L5'].map((id, i) => pick(id, 9 - i, { leagueName: `A very long league name number ${id}` }))
    const m = renderWaiverCheck(many)!
    expect(m.title).toBe("Chimmy's waiver picks: 5 upgrades across your leagues")
    expect(m.body.length).toBeLessThanOrEqual(300)
    expect(m.body.endsWith('…')).toBe(true)
  })

  it('opens Chimmy with the exact move typed, in that league, tagged by channel', () => {
    const p = pick('L-1', 5)
    expect(waiverCheckPrompt(p)).toBe('Should I pick up Add L-1 and drop Drop L-1?')
    const u = new URL(waiverCheckHref(p), 'https://x.test')
    expect(u.pathname).toBe('/chimmy/chat')
    expect(u.searchParams.get('prompt')).toBe(waiverCheckPrompt(p))
    expect(u.searchParams.get('leagueId')).toBe('L-1')
    expect(u.searchParams.get('from')).toBe('waiver_check')

    const m = renderWaiverCheck([p], { baseUrl: 'https://allfantasy.ai' })!
    expect(new URL(m.actionHref, 'https://x.test').searchParams.get('from')).toBe('waiver_check')
    const chatLinks = [...m.email.html.matchAll(/href="([^"]+)"/g)]
      .map((x) => x[1]!.replace(/&amp;/g, '&'))
      .filter((h) => h.includes('/chimmy/chat'))
    expect(chatLinks.length).toBeGreaterThanOrEqual(2) // the per-league link and the button
    for (const h of chatLinks) expect(new URL(h).searchParams.get('from')).toBe('waiver_check_email')
    expect(m.email.html).toContain(`https://allfantasy.ai${waiverBoardHref('L-1')}`)
  })

  it('escapes league and player names in the email', () => {
    const p = pick('L1', 5, {
      leagueName: '<img src=x onerror=alert(1)>',
      add: player('x', '<script>boom</script>', 15),
    })
    const html = renderWaiverCheck([p], { baseUrl: 'https://allfantasy.ai' })!.email.html
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('<script>boom')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('says what it cannot know, and never says AI to a customer', () => {
    const m = renderWaiverCheck([pick('L1', 5), pick('L2', 3)])!
    // The subline is escaped, apostrophe included.
    expect(m.email.html).toMatch(/unrostered isn(?:'|&#39;|&#x27;)t always claimable/)
    for (const text of [m.title, m.body, m.email.html]) expect(text).not.toMatch(/\bAI\b/)
  })

  it('is one message per user per week', () => {
    expect(waiverCheckDedupeKey('2026', 4)).toBe('chimmy-waiver-check:2026-w4')
  })
})
