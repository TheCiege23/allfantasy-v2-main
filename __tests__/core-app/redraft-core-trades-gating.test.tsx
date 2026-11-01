/**
 * Batch B4 gating: the redraft deadline bar exists ONLY inside a redraft /core shell
 * (`.af-core.af-shell[data-format=redraft]`, stamped by CORE-1), and every other league renders the
 * Trades screen's deadline row exactly as before. Plus the stylesheet's scope, palette and type floor.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import Trades from '@/components/core-app/screens/Trades'
import type { TradeRecord, TradesData } from '@/lib/core-app/trades'

function data(over: Partial<TradesData> = {}): TradesData {
  return {
    league: { id: 'l1', name: 'Sunday Night Redraft', platform: 'sleeper', sourceLink: null },
    gradingContext: { available: false, reason: 'no grading context' },
    history: { available: false, reason: 'no trades' },
    inbox: { available: false, reason: 'not ingested' },
    sent: { available: false, reason: 'not ingested' },
    grades: { available: false, reason: 'nothing priced' },
    deadline: { available: true, data: { week: 12, regularSeasonLength: 14, none: false } },
    deadlineCountdown: { state: 'weeks', deadlineWeek: 12, currentWeek: 9, weeksLeft: 3 },
    ...over,
  }
}

function shell(attrs: Record<string, string>) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <div className="af-core af-shell" {...attrs}>{children}</div>
  }
}
const REDRAFT = shell({ 'data-format': 'redraft', 'data-sport': 'nba' })
const PLAIN = shell({})
const GUILLOTINE = shell({ 'data-format': 'guillotine', 'data-sport': 'nfl' })

const bar = (c: HTMLElement) => c.querySelector('[data-testid=rd-trade-deadline]')
const row = (c: HTMLElement) => c.querySelector('.af-tr-deadline')

describe('Trades deadline — redraft /core shell', () => {
  it('a standalone Trades screen shows the bar, with weeks left and the week it is measured from', () => {
    const { container } = render(<Trades data={data()} />, { wrapper: REDRAFT })
    expect(bar(container)?.getAttribute('data-state')).toBe('open')
    expect(bar(container)?.textContent).toContain('Week 12 · 3 weeks left')
    expect(bar(container)?.textContent).toContain('Week 9 of 12')
    expect(row(container)).toBeNull()
  })

  it.each([
    [{ state: 'weeks', deadlineWeek: 12, currentWeek: 12, weeksLeft: 0 }, 'final', 'last week to trade'],
    [{ state: 'closed', by: 'week', deadlineWeek: 12, closesAtIso: null }, 'passed', 'trades closed'],
    [{ state: 'none' }, 'none', 'No trade deadline'],
  ] as const)('%o → %s', (countdown, state, text) => {
    const { container } = render(<Trades data={data({ deadlineCountdown: countdown as never })} />, { wrapper: REDRAFT })
    expect(bar(container)?.getAttribute('data-state')).toBe(state)
    expect(bar(container)?.textContent).toContain(text)
  })

  it('under the Trade Center (hidePending) the history states no deadline — the Trade Center bar does', () => {
    const { container } = render(<Trades data={data()} hidePending />, { wrapper: REDRAFT })
    expect(bar(container)).toBeNull()
    expect(row(container)).toBeNull()
  })

  it('when the data says nothing, the screen keeps its own sentence (no bar invented, nothing dropped)', () => {
    const d = data({ deadline: { available: false, reason: 'this league’s trade deadline is not ingested' }, deadlineCountdown: null })
    for (const hidePending of [false, true]) {
      const { container, unmount } = render(<Trades data={d} hidePending={hidePending} />, { wrapper: REDRAFT })
      expect(bar(container)).toBeNull()
      expect(row(container)?.textContent).toContain('not ingested')
      unmount()
    }
  })
})

describe('Trades deadline — every other league is unchanged', () => {
  it.each([['no stamp', PLAIN], ['another format', GUILLOTINE]])('%s: the original row, no bar', (_, wrapper) => {
    for (const hidePending of [false, true]) {
      const { container, unmount } = render(<Trades data={data()} hidePending={hidePending} />, { wrapper })
      expect(bar(container)).toBeNull()
      expect(row(container)?.textContent).toContain('Week')
      expect(row(container)?.textContent).toContain('12')
      unmount()
    }
  })
})

describe('Trades grade tones', () => {
  const trade = {
    transactionId: 'l1:t1', season: 2026, week: 7, rosterIds: ['1', '4'], yourSide: 'in', playersIn: 1, playersOut: 1, picks: 0,
    partnerTeamName: 'Ghosts', at: new Date('2026-10-20T00:00:00Z'),
    players: [
      { manager: 'You', isYou: true, received: [{ sleeperId: '1', name: 'A Player', position: 'RB', team: 'SF' }] },
      { manager: 'Ghosts', isYou: false, received: [{ sleeperId: '2', name: 'B Player', position: 'WR', team: 'MIN' }] },
    ],
    leagueGrade: { graded: true, letter: 'B', partnerLetter: 'D', getValue: 10, giveValue: 8, lines: [], moves: [], label: 'Good', basis: 'x' },
  } as unknown as TradeRecord
  it('each side’s letter block carries its tone; the tone is styled only under the redraft root (see the sheet test)', () => {
    const { container } = render(<Trades data={data({ history: { available: true, data: [trade] } })} />, { wrapper: REDRAFT })
    const tones = [...container.querySelectorAll('.af-tr-leaguegrade')].map((el) => [el.getAttribute('data-letter'), el.getAttribute('data-rd-tone')])
    expect(tones).toEqual([['B', 'good'], ['D', 'bad']])
  })
})

/* ── The stylesheet ─────────────────────────────────────────────────────────────────────────────── */

