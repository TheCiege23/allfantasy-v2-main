/**
 * The league page's "This week" strip (components/decide/ThisWeekStrip, 2026-10-06): the four clocks a
 * fantasy week runs on — your matchup, lineup lock, the next waiver run and the trade deadline.
 *
 * What is pinned here, and why:
 *   - each tile says the real thing in BOTH languages, and Spanish says none of it in English;
 *   - 🛑 a tile with nothing true to say is NOT rendered, and with no tile the strip is gone — the
 *     strip exists to stop the page opening on blanks, so a blank tile would defeat it;
 *   - a tile opens the tab that owns its number;
 *   - the strip and Matchup Center make ONE matchup request between them (the route reads Sleeper);
 *   - the lineup tile refuses a failed sync or a prior-season roster, whose zero counts would read
 *     as "Lineup set".
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'

import { translations } from '@/lib/i18n/translations'
import { lineupFrom } from '@/lib/core-app/leagueThisWeek'

const h = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations: dict } = await import('@/lib/i18n/translations')
  const t = (k: string) => dict[h.language]?.[k] ?? dict.en[k] ?? k
  return { useLanguage: () => ({ language: h.language, t, setLanguage: () => {} }), useOptionalLanguage: () => ({ language: h.language, t }) }
})

import { ThisWeekStrip, countdown } from '@/components/decide/ThisWeekStrip'
import { MatchupCenter } from '@/components/decide/MatchupCenter'

const NOW = Date.parse('2026-10-07T12:00:00Z')
const side = (ownerId: string, projected: number | null, actual = 0) => ({
  rosterId: 1, ownerId, name: ownerId === 'me' ? 'Me' : 'Rival', teamName: ownerId === 'me' ? 'Mine' : 'The Rivals', avatar: null,
  actualPoints: actual, projectedPoints: projected, unprojectedStarters: 0,
})

type Bodies = { thisWeek?: unknown; matchup?: unknown; intel?: unknown }
const FULL: Bodies = {
  thisWeek: {
    lineup: { week: 5, lockAt: new Date(NOW + 5 * 3_600_000).toISOString(), locked: false, automatic: false, starters: 9, toFix: 1, questionable: 2, unresolved: 0 },
    waivers: { schedule: { dayOfWeek: null, time: '03:00', timeZone: 'America/Los_Angeles' }, observed: true },
    tradeDeadline: { at: null, week: 10 },
  },
  matchup: { supported: true, viewerSleeperUserId: 'me', center: { version: 1, fetchedAt: '', season: '2026', week: 5, inSeason: true, anyPointsScored: false, model: 'M', missing: [],
    matchups: [{ matchupId: 1, a: side('me', 140.5), b: side('them', 120), winProbA: 66 }] } },
  intel: { supported: true, intel: { budget: 100, targets: [
    { playerId: '1', name: 'Hurt Guy', position: 'RB', team: 'X', marketValue: 1, fillsSlots: [], suggestedBid: 30, reasoning: [], unavailable: { kind: 'ruled_out', status: 'Out' } },
    { playerId: '2', name: 'Pick Up', position: 'WR', team: 'Y', marketValue: 1, fillsSlots: [], suggestedBid: 12, reasoning: [] },
  ] } },
}

let calls: string[] = []
function stubFetch(b: Bodies) {
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url)
    calls.push(u)
    const body = u.includes('this-week') ? b.thisWeek : u.includes('matchup-center') ? b.matchup : u.includes('waiver-intel') ? b.intel : {}
    return { ok: body !== undefined, status: body === undefined ? 500 : 200, json: async () => body ?? {} }
  }))
}

/** Every league id is new, because the matchup and waiver requests are shared per league for a minute. */
let n = 0
const lid = () => `L-${++n}`

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  h.language = 'en'
  vi.useRealTimers()
  vi.unstubAllGlobals()
  cleanup()
})

