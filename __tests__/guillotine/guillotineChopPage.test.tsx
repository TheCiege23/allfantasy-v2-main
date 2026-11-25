/**
 * The Chop page of a Guilly league (owner's decision, 2026-11-25): ONE list, full all week, the chop zone on top
 * unless the commissioner chose the bottom, the weeks already chopped one step back, no sub-tab row, and no
 * "playoffs" anywhere in a league that has none.
 *
 * It replaced a hub whose chop line was an empty card until the week had scores ("The chop line appears once this
 * week has scores") beside a "your survival" card that told a manager with a team "You don't have an alive team in
 * this league" for the same reason: both read a list that was empty before the first point.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}))
vi.mock('@/components/guillotine/GuillotineAIPanel', () => ({ GuillotineAIPanel: () => <div data-testid="guillotine-ai-panel" /> }))
vi.mock('@/components/guillotine/GuillotineChopAnimation', () => ({ GuillotineChopAnimation: () => null }))
vi.mock('@/components/scenario-explainer/WhatDoINeed', () => ({ ChopExplainerBlock: () => null }))

import { GuillotineHome } from '@/components/guillotine/GuillotineHome'
import { NativeLeagueWorkspace } from '@/components/league/native/NativeLeagueWorkspace'
import { buildNativeLeagueNavigation, GUILLY_MATCHUP_ALIASES, nativeNavLeafIds } from '@/lib/league/nativeLeagueNavigation'
import { buildSurvivalHistory } from '@/lib/guillotine/survivalHistory'
import { normalizeGuillotineRulesPatch, GUILLOTINE_PAID_RULE_FIELDS } from '@/lib/guillotine/guillotineRules'

const NAMES = { a: 'Alpha', me: 'Mine', b: 'Bravo', z: 'Zulu', x: 'Xray' }
const field = ['a', 'me', 'b', 'z'].map((rosterId) => ({ rosterId, displayName: NAMES[rosterId as keyof typeof NAMES] }))
const outlook = (proj: Record<string, number>) =>
  Object.fromEntries(Object.entries(proj).map(([id, p]) => [id, { playersLeft: 9, starters: 9, gamesLeft: 9, remainingProjection: p, partial: false }]))

const config = (over: Record<string, unknown> = {}) => ({
  eliminationStartWeek: 1,
  eliminationEndWeek: 24,
  teamsPerChop: 1,
  tiebreakerOrder: ['bench_points'],
  dangerMarginPoints: 10,
  rosterReleaseTiming: 'next_waiver_run',
  ...over,
})

const home = (over: Record<string, unknown> = {}) => ({
  season: 2026,
  scores: {},
  teamCount: 5,
  aliveCount: 4,
  chopped: [],
  nextChopAt: new Date(Date.now() + 6 * 86_400_000).toISOString(),
  chopLabel: 'By Wednesday 7:00 AM ET',
  nextWaiversAt: null,
  waiverLabel: null,
  lastChop: null,
  history: { weeks: [], teams: [] },
  ...over,
})

/** The owner's screenshot: week 7 of 24, six days before the chop, nobody has scored. */
const beforeScores = (over: Record<string, unknown> = {}) => ({
  leagueId: 'L',
  weekOrPeriod: 7,
  choppedThisWeek: [],
  survivalStandings: [],
  dangerTiers: [],
  recentChopEvents: [],
  assets: { leagueImage: '', introVideo: '' },
  myRosterId: 'me',
  field,
  chopWatch: null,
  outlook: outlook({ a: 130, me: 110, b: 100, z: 60 }),
  home: home(),
  config: config(),
  ...over,
})

/** Mid-week: everyone has points and the engine has put Zulu in the chop zone. */
const live = (over: Record<string, unknown> = {}) =>
  beforeScores({
    dangerTiers: [
      { rosterId: 'a', displayName: 'Alpha', tier: 'safe', pointsFromChopZone: 40 },
      { rosterId: 'me', displayName: 'Mine', tier: 'safe', pointsFromChopZone: 14.2 },
      { rosterId: 'b', displayName: 'Bravo', tier: 'danger', pointsFromChopZone: 4 },
      { rosterId: 'z', displayName: 'Zulu', tier: 'chop_zone', pointsFromChopZone: 0 },
    ],
    field: undefined,
    chopWatch: { live: true, week: 7, chopCount: 1, chopLine: 80 },
    outlook: null,
    home: home({ scores: { a: 120, me: 94.2, b: 84, z: 80 } }),
    ...over,
  })

