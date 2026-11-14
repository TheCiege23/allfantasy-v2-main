// @vitest-environment jsdom
/**
 * The /core/career guide (2026-11-14): the page opens on what the career adds up to, then what you have
 * won, then this season, then the detail — each fact said once.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...(rest as Record<string, string>)}>
      {children}
    </a>
  ),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {} }),
  usePathname: () => '/core/career',
  useSearchParams: () => new URLSearchParams(),
}))

import { Career } from '@/components/core-app/screens/Career'
import { SurvivalFold } from '@/components/core-app/career/CareerGuide'
import { careerHeadline, survivalSummary } from '@/lib/core-app/careerGuide'
import { careerGuideMessages } from '@/lib/core-app/messages/careerGuide'
import { buildCareerData, type CareerRow } from '@/lib/core-app/careerModel'
import type { CareerScreenData } from '@/lib/core-app/careerScreen'
import { row } from './careerFixtures'

afterEach(cleanup)

const en = careerGuideMessages.en

describe('careerHeadline', () => {
  const base = { isEmpty: false, accountIsEmpty: false, championships: 0, playoffAppearances: 0, winRate: null, firstSeason: 2020 }
  it('titles first, then playoff trips, then the win rate', () => {
    expect(careerHeadline({ ...base, championships: 13, playoffAppearances: 167 })).toEqual({ kind: 'titles', titles: 13, playoffs: 167, since: 2020 })
    expect(careerHeadline({ ...base, playoffAppearances: 5 })).toEqual({ kind: 'playoffs', playoffs: 5, since: 2020 })
    expect(careerHeadline({ ...base, winRate: 0.441 })).toEqual({ kind: 'record', winPct: 44, since: 2020 })
  })
  it('an empty account and a filter that matches nothing say different things', () => {
    expect(careerHeadline({ ...base, isEmpty: true, accountIsEmpty: true })).toEqual({ kind: 'empty' })
    expect(careerHeadline({ ...base, isEmpty: true })).toEqual({ kind: 'filtered' })
  })
  it('in plain words, one and many', () => {
    expect(en.headTitles(13, '13', 167, '167', 2020)).toBe('13 titles and 167 playoff trips since 2020')
    expect(en.headTitles(1, '1', 0, '0', 2023)).toBe('1 title since 2023')
    expect(en.headPlayoffs(1, '1', 2022)).toBe('No titles yet — 1 playoff trip since 2022')
    expect(en.headRecord(44, 2020)).toBe('No titles yet — 44% of games won since 2020')
  })
  it('has Spanish for every key and never says «waiver»', () => {
    const es = careerGuideMessages.es!
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort())
    expect(es.headTitles(13, '13', 167, '167', 2020)).toBe('13 títulos y 167 presencias en playoffs desde 2020')
    const text = JSON.stringify(Object.values(es).map((v) => (typeof v === 'function' ? String(v) : v)))
    expect(text.toLowerCase()).not.toMatch(/waiver/)
  })
})

describe('survival scores, folded', () => {
  const results = [
    { key: 'a', season: 2025, leagueName: 'A', format: 'guillotine' as const, survival: null, score: 76.5 },
    { key: 'b', season: 2025, leagueName: 'B', format: 'guillotine' as const, survival: null, score: 100 },
    { key: 'c', season: 2023, leagueName: 'C', format: 'survivor' as const, survival: null, score: null },
  ]
  it('one line over the table, closed', () => {
    expect(survivalSummary(results)).toEqual({ seasons: 3, best: 100 })
    expect(survivalSummary([])).toBeNull()
    render(
      <SurvivalFold results={results}>
        <table />
      </SurvivalFold>,
    )
    const fold = screen.getByTestId('career-survival') as HTMLDetailsElement
    expect(fold.open).toBe(false)
    expect(fold.querySelector('summary')?.textContent).toBe('Survival scores3 elimination seasons · best 100.0')
  })
})

const rows: CareerRow[] = [
  row({ season: 2022, wins: 7, losses: 7 }),
  row({ season: 2023, wins: 10, losses: 4, madePlayoffs: true, isChampion: true }),
  row({ season: 2024, wins: 6, losses: 8, leagueName: 'Sunday Night Redraft' }),
]
const screenData = (): CareerScreenData => ({
  view: 'overview',
  data: buildCareerData({ identity: { handle: 'guap', avatarUrl: null, xpTotal: 12_000 }, rows, platforms: ['sleeper'], rosterless: 0 }),
  awards: [],
  trades: [],
  profile: { builtAt: null, origin: 'built' },
  timeline: null,
  records: null,
  peers: null,
  coverage: null,
})

describe('the desktop overview', () => {
  it('opens on the headline; won, then this season, then the detail', () => {
    render(<Career screen={screenData()} />)
    const page = document.querySelector(".af-c13[data-view='overview']") as HTMLElement
    const h1 = page.querySelector('h1')
    expect(h1?.textContent).toBe('1 title and 1 playoff trip since 2022')
    expect(page.querySelector('[data-testid="career-head"]')?.textContent).toContain('@guap')
    const won = page.querySelector('.af-crx-acc') as HTMLElement
    const season = page.querySelector('[data-testid="career-this-season"]') as HTMLElement
    const detail = page.querySelector('.af-c13-body') as HTMLElement
    expect(won && season && detail).toBeTruthy()
    const before = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(before(h1!, won)).toBe(true)
    expect(before(won, season)).toBe(true)
    expect(before(season, detail)).toBe(true)
  })

  it('says each thing once: one share button up top, one XP line, no placeholders', () => {
    render(<Career screen={screenData()} />)
    const page = document.querySelector(".af-c13[data-view='overview']") as HTMLElement
    const nav = page.querySelector('.af-crx-navrow') as HTMLElement
    expect([...nav.querySelectorAll('a')].filter((a) => /Share/.test(a.textContent ?? '')).map((a) => a.textContent)).toEqual(['Share card'])
    const text = page.textContent ?? ''
    for (const gone of ['READ-ONLY', 'TRUSTED · NOT SCORED', 'Reputation', 'Career XP', 'league-seasons of history']) {
      expect(text).not.toContain(gone)
    }
    expect(page.querySelector('.af-c13-banner')).toBeNull()
  })

  it('the phone header says the same headline', () => {
    render(<Career screen={screenData()} />)
    expect(document.querySelector('.af-crm h1')?.textContent).toBe('1 title and 1 playoff trip since 2022')
    expect(document.querySelector('.af-crm .af-cg-mwho')?.textContent).toContain('@guap')
  })
})
