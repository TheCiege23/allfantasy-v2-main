/**
 * Tournament commissioner hub (/tournament-hub/[id]: the standings board, the divisions & conferences screens,
 * the season planner) and the trophy page, 2026-11-09 visual audit (phone + desktop, dark + light, through the
 * existing dev previews /dev/tournament-hub-preview and /dev/tournament-divisions-preview).
 *
 * 1. The board scrolled the WHOLE PAGE sideways on a phone (587px for a 390px screen). A visually-hidden label
 *    (.af-th-sr) in a table row had no positioned ancestor before the page, so it resolved against the document
 *    at its in-flow spot inside the scrolled table and widened it. The table scroller is now positioned.
 * 2. Avatar tiles drew initials at size × 0.3 — 7px on a 22px tile, under the 11px type floor.
 * 3. Seeding and round control scrolled the page sideways too (618px): its sections sat in a grid with columns
 *    only from xl, so the implicit column grew to a wide table. Every responsive grid in the divisions screens now
 *    has a base column.
 * 4. Light mode: every hub screen is dark-only, and the clamp blanked most of their text. Each root opts out.
 * 5. Plan a tournament: a format card's title shared a row with its icon and button, leaving ~120px; the header
 *    now wraps.
 */
import React from 'react'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
vi.mock('next/navigation', async (orig) => ({
  ...(await orig<typeof import('next/navigation')>()),
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {} }),
  usePathname: () => '/tournament-hub/preview',
  useSearchParams: () => new URLSearchParams(),
}))

import HubPreviewPage from '@/app/dev/tournament-hub-preview/page'

const ROOT = process.cwd()
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')
afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

describe('standings board', () => {
  // The preview 404s outside development by design; it renders the real board over its invented rows.
  beforeEach(() => vi.stubEnv('NODE_ENV', 'development'))

  it('draws avatar initials at the 11px floor or above', async () => {
    const { container } = render(await HubPreviewPage())
    const tiles = [...container.querySelectorAll<HTMLElement>('.af-th-tile')]
    expect(tiles.length).toBeGreaterThan(10)
    for (const t of tiles) expect(parseFloat(t.style.fontSize), t.textContent ?? '').toBeGreaterThanOrEqual(11)
  })

  it('is dark in every mode', async () => {
    const { container } = render(await HubPreviewPage())
    expect(container.querySelector('main.af-th')?.className.split(/\s+/)).toContain('af-draft-dark')
  })

  it('positions the table scroller, so hidden labels in its rows cannot widen the page', () => {
    const css = read('app/tournament-hub/[tournamentId]/tournament-hub.css').replace(/\/\*[\s\S]*?\*\//g, '')
    const rule = /\.af-th-scroll\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(rule).toMatch(/position:\s*relative/)
    expect(rule).toMatch(/overflow-x:\s*auto/)
    // The labels are still absolutely positioned; it is the scroller that now contains them.
    expect(/\.af-th-sr\s*\{([^}]*)\}/.exec(css)?.[1]).toMatch(/position:\s*absolute/)
  })
})

describe('divisions & conferences screens', () => {
  const DIR = 'components/tournament/divisions'
  const files = readdirSync(path.join(ROOT, DIR)).filter((f) => f.endsWith('.tsx')).map((f) => `${DIR}/${f}`)

  it('gives every responsive grid a base column', () => {
    const offenders: string[] = []
    for (const f of files) {
      for (const m of read(f).matchAll(/className="([^"]*)"/g)) {
        const c = m[1]!.split(/\s+/)
        if (c.includes('grid') && c.some((x) => /^(sm|md|lg|xl|2xl):grid-cols-/.test(x)) && !c.some((x) => /^grid-cols-/.test(x))) offenders.push(`${f}: ${m[1]}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it.each([
    'components/tournament/divisions/DivisionsHub.tsx',
    'components/tournament/divisions/DivisionControl.tsx',
    'components/tournament/divisions/TournamentJoin.tsx',
    'components/tournament/divisions/TournamentPlanFlow.tsx',
    'components/tournament/divisions/TournamentReveal.tsx',
    'components/tournament/SeasonTournamentPlanner.tsx',
    'app/tournament-trophy/[tournamentId]/page.tsx',
  ])('%s opts its screen out of the light-mode clamp', (rel) => {
    const main = /<main className="([^"]+)"/.exec(read(rel))?.[1]
    expect(main?.split(/\s+/)).toContain('af-draft-dark')
  })

  it('opts the share studio out too, wherever it is mounted', () => {
    expect(read('components/tournament/divisions/ChampionShareCard.tsx')).toMatch(/className="af-draft-dark grid grid-cols-1[^"]*lg:grid-cols-\[minmax\(0,1fr\)_420px\]"/)
  })

  it('lets a format card header wrap, with a basis on the title', () => {
    const src = read('components/tournament/divisions/TournamentFormatPicker.tsx')
    expect(src).toMatch(/<div className="flex flex-wrap items-start gap-4">\s*\{icon\}\s*<div className="min-w-0 flex-1 basis-\d+">/)
  })
})
