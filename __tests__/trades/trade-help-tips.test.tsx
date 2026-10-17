// @vitest-environment jsdom
/**
 * The shared "?" (TopicTip → InfoTip) on the /core Trades screens, and the two copy fixes that were
 * held until the trades visuals landed.
 *
 * ⚠ RENDERED, NOT GREPPED. Each tip is found as the real `.af-info-tip` button, by the accessible
 * name TopicTip gives it, on the screen it was placed on — a topic that exists in the dictionary but
 * was never mounted would pass a source grep and fail here.
 *
 * ⚠ AND NO `title` ON ANY ANCESTOR (InfoTip's own rule): a `title` above the tip pops a hover-only
 * tooltip over the open popover. The Trade Center's "AF this week" row carried exactly that.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

const lang = vi.hoisted(() => ({ value: 'en' }))
vi.mock('@/components/i18n/LanguageProviderClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/i18n/LanguageProviderClient')>()
  return { ...actual, useOptionalLanguage: () => ({ language: lang.value, setLanguage: () => {} }) }
})
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push() {}, replace() {}, prefetch() {}, refresh() {}, back() {}, forward() {} }),
  usePathname: () => '/core/trades',
  useSearchParams: () => new URLSearchParams(),
}))
const rosterData = vi.hoisted(() => ({ current: null as unknown }))
vi.mock('@/components/core-app/screens/useLeagueRosters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/core-app/screens/useLeagueRosters')>()
  return { ...actual, useLeagueRosters: () => ({ data: rosterData.current, state: 'idle' }) }
})
const fetchTradesPanel = vi.hoisted(() => vi.fn())
vi.mock('@/components/core-app/screens/tradesPanelFetch', () => ({
  fetchTradesPanel: (...args: unknown[]) => fetchTradesPanel(...args),
}))

import { TradeCenter } from '@/components/core-app/screens/TradeCenter'
import { TradeInbox } from '@/components/core-app/screens/TradeInbox'
import { TradeLeagueStrip } from '@/components/core-app/screens/TradeLeagueStrip'
import { TradePartnerSuggestions } from '@/components/core-app/screens/TradePartnerSuggestions'
import { TradeFinderPanel } from '@/components/core-app/screens/TradeFinderPanel'
import { TradeEvidencePanel } from '@/components/core-app/screens/TradeEvidencePanel'
import { GenericTradeAnalyzer } from '@/components/core-app/screens/GenericTradeAnalyzer'
import { DashTradeBand } from '@/components/core-app/screens/DashTradeBand'
import Trades from '@/components/core-app/screens/Trades'
import { gradeTrade } from '@/lib/decision-os/trade/tradeGrade'
import { HELP_TOPICS, type HelpTopicId } from '@/lib/core-app/helpTopics'
import { tradeVisualCopy } from '@/lib/core-app/tradeVisualCopy'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import type { TradesData, TradeRecord } from '@/lib/core-app/trades'
import type { RecentTrade } from '@/lib/core-app/recentTrades'

const fetchMock = vi.fn()
beforeEach(() => {
  window.localStorage.clear()
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => ({ ok: false, status: 500, json: async () => ({}) }))
  vi.stubGlobal('fetch', fetchMock)
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false }),
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  lang.value = 'en'
})

/** The tip for `topic`, as TopicTip renders it — and no `title` anywhere above it. */
function tipFor(topic: HelpTopicId, language: 'en' | 'es' = 'en'): HTMLButtonElement {
  const t = HELP_TOPICS[topic][language]
  const name = language === 'es' ? `Qué significa «${t.title}»` : `What “${t.title}” means`
  const buttons = screen.getAllByRole('button', { name })
  expect(buttons, `${topic}: one tip per section, so one per screen here`).toHaveLength(1)
  const btn = buttons[0] as HTMLButtonElement
  expect(btn.className).toContain('af-info-tip')
  for (let el: HTMLElement | null = btn.parentElement; el; el = el.parentElement) {
    expect(el.hasAttribute('title'), `${topic}: <${el.tagName.toLowerCase()} class="${el.className}"> has a title`).toBe(false)
    // Never inside a link or another button.
    expect(['A', 'BUTTON', 'SUMMARY'].includes(el.tagName), `${topic}: inside a ${el.tagName}`).toBe(false)
  }
  return btn
}

/* ── The Trade Center, league mode ─────────────────────────────────────────────────────────── */

