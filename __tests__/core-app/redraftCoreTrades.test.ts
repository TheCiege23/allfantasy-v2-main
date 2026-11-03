/**
 * Batch B4 (redraft /core Trades + War Room): the pure mappings. Every function returns null when the
 * data does not say, and the screen drops the element — these tests pin both halves.
 */
import { describe, expect, it } from 'vitest'
import { redraftDeadlineBar, redraftGradeTone, redraftShellSportOf } from '@/lib/core-app/redraftCoreTrades'

const week12 = { available: true as const, data: { week: 12, regularSeasonLength: 14, none: false } }

describe('redraftDeadlineBar — from the server verdict', () => {
  it('weeks left: open, with the fill measured from the current week', () => {
    const b = redraftDeadlineBar(week12, { state: 'weeks', deadlineWeek: 12, currentWeek: 9, weeksLeft: 3 })
    expect(b).toEqual({ state: 'open', deadlineWeek: 12, currentWeek: 9, weeksLeft: 3, fillPct: 75, label: 'Week 12 · 3 weeks left' })
  })
  it('one week left is singular', () => {
    expect(redraftDeadlineBar(null, { state: 'weeks', deadlineWeek: 12, currentWeek: 11, weeksLeft: 1 })?.label).toBe('Week 12 · 1 week left')
  })
  it('the deadline week itself is "final", full bar', () => {
    const b = redraftDeadlineBar(null, { state: 'weeks', deadlineWeek: 12, currentWeek: 12, weeksLeft: 0 })
    expect(b?.state).toBe('final')
    expect(b?.fillPct).toBe(100)
    expect(b?.label).toBe('Week 12 · last week to trade')
  })
  it('closed is "passed" and carries no fill', () => {
    const b = redraftDeadlineBar(week12, { state: 'closed', by: 'week', deadlineWeek: 12, closesAtIso: null })
    expect(b?.state).toBe('passed')
    expect(b?.fillPct).toBeNull()
    expect(b?.label).toBe('Passed in Week 12 · trades closed')
  })
  it('no deadline is a real state, not an absence', () => {
    expect(redraftDeadlineBar(week12, { state: 'none' })?.label).toBe('No trade deadline')
  })
  it('scheduled (out of season) names the week without a countdown or a fill', () => {
    const b = redraftDeadlineBar(null, { state: 'scheduled', deadlineWeek: 12, closesAtIso: null })
    expect(b).toMatchObject({ state: 'scheduled', deadlineWeek: 12, currentWeek: null, weeksLeft: null, fillPct: null })
  })
  it('a close time is "counting" — the screen words the live countdown itself', () => {
    const b = redraftDeadlineBar(null, { state: 'counting', closesAtIso: '2026-11-04T17:00:00Z', remainingMs: 1, deadlineWeek: null })
    expect(b).toMatchObject({ state: 'counting', deadlineWeek: null, label: 'Set by close time' })
  })
  it('the verdict wins over the snapshot', () => {
    expect(redraftDeadlineBar({ available: true, data: { week: null, regularSeasonLength: null, none: true } }, { state: 'weeks', deadlineWeek: 10, currentWeek: 4, weeksLeft: 6 })?.state).toBe('open')
  })
  it('a "weeks" verdict without a valid deadline week is dropped, never invented', () => {
    expect(redraftDeadlineBar(null, { state: 'weeks', deadlineWeek: 0, currentWeek: 4, weeksLeft: 6 })).toBeNull()
  })
  it('a fill needs BOTH weeks; a current week past the deadline clamps at 100', () => {
    expect(redraftDeadlineBar(null, { state: 'weeks', deadlineWeek: 12, currentWeek: 0, weeksLeft: 12 })?.fillPct).toBeNull()
    expect(redraftDeadlineBar(null, { state: 'weeks', deadlineWeek: 12, currentWeek: 15, weeksLeft: 0 })?.fillPct).toBe(100)
  })
})

describe('redraftDeadlineBar — snapshot fallback (no verdict read)', () => {
  it('a week from the import snapshot shows as scheduled, without a countdown', () => {
    expect(redraftDeadlineBar(week12, null)).toMatchObject({ state: 'scheduled', deadlineWeek: 12, fillPct: null })
  })
  it('the "trades stay open" sentinel is "No trade deadline"', () => {
    expect(redraftDeadlineBar({ available: true, data: { week: null, regularSeasonLength: 14, none: true } }, undefined)?.state).toBe('none')
  })
  it('nothing ingested and no verdict → null: the screen keeps its own sentence', () => {
    expect(redraftDeadlineBar({ available: false, reason: 'not ingested' }, null)).toBeNull()
    expect(redraftDeadlineBar(null, null)).toBeNull()
    expect(redraftDeadlineBar({ available: true, data: { week: null, regularSeasonLength: null, none: false } }, null)).toBeNull()
  })
})

describe('redraftGradeTone', () => {
  it.each([
    ['A', 'good'], ['B', 'good'], ['b+', 'good'], ['C', 'warn'], ['C-', 'warn'], ['D', 'bad'], ['F', 'bad'],
  ])('%s → %s', (letter, tone) => expect(redraftGradeTone(letter)).toBe(tone))
  it.each([[null], [undefined], [''], ['—'], ['n/a'], ['E'], ['AA'], ['Great deal']])('%s has no tone — a withheld grade is never coloured like a letter', (v) => {
    expect(redraftGradeTone(v as string | null | undefined)).toBeNull()
  })
})

describe('redraftShellSportOf', () => {
  function inside(attrs: Record<string, string>, cls = 'af-core af-shell') {
    const root = document.createElement('div')
    root.className = cls
    for (const [k, v] of Object.entries(attrs)) root.setAttribute(k, v)
    const leaf = document.createElement('span')
    root.appendChild(document.createElement('main')).appendChild(leaf)
    return leaf
  }
  it('reads the sport of the redraft shell around the element', () => {
    expect(redraftShellSportOf(inside({ 'data-format': 'redraft', 'data-sport': 'nhl' }))).toBe('nhl')
  })
  it('null outside a redraft shell, on another format, on the /league workspace, or for an unknown sport', () => {
    expect(redraftShellSportOf(inside({}))).toBeNull()
    expect(redraftShellSportOf(inside({ 'data-format': 'guillotine', 'data-sport': 'nfl' }))).toBeNull()
    expect(redraftShellSportOf(inside({ 'data-format': 'redraft', 'data-sport': 'nfl' }, 'af-core nl-workspace'))).toBeNull()
    expect(redraftShellSportOf(inside({ 'data-format': 'redraft', 'data-sport': 'cricket' }))).toBeNull()
    expect(redraftShellSportOf(null)).toBeNull()
  })
})
