/**
 * Player-facing tournament app (/tournament/[id]), 2026-11-09 visual audit (phone + desktop, dark + light, DB-free
 * harness at /e2e/tournament/[id]/[screen]).
 *
 * 1. Always dark: the light-mode clamp turned names, numbers and headings dark-on-dark. The layout wrapper carries
 *    `af-draft-dark`, the app's opt-out.
 * 2. Standings and My League hid W-L and PF on a phone: every table had `min-w-[560px]`, though its rows already
 *    hide status, streak and conference below sm/md/lg — so the numbers sat off screen and the cut-line labels
 *    were clipped. The minimum now applies from `sm`.
 * 3. Home's tournament arc said "32 left" under every future round: a round with no leagues fell back to the
 *    whole field.
 * 4. Home's league card printed an internal id ("ID: tl-1…").
 * 5. Home's conference race drew the advance and bubble rule as dashed divider lines under the whole list,
 *    reading as "the cut is after 5th". It is a per-league rule; it is now a caption.
 * 6. Forum was wider than a phone: its grid set columns only from `lg`.
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

import { TournamentUiProvider } from '@/app/tournament/[tournamentId]/TournamentUiContext'
import TournamentHomePage from '@/app/tournament/[tournamentId]/page'
import { HARNESS_USER_ID, layout, standings } from '@/app/e2e/tournament/fixtures'

const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8')

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function renderHome() {
  vi.stubGlobal('fetch', vi.fn(async (input: string) => ({ ok: String(input).includes('/api/tournament/standings'), json: async () => standings })))
  const view = render(
    <TournamentUiProvider value={{ ...layout, viewerUserId: HARNESS_USER_ID }}>
      <TournamentHomePage />
    </TournamentUiProvider>,
  )
  await screen.findByText('Quinn')
  return view
}

describe('tournament home', () => {
  it('counts only the rounds that have a field', async () => {
    const { container } = await renderHome()
    // Round 1 (current) has its 32; rounds 2 and 3 have no leagues yet and must not claim the whole field.
    expect(container.textContent?.match(/\d+ left/g)).toEqual(['32 left'])
  })

  it('shows no internal id', async () => {
    const { container } = await renderHome()
    expect(container.textContent).not.toMatch(/\bID:\s/)
    expect(container.textContent).not.toContain('tl-1')
  })

  it('states the advance rule as a caption, not a divider under the list', async () => {
    const { container } = await renderHome()
    const rule = container.querySelector('[data-testid="tournament-conference-race-rule"]')
    expect(rule?.textContent).toContain('Top 2 in each league advance')
    expect(rule?.textContent).toContain('the next 4 go to the bubble')
    expect(container.textContent).not.toContain('QUALIFICATION LINE')
  })
})

describe('tournament layout and tables', () => {
  it('opts the tournament app out of the light-mode clamp', () => {
    const wrapper = /<div className="([^"]*tournament-theme[^"]*)"/.exec(read('app/tournament/[tournamentId]/layout.tsx'))?.[1]
    expect(wrapper?.split(/\s+/)).toContain('af-draft-dark')
  })

  it.each(['app/tournament/[tournamentId]/standings/page.tsx', 'app/tournament/[tournamentId]/league/page.tsx'])(
    '%s sets no table minimum below sm',
    (rel) => {
      const tables = [...read(rel).matchAll(/<table className="([^"]+)"/g)].map((m) => m[1]!.split(/\s+/))
      expect(tables.length).toBeGreaterThan(0)
      for (const classes of tables) expect(classes.filter((c) => /^min-w-/.test(c)), classes.join(' ')).toEqual([])
    },
  )

  it('gives the forum grid a single column below lg', () => {
    const grid = /className="([^"]*\blg:grid-cols-\[1fr_280px\][^"]*)"/.exec(read('app/tournament/[tournamentId]/forum/page.tsx'))?.[1]
    expect(grid?.split(/\s+/)).toContain('grid-cols-1')
  })
})