const player = (id: string, name: string, position: string, value: number, afProjection?: number) => ({
  id, name, position, team: 'X', value, imageUrl: null, byeWeek: null, injuryStatus: null, stock: null, stockDelta: null,
  ...(afProjection != null ? { afProjection } : {}),
})
const roster = (rosterId: string, ownerName: string, players: unknown[]) => ({
  rosterId, platformUserId: `u-${rosterId}`, players, picks: [], teamExternalId: `t-${rosterId}`,
  ownerName, avatarUrl: null, wins: 0, losses: 0, ties: 0, faabRemaining: null,
})

function analysis() {
  const grade = gradeTrade({ giveValue: 5000, getValue: 5153, giveMarket: 5000, getMarket: 4500,
    unpriced: 0, giveCount: 1, getCount: 1, basis: 'Dynasty · 1QB · 12 teams · PPR',
    scoringApplied: true, needApplied: false, needGap: null,
    lines: [{ side: 'give', name: 'Kenneth Walker', marketValue: 5000, leagueValue: 5000 },
      { side: 'get', name: 'Trey McBride', marketValue: 4500, leagueValue: 5153 }], moves: [] })
  if (!grade.graded) throw new Error('expected a graded deal')
  return {
    percentDiff: grade.percentDiff,
    fairnessScore: 51,
    labels: { fairnessLabel: 'Even', confidenceLabel: 'MEDIUM' },
    giveTotal: 5000,
    getTotal: 5153,
    valueBasis: { graded: 'league', label: 'Dynasty · 1QB · 12 teams · PPR', scoringAdjusted: true, needAdjusted: false, needGap: null },
    grade: { ...grade, rosterFit: { giveValue: 5000, getValue: 5928, percentDiff: 16,
      moves: [{ side: 'get', name: 'Trey McBride', base: 4500, leagueValue: 5928, reasons: ['you cannot fill 1 TE slot'] }] } },
    tradeIntelligence: { whoWinsNow: 'you', whoWinsLongTerm: 'you', why: 'A reason.' },
    players: {
      give: [{ name: 'Kenneth Walker', position: 'RB', marketValue: 5000, leagueValue: 5000, valueAdjustments: [], pricedSource: 'fantasycalc' }],
      get: [{ name: 'Trey McBride', position: 'TE', marketValue: 4500, leagueValue: 5153, pricedSource: 'fantasycalc',
        valueAdjustments: [{ kind: 'scoring', factor: 1.145, reason: 'TE receptions are worth 1.5 here vs 1 on the chart' }] }],
    },
  }
}

const VALUE_ACTION = {
  playerId: 'p1', name: 'Kenneth Walker', position: 'RB', team: 'SEA', imageUrl: null, stock: 'up' as const,
  stockDelta: 300, value: 5000, advice: 'Hold.', affectedLeagues: [{ id: 'tips', name: 'L' }],
}

async function analyzedTradeCenter() {
  rosterData.current = {
    rosters: [
      roster('r1', 'You', [player('p1', 'Kenneth Walker', 'RB', 5000, 14.2)]),
      roster('r2', 'Matt Jones', [player('p9', 'Trey McBride', 'TE', 4500, 11.4)]),
    ],
    viewerRosterId: 'r1',
    viewerTeamRosterId: 'r1',
  }
  fetchMock.mockImplementation(async (url: string) =>
    String(url).includes('/api/trade-value/analyze')
      ? { ok: true, status: 200, json: async () => analysis() }
      : { ok: false, status: 500, json: async () => ({}) })
  const view = render(<TradeCenter league={{ id: 'tips', name: 'L', format: 'Dynasty', teamCount: 12 }} valueActions={[VALUE_ACTION]} />)
  fireEvent.click(screen.getByLabelText('Add Kenneth Walker'))
  fireEvent.click([...document.querySelectorAll<HTMLButtonElement>('.af-tc-partner-chip')].find((b) => b.textContent === 'Matt Jones')!)
  fireEvent.click(screen.getByLabelText('Add Trey McBride'))
  await act(async () => {
    fireEvent.click(view.container.querySelector<HTMLButtonElement>('.af-tc-stepbar-primary')!)
  })
  return view
}

