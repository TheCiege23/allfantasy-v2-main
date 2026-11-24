// @vitest-environment jsdom
/**
 * Tournament after the 2026-11-24 visual audit (DB-free harness at /e2e/tournament/e2e-tournament/*):
 * 1. Drafts called every Opening Round draft "SCHEDULED · TBD" in week 6, said "You draft —" on leagues you are not
 *    in, and "90s clock · 90s".
 * 2. Commissioner: the draft-time box labelled "local" showed UTC (8:00 PM ET read 12:00 AM the next day); the
 *    harness numbered rounds from 1 where real rounds start at 0.
 * 3. Home gave three ranks (Conf. rank 3, 1st in the conference race, "#1 of 32"), said bubble and the round over and
 *    over.
 * 4. Home filler: a "Draft / Matchup" card mid-round, an empty league banner, a caption about markers never drawn.
 * 5. Progress: "32 › 0 › 0 › ?", raw "opening"/"elite"/"active", round 3 off-screen on a phone, no "You".
 * 6. Standings: no column headings, an "Mv" column that was always "—".
 * 7. History: the same placeholder under every round, the year twice, raw status codes.
 * 8. Developer words ("shell", "feeders", "Redraft beats", "Cut tracker", "formats.."), English-only status card.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('next/navigation', async (orig) => ({
  ...(await orig<typeof import('next/navigation')>()),
  useParams: () => ({ tournamentId: 'e2e-tournament' }),
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => '/tournament/e2e-tournament',
}))
vi.mock('@/components/i18n/LanguageProviderClient', async (orig) => {
  const real = await orig<typeof import('@/components/i18n/LanguageProviderClient')>()
  const { translations } = await import('@/lib/i18n/translations')
  const en = (translations as unknown as Record<string, Record<string, string>>).en ?? {}
  const t = (k: string) => en[k] ?? k
  const tInterpolate = (k: string, vars: Record<string, string>) => t(k).replace(/\{\{(\w+)\}\}/g, (_, v) => vars[v] ?? '')
  const value = () => ({ language: 'en', setLanguage: () => {}, t, tInterpolate })
  return { ...real, useLanguage: value, useOptionalLanguage: value }
})

import { translations } from '@/lib/i18n/translations'
import { TournamentUiProvider } from '@/app/tournament/[tournamentId]/TournamentUiContext'
import TournamentHomePage from '@/app/tournament/[tournamentId]/page'
import TournamentDraftsPage from '@/app/tournament/[tournamentId]/drafts/page'
import TournamentProgressPage from '@/app/tournament/[tournamentId]/progress/page'
import TournamentStandingsHubPage from '@/app/tournament/[tournamentId]/standings/page'
import TournamentHistoryPage from '@/app/tournament/[tournamentId]/history/page'
import { HARNESS_USER_ID, layout, standings } from '@/app/e2e/tournament/fixtures'
import { getFormatIntroMetadata } from '@/lib/league/format-engine'

const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8')
const dict = translations as unknown as Record<string, Record<string, string>>

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function renderPage(Page: React.ComponentType, ready?: string) {
  vi.stubGlobal('fetch', vi.fn(async (input: string) => ({ ok: String(input).includes('/api/tournament/standings'), json: async () => standings })))
  const view = render(
    <TournamentUiProvider value={{ ...layout, viewerUserId: HARNESS_USER_ID }}>
      <Page />
    </TournamentUiProvider>,
  )
  if (ready) await screen.findAllByText(ready)
  return view
}

describe('1. Drafts', () => {
  it('an Opening Round league that is playing has drafted — not "Scheduled · TBD"', async () => {
    const { container } = await renderPage(TournamentDraftsPage)
    const t = container.textContent ?? ''
    expect(t).not.toMatch(/SCHEDULED|Scheduled|TBD/)
    expect(t.match(/Drafted/g)?.length).toBe(4)
  })
  it('no "You draft —" without a slot, the clock said once, no "(was 16)" for an unchanged roster', async () => {
    const { container } = await renderPage(TournamentDraftsPage)
    const t = container.textContent ?? ''
    expect(t).not.toMatch(/You draft/)
    expect(t).not.toMatch(/clock\s*·\s*90s/)
    expect(t).toMatch(/Snake draft · 90s clock/)
    expect(t).not.toMatch(/\(was 16\)/)
  })
})

describe('2. Commissioner draft time and rounds', () => {
  it('the "Start (local)" box shows the stored instant in local time, not UTC', () => {
    const src = read('components/tournament/TournamentDraftSchedulePanel.tsx')
    expect(src).not.toMatch(/scheduledAt\.slice\(0, 16\)/)
    expect(src.match(/toLocalDateTimeInput\(/g)?.length).toBe(2)
  })
  it('the overview names the draft day and minute, never seconds', () => {
    const src = read('components/tournament/TournamentCommissionerDashboard.tsx')
    expect(src).not.toMatch(/new Date\(at\)\.toLocaleString\(\)/)
  })
  it('the harness numbers rounds from 0, as real legacy rounds are', () => {
    const src = read('app/e2e/tournament/commissioner-fixtures.ts')
    expect(src).toMatch(/roundIndex: 0, phase: 'qualification'/)
    expect(src).not.toMatch(/roundIndex: 3/)
  })
})

describe('3. Home: one rank, each thing said once', () => {
  it('the conference race agrees with the status card: you are 3rd in both', async () => {
    const { container } = await renderPage(TournamentHomePage, 'Morgan')
    const card = screen.getByTestId('tournament-status-card').textContent ?? ''
    expect(card).toMatch(/Conf\. rank\s*3/)
    const race = [...container.querySelectorAll('li')].filter((li) => /\d-\d/.test(li.textContent ?? ''))
    const mine = race.findIndex((li) => (li.textContent ?? '').includes('Ciege'))
    expect(mine).toBe(2)
  })
  it('no third rank panel; the points rank sits under Points for', async () => {
    const { container } = await renderPage(TournamentHomePage, 'Morgan')
    expect(container.textContent).not.toMatch(/Overall snapshot|markers are illustrative/)
    expect(screen.getByTestId('tournament-status-points-rank').textContent).toMatch(/#1 of 32 in points/)
  })
  it('the round is said in the header with its weeks, not again on the status card', async () => {
    const { container } = await renderPage(TournamentHomePage, 'Morgan')
    expect(container.textContent?.match(/weeks 1–8/gi)?.length).toBe(1)
    expect(screen.getByTestId('tournament-status-card').textContent).not.toMatch(/Round 1/)
  })
  it('the bubble strip above the page hides on Home, where the status card says it', () => {
    expect(read('app/globals.css')).toMatch(
      /\.af-tournament-immersive:has\(\[data-tournament-home\]\) \[data-tournament-status-banner\]\s*\{\s*display:\s*none;/,
    )
    expect(read('app/tournament/[tournamentId]/TournamentChrome.tsx').match(/data-tournament-status-banner/g)?.length).toBe(2)
  })
})

describe('4. Home: no filler', () => {
  it('no draft card when no draft is live or scheduled, and no empty league banner', async () => {
    const { container } = await renderPage(TournamentHomePage, 'Morgan')
    expect(screen.queryByTestId('tournament-next-draft')).toBeNull()
    expect(container.textContent).not.toMatch(/DRAFT \/ MATCHUP|Schedule updates as rounds progress|Go to draft room/)
    expect(container.textContent).not.toMatch(/STATUS:/i)
    expect(container.querySelector('[data-testid="league-identity-scrim"]')).toBeNull()
  })
  it('announcement times show no seconds', async () => {
    const { container } = await renderPage(TournamentHomePage, 'Morgan')
    expect(container.textContent).not.toMatch(/\d:\d\d:\d\d/)
  })
})

describe('5. Progress', () => {
  it('future rounds are "—", not 0 teams; no stored codes; your league is marked', async () => {
    const { container } = await renderPage(TournamentProgressPage)
    const funnel = screen.getByTestId('tournament-funnel').textContent ?? ''
    expect(funnel).not.toMatch(/\b0\b/)
    expect(funnel).toMatch(/Elite Eight\s*—/)
    const t = container.textContent ?? ''
    expect(t).not.toMatch(/\bopening\b|\belite\b|\bactive\b|Multi-league funnel|each node/)
    expect(container.querySelectorAll('[data-mine]').length).toBe(1)
  })
  it('the rounds stack on a phone instead of scrolling sideways', async () => {
    await renderPage(TournamentProgressPage)
    const cls = screen.getByTestId('tournament-bracket').className.split(/\s+/)
    expect(cls).toContain('flex-col')
    expect(cls).toContain('md:flex-row')
    expect(cls.filter((c) => /^min-w-/.test(c))).toEqual([])
  })
})

describe('6. Standings tables', () => {
  it('every table has column headings, and no always-empty movement column', async () => {
    const { container } = await renderPage(TournamentStandingsHubPage, 'Morgan')
    const tables = container.querySelectorAll('table')
    expect(tables.length).toBeGreaterThan(0)
    for (const table of tables) expect(table.querySelector('thead th')).toBeTruthy()
    expect(container.textContent).toMatch(/Team/)
    expect(container.textContent).not.toMatch(/\bMv\b/)
    expect(read('app/tournament/[tournamentId]/league/page.tsx')).not.toMatch(/>Mv</)
  })
  it('status chips are words, not codes', async () => {
    const { container } = await renderPage(TournamentStandingsHubPage, 'Morgan')
    expect(container.textContent).toMatch(/Advancing/)
    expect(container.textContent).not.toMatch(/ADVANCING|COMPETING/)
  })
})

describe('7. History', () => {
  it('the recap note once, the year once, statuses in words', async () => {
    const { container } = await renderPage(TournamentHistoryPage)
    const t = container.textContent ?? ''
    expect(screen.getAllByTestId('tournament-history-note')).toHaveLength(1)
    expect(t.match(/recap/gi)?.length).toBe(1)
    expect(t).not.toMatch(/2026 · 2026/)
    expect(t).not.toMatch(/·\s*(active|upcoming)\b/)
    expect(t).toMatch(/In play/)
  })
})

describe('8. Plain words, both languages', () => {
  const DEV = /\bshell\b|feeder|beats|cut tracker|console|sub-liga|sub-league/i
  for (const lang of ['en', 'es'] as const) {
    it(`${lang}: commissioner overview strings use no build words`, () => {
      const bad = Object.entries(dict[lang]!)
        .filter(([k]) => k.startsWith('tournament.commissioner.stat.') || /tournament\.commissioner\.(subLeagueShell|table\.shell|shell\.|operationsBlurb|draftPhaseClocks|phaseRoadmap|advanceCuts|goOperations|chatUniversal)/.test(k))
        .filter(([, v]) => DEV.test(v))
      expect(bad).toEqual([])
    })
  }
  it('every new tournament string exists in Spanish too', () => {
    const fresh = Object.keys(dict.en!).filter((k) => /^tournament\.(words|status|progress|standings|history|league)\./.test(k))
    expect(fresh.length).toBeGreaterThan(60)
    expect(fresh.filter((k) => !dict.es![k])).toEqual([])
  })
  it('the status card carries no English literals', () => {
    const src = read('app/tournament/components/TournamentStatusCard.tsx')
    expect(src).not.toMatch(/'You are|'Record'|>Record<|Points for<|Conf\. rank<|'View /)
  })
  it('the intro line ends with one period', () => {
    expect(getFormatIntroMetadata({ sport: 'NFL', leagueType: 'tournament' }).subtitle).not.toMatch(/\.\.$/)
  })
  it('the commissioner overview tiles sit two to a row on a phone and do not repeat the status', () => {
    const src = read('components/tournament/TournamentCommissionerDashboard.tsx')
    expect(src).toMatch(/grid grid-cols-2 gap-3 xl:grid-cols-4" data-testid="tournament-commissioner-stats"/)
    expect(src).not.toMatch(/stat\.currentPhase'\)/)
  })
})
