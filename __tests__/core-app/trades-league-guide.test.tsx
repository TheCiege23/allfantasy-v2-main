/**
 * One league's Trades tab guide (2026-11-13): the deadline as the headline, said once; the short league
 * switcher; the extras in one fold under the Analyze button; and completed-trade cards that say the result
 * and fold HOW it was graded.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import { readHistoryNotice, realizedNet, tradesLeagueHeadline } from '@/lib/core-app/tradesLeagueGuide'
import { tradesLeagueGuideMessages } from '@/lib/core-app/messages/tradesLeagueGuide'
import { TradeLeagueSwitchList, SWITCH_LIST_PREVIEW } from '@/components/core-app/screens/TradeCenter'
import Trades from '@/components/core-app/screens/Trades'
import type { TradeRecord, TradesData } from '@/lib/core-app/trades'

afterEach(cleanup)

const SRC = readFileSync(resolve(process.cwd(), 'components/core-app/screens/TradeCenter.tsx'), 'utf8')

describe('tradesLeagueHeadline', () => {
  it('reads every countdown state, and the snapshot week when there is no verdict', () => {
    expect(tradesLeagueHeadline({ state: 'weeks', deadlineWeek: 11, currentWeek: 10, weeksLeft: 1 })).toEqual({ kind: 'weeks', week: 11, weeksLeft: 1 })
    expect(tradesLeagueHeadline({ state: 'counting', closesAtIso: '2026-11-20T00:00:00Z', remainingMs: 1000, deadlineWeek: 11 })).toEqual({ kind: 'counting' })
    expect(tradesLeagueHeadline({ state: 'closed', by: 'week', deadlineWeek: 9, closesAtIso: null })).toEqual({ kind: 'closed', week: 9 })
    expect(tradesLeagueHeadline({ state: 'scheduled', deadlineWeek: 12, closesAtIso: null })).toEqual({ kind: 'scheduled', week: 12 })
    expect(tradesLeagueHeadline({ state: 'none' })).toEqual({ kind: 'open' })
    expect(tradesLeagueHeadline(null, 11)).toEqual({ kind: 'deadline', week: 11 })
    expect(tradesLeagueHeadline(null, null)).toEqual({ kind: 'build' })
  })
})

describe('reading the server sentences back', () => {
  it('takes the time out of the history notice, and leaves any other notice alone', () => {
    expect(readHistoryNotice('Trade history checked with Sleeper. Grades updated 2026-11-14T04:17:38.300Z.')).toEqual({
      refreshed: false,
      updatedAt: '2026-11-14T04:17:38.300Z',
    })
    expect(readHistoryNotice('Trade history checked with Sleeper and refreshed. Grades updated 2026-11-14T04:17:38.300Z.')?.refreshed).toBe(true)
    expect(readHistoryNotice('Sleeper trade refresh is incomplete. Showing the last available grades; refresh to check for newer trades.')).toBeNull()
    expect(readHistoryNotice('Trade history checked with Sleeper. Grades updated not-a-date.')).toBeNull()
    expect(readHistoryNotice(null)).toBeNull()
  })

  it('reads the realized net, and nothing from another note', () => {
    expect(realizedNet("Realized under this league's scoring: net 113.9 fantasy points while the assets were held. This result grade does not claim a team-needs or playoff-probability adjustment.")).toBe(113.9)
    expect(realizedNet("Realized under this league's scoring: net -42.4 fantasy points while the assets were held. This …")).toBe(-42.4)
    expect(realizedNet('net -5.6 fantasy points while the assets were held.')).toBeNull()
  })
})

describe('copy', () => {
  const en = tradesLeagueGuideMessages.en
  it('says the deadline in plain words', () => {
    expect(en.headWeeks(11, 1)).toBe('Trade deadline after week 11 — 1 week left')
    expect(en.headWeeks(11, 3)).toBe('Trade deadline after week 11 — 3 weeks left')
    expect(en.headWeeks(11, 0)).toBe('Last week to trade — the deadline is week 11')
    expect(en.headClosed(9)).toBe('Trades are closed — the deadline was week 9')
    expect(en.intro('Sleeper')).toBe('Add what you send and what you get, and we’ll grade it on this league’s scoring. Then send it in Sleeper.')
  })

  it('has Spanish for every key and never says «waiver»', () => {
    const es = tradesLeagueGuideMessages.es!
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort())
    expect(es.headWeeks(11, 1)).toBe('Fecha límite tras la semana 11: queda 1 semana')
    const text = JSON.stringify(Object.values(es).map((v) => (typeof v === 'function' ? String(v) : v)))
    expect(text.toLowerCase()).not.toMatch(/waiver/)
  })
})

describe('the Trade Center page order', () => {
  it('leads with the deadline headline, and the extras fold under the Analyze button', () => {
    expect(SRC).toContain('title={headlineText}')
    expect(SRC).not.toContain("title={copy('Trade Center')}")
    const actions = SRC.indexOf('<div className="af-tc-actions">')
    const more = SRC.indexOf('className="af-tc-fold af-tlg-more"')
    const ideas = SRC.indexOf('className="af-tc-fold af-tc-ideas"')
    const offers = SRC.indexOf('className="af-tc-fold af-tc-offers"')
    const finder = SRC.indexOf('id="trade-finder"')
    const panel = SRC.indexOf('<TradeCenterPanel')
    expect(actions).toBeGreaterThan(0)
    expect(actions).toBeLessThan(more)
    for (const inside of [ideas, offers, finder]) {
      expect(inside).toBeGreaterThan(more)
      expect(inside).toBeLessThan(panel)
    }
  })
})

const LEAGUES = Array.from({ length: 15 }, (_, i) => ({ id: `l${i}`, name: `League ${i}`, platform: 'sleeper', mark: 'S', meta: 'NFL · 12 teams' }))

describe('TradeLeagueSwitchList', () => {
  it('one line per league, the current one marked, the rest behind "Show all"', () => {
    render(<TradeLeagueSwitchList leagues={LEAGUES} activeLeagueId="l1" />)
    expect(document.querySelectorAll('.af-tlg-switch-row')).toHaveLength(SWITCH_LIST_PREVIEW)
    expect(document.querySelector('[aria-current="page"]')?.textContent).toContain('League 1')
    expect(document.body.textContent).not.toMatch(/None visible|No recent offer|Check source offers|Deadline ·/)
    fireEvent.click(screen.getByRole('button', { name: 'Show all 15 leagues' }))
    expect(document.querySelectorAll('.af-tlg-switch-row')).toHaveLength(15)
  })
})

const NOTE_IN = "Realized under this league's scoring: net 113.9 fantasy points while the assets were held. This result grade does not claim a team-needs or playoff-probability adjustment."
const trade: TradeRecord = {
  transactionId: 'sleeper:tx-9',
  season: 2026,
  week: 1,
  rosterIds: ['1', '2'],
  yourSide: 'in',
  playersIn: 1,
  playersOut: 0,
  picks: 0,
  partnerTeamName: 'coleth2408',
  at: new Date('2026-09-10T12:00:00Z'),
  players: [
    { manager: 'Me', isYou: true, received: [{ sleeperId: '1', name: 'Deshaun Watson', position: 'QB', team: 'CLE' }], grade: 'A', gradeBasis: 'Realized', gradeNote: NOTE_IN },
    { manager: 'coleth2408', isYou: false, received: [], picks: ['$10 FAAB'], grade: 'F', gradeBasis: 'Realized', gradeNote: NOTE_IN.replace('113.9', '-113.9') },
  ],
} as unknown as TradeRecord

const data = (over: Partial<TradesData> = {}): TradesData =>
  ({
    league: { id: 'l1', name: 'Guillotine League 26', platform: 'sleeper', sourceLink: null },
    gradingContext: { available: true, data: { leagueName: 'Guillotine League 26', format: 'guillotine', teamCount: 18 } },
    canonicalHistory: true,
    history: { available: true, data: [trade] },
    historyNotice: 'Trade history checked with Sleeper. Grades updated 2026-11-14T04:17:38.300Z.',
    inbox: { available: false, reason: 'n/a' },
    sent: { available: false, reason: 'n/a' },
    grades: { available: false, reason: 'n/a' },
    deadline: { available: true, data: { week: 11, regularSeasonLength: 14, none: false } },
    agentIdeas: { available: false, reason: 'No trade last night was near-even and good for both rosters.' },
    ...over,
  }) as TradesData

describe('Trades under the Trade Center', () => {
  it('says the deadline, the grading note and an empty ideas card nowhere; the notice has no raw timestamp', () => {
    render(<Trades data={data()} hidePending />)
    const text = document.body.textContent ?? ''
    for (const gone of ['Scored for this league only', 'Trade deadline', 'No trade last night', 'Trade ideas', '2026-11-14T04:17:38.300Z']) {
      expect(text).not.toContain(gone)
    }
    expect(text).toContain('Trade history checked with Sleeper · grades updated')
  })

  it('keeps all of it on the standalone screen', () => {
    render(<Trades data={data()} />)
    const text = document.body.textContent ?? ''
    expect(text).toContain('Scored for this league only')
    expect(text).toContain('Trade ideas')
  })

  it('a card says the realized number, and folds the caveat', () => {
    render(<Trades data={data()} hidePending />)
    const text = () => document.body.textContent ?? ''
    expect(text()).toContain('Realized · +113.9 pts while held')
    expect(text()).toContain('Realized · −113.9 pts while held')
    expect(text()).not.toContain('does not claim a team-needs')
    const toggle = screen.getByRole('button', { name: 'How these were graded' })
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(text()).toContain('doesn’t adjust for team needs or playoff odds')
  })
})