describe('Trade Center — a tip on every term that needs one', () => {
  it('the verdict, the /100 score, value balance, league value, roster fit, AF this week, the leans and the value alerts', async () => {
    const { container } = await analyzedTradeCenter()
    expect(container.querySelector('.af-tc-verdict')).not.toBeNull()

    // Each beside the thing it explains.
    expect(tipFor('tradeGrade').closest('.af-tc-verdict-head')).not.toBeNull()
    expect(tipFor('tradeFairnessScore').closest('.af-tc-score')).not.toBeNull()
    expect(tipFor('tradeValueBalance').closest('.af-tc-balance-head')).not.toBeNull()
    expect(tipFor('tradeLeagueValue').closest('.af-tc-moves')).not.toBeNull()
    expect(tipFor('tradeRosterFit').closest('[data-testid="trade-roster-fit"]')).not.toBeNull()
    expect(tipFor('tradeProductionLean').closest('.af-tc-pairs')).not.toBeNull()
    expect(tipFor('tradeValueAlerts').closest('.af-tc-value-actions')).not.toBeNull()

    // Both teams show an AF total; the tip is on the first one only, and the explanatory `title`
    // that used to sit on that row (hover-only, invisible on a phone) is gone.
    const afTotals = container.querySelectorAll('.af-tc-total--af')
    expect(afTotals.length).toBe(2)
    expect(tipFor('tradeAfThisWeek').closest('.af-tc-total--af')).toBe(afTotals[0])
    for (const row of afTotals) expect(row.hasAttribute('title')).toBe(false)
  })

  it('reads Spanish when the app is in Spanish', async () => {
    lang.value = 'es'
    await analyzedTradeCenter()
    tipFor('tradeGrade', 'es')
    tipFor('tradeRosterFit', 'es')
  })
})

/* ── The trade timeline ───────────────────────────────────────────────────────────────────── */

const COMPLETED_GRADE = {
  graded: true, letter: 'B', partnerLetter: 'D', percentDiff: 20, label: 'Slightly favors you', sideAdvantage: 'you',
  action: 'accept', recommendation: 'x', giveValue: 4000, getValue: 5000, giveMarket: 4000, getMarket: 5000,
  basis: 'Dynasty · 12 teams', scoringApplied: true, needApplied: false, needGap: null, moves: [],
  lines: [
    { side: 'give', name: 'Out Guy', marketValue: 4000, leagueValue: 4000 },
    { side: 'get', name: 'In Guy', marketValue: 5000, leagueValue: 5000 },
  ],
  frozenAt: '2026-09-28T16:00:00.000Z',
  current: null,
}

function timelinePanel() {
  return {
    ok: true,
    status: 200,
    data: {
      activeTrades: [],
      historyTrades: [{
        id: 'h1', direction: 'complete', partnerName: 'Partner FC', status: 'completed',
        sent: [{ id: 'a', label: 'Out Guy' }], received: [{ id: 'b', label: 'In Guy' }],
        timestamp: '2026-09-15T12:00:00.000Z', leagueGrade: COMPLETED_GRADE, leagueGradeSide: 'viewer',
      }],
      pending: { scanned: true, reason: null, platform: 'sleeper', leagueUrl: null, weeksUnanswered: 0 },
      pendingOffers: [],
    },
  }
}

describe('Trade timeline', () => {
  it('has one tip beside its heading, and the asset values carry no "League value today" title', async () => {
    fetchTradesPanel.mockResolvedValue(timelinePanel())
    const { container } = render(<TradeInbox view="timeline" leagueId="l1" onLoad={() => {}} />)
    await screen.findByText('In Guy')
    const tip = tipFor('tradeTimeline')
    // Beside the aria-labelledby heading, never inside it.
    expect(tip.closest('h2')).toBeNull()
    expect(tip.closest('.af-tc-timeline-head')).not.toBeNull()
    const values = [...container.querySelectorAll('.af-tc-timeline-assetlist em')]
    expect(values.map((v) => v.textContent).sort()).toEqual(['4,000', '5,000'])
    for (const v of values) expect(v.hasAttribute('title')).toBe(false)
    expect(container.innerHTML).not.toContain('League value today')
  })

  it('no longer says every row has a proposal-time grade — "Then" is today’s where none was saved', async () => {
    fetchTradesPanel.mockResolvedValue(timelinePanel())
    render(<TradeInbox view="timeline" leagueId="l1" onLoad={() => {}} />)
    await screen.findByText('In Guy')
    const head = document.querySelector('.af-tc-timeline-head p')!
    expect(head.textContent).toBe('Where a grade was saved when an offer was made, it stays beside today’s so you can see how the decision aged.')
    expect(coreUiCopy(head.textContent!, 'es')).not.toBe(head.textContent)
  })
})