const ROOT = process.cwd()
const SHEET = 'components/core-app/af-core-redraft-trades.css'
const css = readFileSync(join(ROOT, SHEET), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** A selector list split on its TOP-LEVEL commas only — `:is(a, b)` is one selector. */
function splitTopLevel(list: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of list) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) { out.push(cur); cur = '' } else cur += ch
  }
  out.push(cur)
  return out.map((s) => s.trim()).filter(Boolean)
}

/** Every selector of every rule, at any depth, with the at-rule preludes kept apart. */
function rules(src: string): { selectors: string[]; body: string; inMedia: boolean }[] {
  const out: { selectors: string[]; body: string; inMedia: boolean }[] = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  const media = /@media[^{]*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g
  const mediaBodies = [...src.matchAll(media)].map((m) => m[1])
  const top = src.replace(media, '')
  for (const [body, inMedia] of [[top, false], ...mediaBodies.map((b) => [b, true] as const)] as const) {
    for (const m of body.matchAll(re)) out.push({ selectors: splitTopLevel(m[1]), body: m[2], inMedia })
  }
  return out
}

describe(`${SHEET}`, () => {
  const all = rules(css)
  it('parses to a real rule set (a parser that found nothing would pass everything below)', () => {
    expect(all.length).toBeGreaterThan(60)
    expect(all.some((r) => r.inMedia)).toBe(true)
  })
  it('every selector is scoped under the redraft /core shell root', () => {
    const bad = all.flatMap((r) => r.selectors).filter((s) => !s.startsWith('.af-core.af-shell[data-format=redraft]'))
    expect(bad).toEqual([])
  })
  it('holds no colour literal — tokens only', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(css).not.toMatch(/\b(?:rgba?|hsla?)\(/)
  })
  it('nothing under the 11px type floor', () => {
    const sizes = [...css.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g), ...css.matchAll(/font:\s*\d+\s+(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]))
    expect(sizes.length).toBeGreaterThan(3)
    expect(sizes.filter((n) => n < 11)).toEqual([])
  })
  it('exactly one @media block, at top level, at the end — none nested', () => {
    const blocks = css.match(/@media/g) ?? []
    expect(blocks).toHaveLength(1)
    const tail = css.slice(css.indexOf('@media'))
    expect(tail.replace(/@media[^{]*\{/, '').match(/@media/)).toBeNull()
    // Nothing but whitespace after the media block closes.
    expect(tail.trim().endsWith('}')).toBe(true)
    expect(css.slice(0, css.indexOf('@media')).split('{').length).toBe(css.slice(0, css.indexOf('@media')).split('}').length)
  })
  it('is loaded by the screens it styles', () => {
    for (const f of ['components/core-app/RedraftTradeDeadlineBar.tsx', 'components/core-app/screens/Scout.tsx', 'components/core-app/screens/ConnectedFranchiseWarRoom.tsx']) {
      expect(readFileSync(join(ROOT, f), 'utf8'), f).toContain("import '@/components/core-app/af-core-redraft-trades.css'")
    }
  })
  it('the new TSX carries no colour hex', () => {
    for (const f of ['components/core-app/RedraftTradeDeadlineBar.tsx', 'lib/core-app/redraftCoreTrades.ts']) {
      expect(readFileSync(join(ROOT, f), 'utf8'), f).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    }
  })
})
