/**
 * Rival records with a tie render W–L–T on the dashboard and on League Home (2026-10-03).
 *
 * The loader half is `rival-record-ties.test.ts`. This half pins what a reader
 * sees: a record with ties grows a third number, a record without ties reads
 * exactly as before, and a tied last meeting reads "a tie" / "empate" on the
 * bilingual League Home. Same conventions as Rivalry Radar (#1998).
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { RivalRow } from '@/lib/core-app/dash3aPanels'
import type { LeagueHomeData } from '@/lib/core-app/leagueHome'

const lang = vi.hoisted(() => ({ language: 'en' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useOptionalLanguage: () => ({ language: lang.language }),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ prefetch() {}, push() {}, replace() {}, refresh() {} }),
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams('league=lg-1'),
}))

import { Dash3ARivals } from '@/components/core-app/screens/Dashboard3A'
import { LeagueHome } from '@/components/core-app/screens/LeagueHome'

afterEach(() => {
  cleanup()
  lang.language = 'en'
})

const tied: RivalRow = {
  key: 'mixed',
  name: 'Mixed',
  wins: 1,
  losses: 1,
  ties: 1,
  meetings: 3,
  sharedLeagues: 1,
  lastResult: 'a tie',
  lastParts: { kind: 'tie', margin: 0 },
}
// `lastParts` is what getRivalRecords writes beside the English (dash3aPanels.ts) — the screen builds
// the Spanish from it.
const untied: RivalRow = {
  key: 'beater',
  name: 'Beater',
  wins: 0,
  losses: 1,
  ties: 0,
  meetings: 1,
  sharedLeagues: 1,
  lastResult: 'beat you by 10.0',
  lastParts: { kind: 'lost', margin: 10 },
}

const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ')

describe('dashboard rivalry radar', () => {
  function rivals() {
    const root = render(<Dash3ARivals rivals={{ available: true, data: { rows: [tied, untied], leaguesRead: 1 } }} />)
      .container
    return Array.from(root.querySelectorAll('.af3a-rival'))
  }

  it('shows W–L–T when a meeting finished level', () => {
    const [mixed] = rivals()
    expect(text(mixed.querySelector('.af3a-mono'))).toBe('1–1–1')
    expect(text(mixed)).toContain('3 meetings')
    expect(text(mixed)).toContain('last: a tie')
  })

  it('a series without ties reads W–L exactly as before', () => {
    const [, beater] = rivals()
    expect(text(beater.querySelector('.af3a-mono'))).toBe('0–1')
  })
})

describe('League Home rivalry radar', () => {
  const off = { available: false as const, reason: 'not in this fixture' }
  function page(): LeagueHomeData {
    return {
      pairing: null,
      league: {
        id: 'lg-1',
        name: 'Kings of Buffalo',
        platform: 'sleeper',
        format: 'Dynasty · Half PPR',
        sport: 'NFL',
        season: 2026,
        currentWeek: 4,
      },
      importCoverage: {
        capabilities: { rosters: true, scoring: true, matchups: true, standings: true, draft: true, trades: true, history: true },
        missing: [],
        partial: [],
        sentence: '',
        hasGaps: false,
      },
      yourTeam: off,
      stage: null,
      preSeason: false,
      weekPicker: { weeks: [1, 2, 3, 4], selected: 4, current: 4, isFuture: false },
      standings: off,
      timeline: off,
      matchup: off,
      draftHq: off,
      commissioner: off,
      buzz: off,
      scoreboard: off,
      powerBoard: off,
      rivalry: {
        available: true,
        data: [tied, untied].map(({ sharedLeagues: _s, ...r }) => r),
      },
      syncAge: { label: '3m ago', stale: false },
    } as unknown as LeagueHomeData
  }
  function rivals() {
    const root = render(<LeagueHome data={page()} otherLeagueIssueCount={0} identityInShell />).container
    return Array.from(root.querySelectorAll('.af-lh-rival'))
  }

  it('shows W–L–T and "a tie" in English', () => {
    const [mixed, beater] = rivals()
    expect(text(mixed.querySelector(':scope > b'))).toBe('1–1–1')
    expect(text(mixed)).toContain('last: a tie')
    expect(text(beater.querySelector(':scope > b'))).toBe('0–1')
  })

  it('shows W–L–T and "empate" in Spanish', () => {
    lang.language = 'es'
    const [mixed, beater] = rivals()
    expect(text(mixed.querySelector(':scope > b'))).toBe('1–1–1')
    expect(text(mixed)).toContain('3 encuentros')
    expect(text(mixed)).toContain('último: empate')
    expect(text(beater.querySelector(':scope > b'))).toBe('0–1')
  })

  it('the last meeting’s margin reads Spanish too — «te ganó por 10.0», never «beat you by»', () => {
    lang.language = 'es'
    const [, beater] = rivals()
    expect(text(beater)).toContain('último: te ganó por 10.0')
    expect(text(beater)).not.toMatch(/beat you by|you won by/)
    lang.language = 'en'
    const [, beaterEn] = rivals()
    expect(text(beaterEn)).toContain('last: beat you by 10.0')
  })
})

/*
 * The loader rebuilds each rival row field by field before it reaches the screen. A field left out
 * there vanishes with no error — `lastParts` was, so the margin above could never be translated.
 */
describe('League Home loader — leagueRivalRows', () => {
  it('carries every field the screen reads, lastParts included', async () => {
    const { leagueRivalRows } = await import('@/lib/core-app/leagueHome')
    const out = leagueRivalRows([tied, untied])
    expect(out[1]).toEqual({
      key: 'beater', name: 'Beater', wins: 0, losses: 1, ties: 0, meetings: 1,
      lastResult: 'beat you by 10.0', lastParts: { kind: 'lost', margin: 10 },
    })
    expect(out[0]!.lastParts).toEqual({ kind: 'tie', margin: 0 })
  })
})