/* ── The cross-league offer strip ─────────────────────────────────────────────────────────── */

describe('Offers across your leagues', () => {
  const STRIP = 'Yahoo offers are read · Sleeper shows a trade only once it’s accepted · other platforms are not, and say so'
  it('no longer says Sleeper offers are read — Sleeper shares a trade only once it is accepted', () => {
    fetchTradesPanel.mockReturnValue(new Promise(() => {}))
    const { container } = render(<TradeLeagueStrip leagues={[{ id: 'l1', name: 'L', platform: 'sleeper', mark: 'S', meta: null } as never]} activeLeagueId={null} />)
    const note = container.querySelector('.af-tc-strip-note')!.textContent!.trim()
    expect(note).toBe(STRIP)
    expect(container.textContent).not.toContain('Sleeper and Yahoo are read')
  })
  it('in Spanish too', () => {
    lang.value = 'es'
    fetchTradesPanel.mockReturnValue(new Promise(() => {}))
    const { container } = render(<TradeLeagueStrip leagues={[{ id: 'l1', name: 'L', platform: 'sleeper', mark: 'S', meta: null } as never]} activeLeagueId={null} />)
    const es = tradeVisualCopy(STRIP, 'es')
    expect(es).not.toBe(STRIP)
    expect(container.querySelector('.af-tc-strip-note')!.textContent!.trim()).toBe(es)
    expect(container.textContent).not.toContain('Se consultan Sleeper y Yahoo')
  })
})

/* ── The smaller Trade Center panels ──────────────────────────────────────────────────────── */

const GRADE = gradeTrade({ giveValue: 100, getValue: 140, giveMarket: 100, getMarket: 140, unpriced: 0, giveCount: 1, getCount: 1,
  basis: 'Dynasty · Superflex · 12 teams', scoringApplied: false, needApplied: false, needGap: null, moves: [],
  lines: [{ side: 'give', assetKind: 'player', name: 'Josh Allen', marketValue: 100, leagueValue: 100, valueSource: 'fantasycalc', valueAsOf: '2026-10-03' },
    { side: 'get', assetKind: 'player', name: 'Justin Jefferson', marketValue: 140, leagueValue: 140, valueSource: 'fantasycalc', valueAsOf: '2026-10-03' }] })

describe('Partner ranking, Trade Finder and the evidence label', () => {
  it('Best trade partners: a tip beside (not inside) the labelling heading', () => {
    render(<TradePartnerSuggestions ranking={{ gaps: [], partners: [{ rosterId: 'r2', ownerName: 'Matt', rank: 1, score: 72, label: 'Strong fit',
      components: { availability: 1, need: 1, package: 0.5, history: 0 }, reasons: ['Has a spare TE.'], suggestion: null }] }}
      selectedRosterId={null} onChoose={() => {}} onStartWith={() => {}} />)
    const tip = tipFor('tradePartnerFit')
    expect(tip.closest('#af-tc-fits-title')).toBeNull()
    expect(document.getElementById('af-tc-fits-title')!.textContent).toBe('Best trade partners')
  })
  it('Trade Finder', () => {
    render(<TradeFinderPanel leagueId="l1" />)
    tipFor('tradeFinderMatches')
  })
  it('the evidence label', () => {
    if (!GRADE.graded) throw new Error('expected a graded deal')
    render(<TradeEvidencePanel grade={GRADE} evaluatedAt="2026-10-03T12:00:00Z" />)
    tipFor('tradeEvidence')
  })
  it('the league-free analyzer reuses the one trade-grade topic', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ grade: { ...GRADE, lines: [] } }) })
    render(<GenericTradeAnalyzer />)
    fireEvent.change(screen.getByLabelText('Team A sends'), { target: { value: 'Player One' } })
    fireEvent.change(screen.getByLabelText('Team B sends'), { target: { value: 'Player Two' } })
    fireEvent.click(screen.getByRole('button', { name: 'Analyze trade' }))
    await screen.findAllByText('Team A receives more market value')
    tipFor('tradeGrade')
  })
})

/* ── /core Trades history, ideas and grades ───────────────────────────────────────────────── */