function mount(body: unknown) {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => { calls.push(String(url)); return { ok: true, json: async () => body } }))
  render(<GuillotineHome leagueId="L" sport="NBA" leagueName="NBA guilly" />)
  return calls
}
const names = () => [...document.querySelectorAll('.gsb-row strong')].map((e) => e.firstChild?.textContent)

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('one list, full all week', () => {
  it('🛑 before anyone has scored, every team is listed with its projection: never the empty "appears once this week has scores" card', async () => {
    const calls = mount(beforeScores())
    await screen.findByTestId('guilly-survival-board')
    // It asks for the outlook: that is what fills the list before a point is scored.
    expect(calls).toEqual(['/api/leagues/L/guillotine/summary?outlook=1'])
    expect(screen.getAllByTestId(/^gsb-row-/).length).toBe(4)
    expect(screen.queryByText(/appears once this week has scores/i)).toBeNull()
    expect(screen.queryByTestId('gsb-empty')).toBeNull()
    // The lowest projection is the PROJECTED chop zone, and says so; it leads the list by default.
    expect(names()).toEqual(['Zulu', 'Bravo', 'Mine', 'Alpha'])
    expect(screen.getByTestId('gsb-chop-line').textContent).toBe('Projected chop zone')
    expect(screen.getByTestId('gsb-list-note').textContent).toBe('Projected · no scores yet')
    expect(screen.getByTestId('gsb-odds-z').textContent).toMatch(/^\d+% safe$/)
    expect(screen.getByTestId('gsb-left-me').textContent).toBe('9 to play · proj 110.0')
  })

  it('🛑 a manager with a team is never told they have none: the old card read an empty list as "no alive team"', async () => {
    mount(beforeScores())
    await screen.findByTestId('guilly-survival-board')
    expect(screen.queryByText(/don.t have an alive team/i)).toBeNull()
    expect(screen.getByTestId('guilly-survival-board').getAttribute('data-status')).toBe('pre_scores')
    expect(screen.getByTestId('gsb-headline').textContent).toBe("Don't finish last this week")
    expect(screen.getByTestId('gsb-row-me').getAttribute('data-me')).toBe('true')
    expect(screen.getByTestId('gsb-my-odds').textContent).toMatch(/Chance safe\d+%/)
  })

  it('[control] a member who really has no team is a spectator, and is offered no lineup or waivers button', async () => {
    mount(beforeScores({ myRosterId: null }))
    await screen.findByTestId('guilly-survival-board')
    expect(screen.getByTestId('guilly-survival-board').getAttribute('data-status')).toBe('spectator')
    expect(screen.getByTestId('gsb-headline').textContent).toBe('4 teams alive')
    expect(screen.queryByRole('link', { name: 'Set lineup' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Waivers' })).toBeNull()
  })

  it('once there are scores the zones are the engine’s, each named once, with the gap in the headline', async () => {
    mount(live())
    await screen.findByTestId('guilly-survival-board')
    expect(screen.getByTestId('gsb-headline').textContent).toBe('Safe by 14.2')
    expect(names()).toEqual(['Zulu', 'Bravo', 'Mine', 'Alpha'])
    expect(screen.getByTestId('gsb-chop-line').textContent).toBe('Chop zone')
    expect(screen.getByTestId('gsb-zone-danger').textContent).toBe('Danger')
    expect(screen.getByTestId('gsb-zone-safe').textContent).toBe('Safe')
    expect(document.querySelectorAll('[data-testid^="gsb-zone-"]').length).toBe(2)
    expect(screen.getByTestId('gsb-list-note').textContent).toBe('Lowest score is chopped')
    // The rank is the place in the race, whichever way the list is drawn.
    expect([...document.querySelectorAll('.gsb-rank')].map((e) => e.textContent)).toEqual(['4', '3', '2', '1'])
    expect(screen.getByRole('link', { name: 'Set lineup' }).getAttribute('href')).toBe('/league/L?view=team')
    expect(screen.getByRole('link', { name: 'Waivers' }).getAttribute('href')).toBe('/league/L?view=players')
  })

  it('names the week of the season and counts down to the chop, once', async () => {
    mount(live())
    await screen.findByTestId('guilly-survival-board')
    expect(document.querySelector('.gsb-eyebrow')?.textContent).toBe('Week 7 of 24 · You vs. the league')
    const clocks = screen.getAllByTestId('gsb-clock')
    expect(clocks.length).toBe(1)
    await waitFor(() => expect(clocks[0]!.textContent).toMatch(/^Chop locks in\d/))
    expect(clocks[0]!.textContent).toContain('By Wednesday 7:00 AM ET')
  })
})

describe('the commissioner’s list order (lib/guillotine/chopListOrder.ts)', () => {
  it('🛑 chop zone at the bottom when the league chose it: the same teams, the other way up', async () => {
    mount(live({ config: config({ chopListOrder: 'chop_bottom' }) }))
    await screen.findByTestId('guilly-survival-board')
    expect(screen.getByTestId('guilly-survival-board').getAttribute('data-order')).toBe('chop_bottom')
    expect(names()).toEqual(['Alpha', 'Mine', 'Bravo', 'Zulu'])
    expect([...document.querySelectorAll('.gsb-rank')].map((e) => e.textContent)).toEqual(['1', '2', '3', '4'])
    // The marker is still above the chop zone's first row.
    expect(screen.getByTestId('gsb-chop-line').parentElement?.querySelector('strong')?.firstChild?.textContent).toBe('Zulu')
    expect(screen.getByTestId('gsb-headline').textContent).toBe('Safe by 14.2')
  })

  it('[control] a league that never chose gets the chop zone on top', async () => {
    mount(live())
    await screen.findByTestId('guilly-survival-board')
    expect(screen.getByTestId('guilly-survival-board').getAttribute('data-order')).toBe('chop_top')
  })

  it('is a rule the page can save, validated, and free for every commissioner', () => {
    const bounds = { startWeek: 1, seasonWeeks: 24 }
    expect(normalizeGuillotineRulesPatch({ chopListOrder: 'chop_bottom' }, bounds)).toEqual({ ok: true, value: { chopListOrder: 'chop_bottom' } })
    expect(normalizeGuillotineRulesPatch({ chopListOrder: 'sideways' }, bounds)).toMatchObject({ ok: false, error: { field: 'chopListOrder' } })
    expect(GUILLOTINE_PAID_RULE_FIELDS.has('chopListOrder')).toBe(false)
  })
})

describe('the weeks already chopped are one step back', () => {
  const history = buildSurvivalHistory({
    scores: [
      { rosterId: 'a', week: 6, points: 120 }, { rosterId: 'me', week: 6, points: 90 }, { rosterId: 'b', week: 6, points: 85 }, { rosterId: 'z', week: 6, points: 100 }, { rosterId: 'x', week: 6, points: 80 },
    ],
    chopped: [{ rosterId: 'x', week: 6 }],
    names: NAMES,
    closeCallMargin: 10,
  })
  const chopped = [{ rosterId: 'x', name: 'Xray', week: 6, points: 80 }]

  it('🛑 the earlier-week button replays that week as it finished, and the later-week button comes back', async () => {
    mount(live({ home: home({ scores: { a: 120, me: 94.2, b: 84, z: 80 }, history, chopped }), recentChopEvents: [{ weekOrPeriod: 6, choppedRosterIds: ['x'] }] }))
    await screen.findByTestId('guilly-survival-board')
    const picker = screen.getByTestId('gsb-week-picker')
    expect(picker.textContent).toBe('Week 7 of 24')
    expect((screen.getByTestId('gsb-week-next') as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByTestId('gsb-week-prev'))
    expect(screen.getByTestId('gsb-week-picker').textContent).toBe('Week 6 of 24')
    expect(names()).toEqual(['Xray', 'Bravo', 'Mine', 'Zulu', 'Alpha'])
    expect(screen.getByTestId('gsb-headline').textContent).toBe('You survived by 10.0')
    expect(screen.getByTestId('gsb-list-note').textContent).toBe('Final')
    // A finished week has no countdown and no lineup to set.
    expect(screen.queryByTestId('gsb-clock')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Set lineup' })).toBeNull()
    expect((screen.getByTestId('gsb-week-prev') as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByTestId('gsb-week-next'))
    expect(screen.getByTestId('gsb-week-picker').textContent).toBe('Week 7 of 24')
    expect(names()).toEqual(['Zulu', 'Bravo', 'Mine', 'Alpha'])
    expect(screen.getByTestId('gsb-clock')).toBeTruthy()
  })

  it('[control] before the first chop there is nothing to step back to, and no empty history card', async () => {
    mount(live())
    await screen.findByTestId('guilly-survival-board')
    expect(screen.queryByTestId('gsb-week-picker')).toBeNull()
    expect(screen.queryByTestId('guillotine-history')).toBeNull()
    expect(screen.queryByText(/No chops yet/i)).toBeNull()
    expect(screen.queryByTestId('gsb-graveyard')).toBeNull()
  })

  it('after a chop, the season so far is a closed row and the graveyard names who fell', async () => {
    mount(live({ home: home({ scores: { a: 120, me: 94.2, b: 84, z: 80 }, history, chopped }) }))
    await screen.findByTestId('guilly-survival-board')
    const fold = screen.getByTestId('guillotine-history') as HTMLDetailsElement
    expect(fold.tagName).toBe('DETAILS')
    expect(fold.open).toBe(false)
    expect(within(fold).getByRole('heading', { level: 2 }).textContent).toBe('The season so far')
    expect(screen.getByTestId('gsb-graveyard').textContent).toContain('Xray')
  })
})

describe('the page is one page', () => {
  it('🛑 no hub beside the list: no hero, second chop line, survival card, tiebreak card, feed or quick links', async () => {
    mount(live())
    await screen.findByTestId('guilly-survival-board')
    for (const id of [
      'specialty-hero', 'guillotine-chop-line', 'guillotine-your-survival', 'guillotine-tiebreaks', 'guillotine-feed', 'guillotine-phone-home',
      'guillotine-quick-chat', 'guillotine-quick-settings', 'guillotine-quick-ai', 'guillotine-quick-waivers',
    ]) {
      expect(screen.queryByTestId(id), id).toBeNull()
    }
    expect(screen.queryByRole('button', { name: 'Projected' })).toBeNull()
    // Reference stays, closed: the rules (with the tiebreak order the rail card used to repeat) and Guilly Chimmy.
    expect((screen.getByTestId('guillotine-rules') as HTMLDetailsElement).open).toBe(false)
    expect(screen.getByTestId('guillotine-rules').textContent).toContain('Ties are broken by')
    expect(screen.getByTestId('guillotine-ai-panel')).toBeTruthy()
  })

  it('a chopped manager is told so and is offered no lineup or waivers button', async () => {
    mount(live({ myRosterId: 'x', home: home({ scores: { a: 120, me: 94.2, b: 84, z: 80 }, chopped: [{ rosterId: 'x', name: 'Xray', week: 6, points: 80 }] }) }))
    await screen.findByTestId('guilly-survival-board')
    expect(screen.getByTestId('gsb-headline').textContent).toBe('You were chopped in week 6')
    expect(screen.queryByRole('link', { name: 'Set lineup' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Waivers' })).toBeNull()
  })
})

describe('navigation: Chop, not Matchup, and no playoffs', () => {
  const ids = ['native_home', 'guillotine', 'matchups', 'scores', 'war_room', 'roster', 'waivers', 'players', 'trades', 'standings', 'league_chat', 'news', 'settings']
  const tabs = ids.map((id) => ({ id, label: id }))
  const groups = buildNativeLeagueNavigation(tabs, true, false, undefined, { draftDone: true })
  const top = groups[0]!.items

  it('🛑 the first tab is Chop and opens the Chop page; there is no Matchup sub-tab beside it', () => {
    expect(top.map((t) => t.label)).toEqual(['Chop', 'Team', 'League', 'Trade', 'News', 'Settings'])
    expect(top[0]!.id).toBe('guillotine')
    expect(top[0]!.children.map((c) => [c.id, c.label])).toEqual([['guillotine', 'Chop'], ['scores', 'Live scores'], ['war_room', 'War Room']])
    // The head-to-head tab is not a second "Matchup" anywhere else either (it used to fall under League).
    expect(nativeNavLeafIds(groups)).not.toContain('matchups')
    expect(GUILLY_MATCHUP_ALIASES).toContain('matchups')
  })

  it('🛑 "Standings", not "Standings & playoffs"', () => {
    const labels = groups.flatMap((g) => g.items.flatMap((t) => [t.label, ...t.children.map((c) => c.label)]))
    expect(labels).toContain('Standings')
    expect(labels.filter((l) => /playoff/i.test(l))).toEqual([])
  })

  it('[control] a league that is not Guilly keeps Matchup and "Standings & playoffs"', () => {
    const other = buildNativeLeagueNavigation(tabs.filter((t) => t.id !== 'guillotine'), true, false, undefined, { draftDone: true })
    expect(other[0]!.items[0]!.label).toBe('Matchup')
    expect(other[0]!.items[0]!.children.map((c) => c.id)).toEqual(['matchups', 'scores', 'war_room'])
    expect(other.flatMap((g) => g.items.flatMap((t) => t.children.map((c) => c.label)))).toContain('Standings & playoffs')
  })

  const league = (over: Record<string, unknown> = {}) =>
    ({ id: 'lg1', name: 'NBA guilly', platform: 'allfantasy', sport: 'NBA', season: 2026, teamCount: 4, format: 'guillotine', scoring: 'points', currentWeek: 7, lifecycleState: 'in_season', leagueVariant: 'guillotine', leagueType: 'guillotine', guillotineMode: true, ...over }) as never
  const workspace = (lg: never, wsTabs = tabs) => (
    <NativeLeagueWorkspace native league={lg} leagues={[lg]} tabs={wsTabs} activeTab="guillotine" isCommissioner onSelectTab={() => {}} onOpenSettings={() => {}} leftPanel={null} rightPanel={null} guillotineBanner={{ line: 'Chop week 7 · 4 alive', mood: 'calm' }}>
      <div>screen</div>
    </NativeLeagueWorkspace>
  )
  const stubShell = () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
    HTMLDialogElement.prototype.showModal ??= function () {}
    HTMLDialogElement.prototype.close ??= function () {}
    localStorage.clear()
    window.history.replaceState(null, '', '/league/lg1')
  }

  it('🛑 the season track reads Setup · Draft · Chop season · Champion, with the season it is in marked', () => {
    stubShell()
    const { container } = render(workspace(league()))
    const steps = [...container.querySelectorAll('.nl-phase li')]
    expect(steps.map((s) => s.textContent)).toEqual(['Setup', 'Draft', 'Chop season', 'Champion'])
    expect(steps.find((s) => s.getAttribute('aria-current') === 'step')?.textContent).toBe('Chop season')
    expect(container.querySelector('.nl-eyebrow')?.textContent).toBe('Chop season')
    expect(container.querySelector('.nl-sidebar')?.textContent).not.toMatch(/playoff/i)
    expect(container.querySelector('.nl-league-heading')?.textContent).not.toMatch(/playoff|regular season|offseason/i)
  })

  it('a league whose stored phase is "playoffs" or finished still never says so', () => {
    stubShell()
    const playoffs = render(workspace(league({ lifecycleState: 'playoffs' })))
    expect(playoffs.container.querySelector('.nl-phase [aria-current=step]')?.textContent).toBe('Chop season')
    playoffs.unmount()
    const done = render(workspace(league({ lifecycleState: 'completed' })))
    expect(done.container.querySelector('.nl-phase [aria-current=step]')?.textContent).toBe('Champion')
    expect(done.container.querySelector('.nl-eyebrow')?.textContent).toBe('Champion')
  })

  it('the sidebar and the sub-tab strip, rendered: Chop leads, three sub-tabs, no Matchup', () => {
    stubShell()
    const { container } = render(workspace(league()))
    const sidebar = [...container.querySelectorAll('.nl-sidebar [data-nav-group=league] button')]
    expect(sidebar.map((b) => b.textContent)).toEqual(['Chop', 'Team', 'League', 'Trade', 'News', 'Settings'])
    expect(sidebar[0]!.getAttribute('aria-current')).toBe('page')
    const strip = [...container.querySelectorAll('[data-testid=nl-subtabs] button')]
    expect(strip.map((b) => b.getAttribute('data-subtab'))).toEqual(['guillotine', 'scores', 'war_room'])
  })
})