describe('every key the strip names exists in both languages', () => {
  it('🛑 read from the file, with matching placeholders', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const src = readFileSync(resolve(__dirname, '..', 'components/decide/ThisWeekStrip.tsx'), 'utf8')
    const keys = [...new Set([...src.matchAll(/['"`](decide\.week\.[A-Za-z0-9_.-]+)['"`]/g)].map((m) => m[1]!))]
    expect(keys.length).toBeGreaterThanOrEqual(25)
    expect(keys.filter((k) => !translations.en[k] || !translations.es[k])).toEqual([])
    const ph = (s: string) => (s.match(/\{\{\w+\}\}/g) ?? []).sort().join()
    expect(keys.filter((k) => ph(translations.en[k]!) !== ph(translations.es[k]!))).toEqual([])
  })
})

describe('the four tiles', () => {
  it('English: matchup, lineup lock, waiver run with the best AVAILABLE add, and the deadline in weeks', async () => {
    stubFetch(FULL)
    const r = render(<ThisWeekStrip leagueId={lid()} onOpenTab={() => {}} />)
    await r.findByTestId('this-week-waivers')
    await waitFor(() => expect(r.getByTestId('this-week-waivers').textContent).toContain('Top add'))
    expect(r.getByTestId('this-week-strip').textContent).toContain('week 5 · the clocks that matter')
    expect(r.getByTestId('this-week-matchup').textContent).toBe('Your matchupvs The RivalsProjected 140.5–120.066% to win')
    expect(r.getByTestId('this-week-lineup').textContent).toMatch(/^Lineup lock.+in 5h 00m1 starter to fix2 questionable$/)
    // The ruled-out player is skipped; the first one who can actually be added is named.
    expect(r.getByTestId('this-week-waivers').textContent).toMatch(/^Waivers run.+in \d+h \d\dm(Top add: Pick Up · bid \$12)$/)
    expect(r.getByTestId('this-week-trade').textContent).toBe('Trade deadlineWeek 105 weeks left')
    expect(r.getByTestId('this-week-lineup').className).toContain('t-warn')
  })

  it('🛑 Spanish says all of it in Spanish', async () => {
    h.language = 'es'
    stubFetch(FULL)
    const r = render(<ThisWeekStrip leagueId={lid()} onOpenTab={() => {}} />)
    await waitFor(() => expect(r.getByTestId('this-week-waivers').textContent).toContain('Mejor agente libre'))
    const text = r.getByTestId('this-week-strip').textContent ?? ''
    for (const s of ['Esta semana', 'semana 5 · los plazos que importan', 'Tu enfrentamiento', 'vs. The Rivals', 'Proyección 140.5–120.0',
      '66% de ganar', 'Cierre de alineación', 'en 5h 00m', '1 titular por corregir', '2 en duda', 'Procesamiento de reclamos',
      'Mejor agente libre: Pick Up · oferta de $12', 'Fecha límite de trades', 'Semana 10', 'Quedan 5 semanas']) {
      expect(text, s).toContain(s)
    }
    const english = ['This week', 'Your matchup', 'Projected', 'to win', 'Lineup', 'starter', 'questionable', 'Waivers', 'Top add', 'bid',
      'Trade deadline', 'Week', 'weeks left', 'the clocks', ' in ']
    expect(english.filter((w) => text.includes(w))).toEqual([])
    expect(r.getByTestId('this-week-strip').getAttribute('aria-label')).toBe('Esta semana')
    expect(text).not.toMatch(/waiver/i)
  })

  it('live scores replace the projection once points are on the board; a losing side reads as a warning', async () => {
    stubFetch({ ...FULL, matchup: { supported: true, viewerSleeperUserId: 'me', center: { week: 5, anyPointsScored: true, model: 'M', missing: [],
      matchups: [{ matchupId: 1, a: side('them', 130, 61.2), b: side('me', 110, 48), winProbA: 71 }] } } })
    const r = render(<ThisWeekStrip leagueId={lid()} onOpenTab={() => {}} />)
    const tile = await r.findByTestId('this-week-matchup')
    expect(tile.textContent).toBe('Your matchupvs The RivalsLive 48.0–61.229% to win')
    expect(tile.className).toContain('t-warn')
  })

  it('lineup states: set, locked, automatic — and a passed lock is not a countdown', async () => {
    const lineup = (x: object) => ({ ...FULL, thisWeek: { ...(FULL.thisWeek as object), lineup: { week: 5, lockAt: new Date(NOW + 26 * 3_600_000).toISOString(), locked: false, automatic: false, starters: 9, toFix: 0, questionable: 0, unresolved: 0, ...x } } })
    stubFetch(lineup({}))
    let r = render(<ThisWeekStrip leagueId={lid()} onOpenTab={() => {}} />)
    expect((await r.findByTestId('this-week-lineup')).textContent).toMatch(/in 1d 2hLineup set$/)
    expect(r.getByTestId('this-week-lineup').className).toContain('t-ok')
    cleanup()
    stubFetch(lineup({ locked: true }))
    r = render(<ThisWeekStrip leagueId={lid()} onOpenTab={() => {}} />)
    expect((await r.findByTestId('this-week-lineup')).textContent).toBe('Lineup lockLockedYour games are under way')
    cleanup()
    stubFetch(lineup({ automatic: true }))
    r = render(<ThisWeekStrip leagueId={lid()} onOpenTab={() => {}} />)
    expect((await r.findByTestId('this-week-lineup')).textContent).toBe('Lineup lockAutomaticThis league sets lineups for you')
    cleanup()
    stubFetch(lineup({ lockAt: new Date(NOW - 60_000).toISOString() }))
    r = render(<ThisWeekStrip leagueId={lid()} onOpenTab={() => {}} />)
    await r.findByTestId('this-week-matchup')
    expect(r.queryByTestId('this-week-lineup')).toBeNull()
  })

  it('trade deadline: a dated one counts down; this week warns; a passed week is gone', async () => {
    const td = (x: object) => ({ ...FULL, thisWeek: { ...(FULL.thisWeek as object), tradeDeadline: x } })
    stubFetch(td({ at: new Date(NOW + 3 * 86_400_000).toISOString(), week: null }))
    let r = render(<ThisWeekStrip leagueId={lid()} onOpenTab={() => {}} />)
    const tile = await r.findByTestId('this-week-trade')
    expect(tile.textContent).toMatch(/in 3d 0h$/)
    expect(tile.className).toContain('t-warn')
    cleanup()
    stubFetch(td({ at: null, week: 5 }))
    r = render(<ThisWeekStrip leagueId={lid()} onOpenTab={() => {}} />)
    expect((await r.findByTestId('this-week-trade')).textContent).toBe('Trade deadlineWeek 5This week')
    cleanup()
    stubFetch(td({ at: null, week: 4 }))
    r = render(<ThisWeekStrip leagueId={lid()} onOpenTab={() => {}} />)
    await r.findByTestId('this-week-matchup')
    expect(r.queryByTestId('this-week-trade')).toBeNull()
  })

  it('a tile opens the tab that owns its number', async () => {
    stubFetch(FULL)
    const open = vi.fn()
    const r = render(<ThisWeekStrip leagueId={lid()} onOpenTab={open} />)
    await r.findByTestId('this-week-trade')
    for (const [tile, tab] of [['matchup', 'matchups'], ['lineup', 'roster'], ['waivers', 'waivers'], ['trade', 'trades']]) {
      fireEvent.click(r.getByTestId(`this-week-${tile}`))
      expect(open).toHaveBeenLastCalledWith(tab)
    }
  })
})

describe('🛑 nothing true to say → nothing rendered', () => {
  it('no matchup, no lineup, no schedule, no deadline: the strip is gone, not four blanks', async () => {
    stubFetch({ thisWeek: { lineup: null, waivers: null, tradeDeadline: null }, matchup: { supported: false, platform: 'espn' }, intel: { supported: false, platform: 'espn' } })
    const r = render(<ThisWeekStrip leagueId={lid()} onOpenTab={() => {}} />)
    await waitFor(() => expect(calls.some((u) => u.includes('this-week'))).toBe(true))
    await waitFor(() => expect(r.queryByTestId('this-week-strip')).toBeNull())
    expect(r.container.textContent).toBe('')
  })

  it('a failed route drops only its own tiles — the matchup still shows', async () => {
    stubFetch({ ...FULL, thisWeek: undefined })
    const r = render(<ThisWeekStrip leagueId={lid()} onOpenTab={() => {}} />)
    await r.findByTestId('this-week-matchup')
    expect(r.queryByTestId('this-week-lineup')).toBeNull()
    expect(r.queryByTestId('this-week-waivers')).toBeNull()
    expect(r.queryByTestId('this-week-trade')).toBeNull()
  })
})

describe('one matchup request between the strip and Matchup Center', () => {
  it('both render from a single /api/league/matchup-center call', async () => {
    stubFetch(FULL)
    const id = lid()
    const r = render(<><ThisWeekStrip leagueId={id} onOpenTab={() => {}} /><MatchupCenter leagueId={id} /></>)
    await r.findByTestId('this-week-matchup')
    await r.findByTestId('matchup-center')
    expect(calls.filter((u) => u.includes('matchup-center'))).toHaveLength(1)
  })
})

describe('the lineup tile only takes a row the My Team board would vouch for', () => {
  const row = { leagueId: 'L', archived: false, syncFailed: false, automatic: false, bestBall: false, week: 5, lockAt: 'x', locked: false,
    starters: 9, empty: 1, out: 2, questionable: 3, unresolved: 0 } as never
  it('empty + out is what needs fixing; best ball counts as automatic', () => {
    expect(lineupFrom(row)).toMatchObject({ toFix: 3, questionable: 3, automatic: false })
    expect(lineupFrom({ ...(row as object), bestBall: true } as never)?.automatic).toBe(true)
  })
  it('🛑 a failed sync or a prior-season roster is no tile — its zeros would read "Lineup set"', () => {
    expect(lineupFrom({ ...(row as object), syncFailed: true } as never)).toBeNull()
    expect(lineupFrom({ ...(row as object), archived: true } as never)).toBeNull()
    expect(lineupFrom(undefined)).toBeNull()
  })
})

describe('countdown', () => {
  it('is coarse, and never negative', () => {
    expect(countdown(12 * 60_000)).toBe('12m')
    expect(countdown(14 * 3_600_000 + 5 * 60_000)).toBe('14h 05m')
    expect(countdown(3 * 86_400_000 + 2 * 3_600_000)).toBe('3d 2h')
    expect(countdown(-5)).toBe('0m')
  })
})