function tradesData(over: Partial<TradesData> = {}): TradesData {
  const record = {
    transactionId: 'SL1:tx-1', season: 2026, week: 1, rosterIds: ['1', '2'], yourSide: 'in',
    playersIn: 1, playersOut: 1, picks: 0, partnerTeamName: 'Rivals', at: new Date('2026-09-05T22:16:13Z'),
    players: [
      { manager: 'Your team', isYou: true, received: [{ sleeperId: '1', name: 'Player A', position: 'RB', team: 'ATL' }] },
      { manager: 'Rivals', isYou: false, received: [{ sleeperId: '2', name: 'Player B', position: 'WR', team: 'DET' }] },
    ],
    leagueGrade: { ...COMPLETED_GRADE, lines: [
      { side: 'give', name: 'Player B', marketValue: 2000, leagueValue: 2000 },
      { side: 'get', name: 'Player A', marketValue: 1500, leagueValue: 1500 },
    ] },
  } as unknown as TradeRecord
  return {
    league: { id: 'l1', name: 'League One', platform: 'sleeper' },
    gradingContext: { available: false, reason: 'no grading context' },
    deadline: { available: false, reason: 'not ingested' },
    inbox: { available: true, data: [] }, sent: { available: true, data: [] },
    history: { available: true, data: [record] },
    grades: { available: false, reason: 'no trades on file for this league' },
    canonicalHistory: true,
    agentIdeas: { available: true, data: [{ id: 's1', partnerName: 'Vultures', give: [{ name: 'Drake London', position: 'WR' }],
      get: [{ name: 'Kenneth Walker', position: 'RB' }], letter: 'C', partnerLetter: 'C', percentDiff: 4, viewerFitPct: 7,
      partnerFitPct: 3, basis: 'Dynasty chart', runDate: '2026-09-28' }] },
    ...over,
  } as unknown as TradesData
}

describe('/core Trades', () => {
  it('Completed trades and Trade ideas each get a tip; the per-asset values lose their hover-only title', () => {
    const { container } = render(<Trades data={tradesData()} />)
    expect(tipFor('completedTradeGrade').closest('.af-tr-history-head')).not.toBeNull()
    expect(tipFor('tradeIdeas').closest('.af-tr-ideas')).not.toBeNull()
    const values = [...container.querySelectorAll('em.af-tr-asset-value')]
    expect(values.map((v) => v.textContent)).toEqual(['1,500', '2,000'])
    for (const v of values) expect(v.hasAttribute('title')).toBe(false)
  })
  it('the non-Sleeper "Trade grades" list explains its letter with the one trade-grade topic', () => {
    render(<Trades data={tradesData({ canonicalHistory: false, agentIdeas: undefined,
      grades: { available: true, data: [{ transactionId: 't1', season: 2026, week: 2, letter: 'B', sharePct: 55.6, withheldReason: null,
        receiptId: null, playersIn: 1, playersOut: 1, picksIn: 0, picksOut: 0, breakdown: [] }] } } as never)} />)
    expect(tipFor('tradeGrade').closest('.af-tr-section')).not.toBeNull()
  })
})

/* ── The home's latest-trades band ────────────────────────────────────────────────────────── */

describe('Latest league trades (home)', () => {
  it('explains a completed trade’s grade once, beside its heading', () => {
    const trade = {
      id: 't1', leagueId: 'l1', leagueName: 'League One', leagueAvatarUrl: null, platformLeagueId: 'p1',
      acceptedAt: '2026-10-03T09:00:00Z', partial: false, status: 'processed', gradedAt: '2026-10-02T13:00:00Z',
      sides: [
        { rosterId: 1, managerName: 'A', teamName: 'A', avatarUrl: null, received: [], grade: 'B', gradeBasis: 'League', gradeReason: 'got more' },
        { rosterId: 2, managerName: 'B', teamName: 'B', avatarUrl: null, received: [], grade: 'D', gradeBasis: 'League', gradeReason: 'got less' },
      ],
      verdict: { favoursRosterId: 1, verdict: 'Slightly favors A', confidence: 0 },
    } as unknown as RecentTrade
    const { container } = render(<DashTradeBand trades={[trade]} now={new Date('2026-10-03T12:00:00Z')} />)
    expect(tipFor('completedTradeGrade').closest('.af-trade-head')).not.toBeNull()
    expect(container.querySelector('.af-trade-kicker')!.textContent).toBe('Trades')
  })
})
