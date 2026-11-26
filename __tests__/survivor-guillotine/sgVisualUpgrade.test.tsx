// @vitest-environment jsdom
/**
 * Survivor Guillotine after the 2026-11-24 visual audit (DB-free harness at /e2e/survivor-guillotine-league/island?mood=):
 * 1. A chopped manager was told nothing and kept the playing controls (lineup, FAAB bids, captain vote).
 * 2. The finale did not say who won; the standings sat unlabelled at the bottom.
 * 3. Every team was listed five times: "Island operations" repeated the lineup, the tribe lists, the chop line
 *    ("Elimination watch") and the powers, in a second visual style.
 * 4. Before the season it said the commissioner or a draw sets tribes in a league where managers choose, buried the
 *    choice at the bottom, offered a captain vote before any tribe existed and listed 12 teams at "0.0 active".
 * 5. No light mode.
 * 6. Engine and developer wording; the tribe-count picker and notification table shown to managers.
 * 7. "Powers lock in —" with nothing to count to; dates printed with seconds.
 * 8. Phone: scores printed over the race art, oversized torch cards, chop-line names cut off.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'

vi.mock('next/link', () => ({ default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...rest}>{children}</a> }))

import { sgHarnessApi, type SgHarnessMood } from '@/app/e2e/survivor-guillotine-league/fixtures'
import { SurvivorGuillotineLeague } from '@/components/survivor-guillotine/SurvivorGuillotineLeague'

const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8')
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

async function island(mood: SgHarnessMood) {
  const routes = sgHarnessApi(mood)
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const u = new URL(String(input), 'http://localhost')
    const hit = routes.find((r) => r.path === u.pathname)
    return new Response(JSON.stringify(hit ? hit.body : { error: 'unfed' }), { status: hit ? 200 : 503 })
  }))
  const view = render(<SurvivorGuillotineLeague leagueId="e2e-sg-league" />)
  await waitFor(() => expect(screen.getByTestId('sg-visual-set')).toBeTruthy())
  return view
}
/** Visible text, without <option> labels (a select lists every team by design). */
const textOf = (el: Element) => {
  const c = el.cloneNode(true) as Element
  c.querySelectorAll('option').forEach((o) => o.remove())
  return c.textContent ?? ''
}

describe('a chopped manager', () => {
  it('is told, and loses the playing controls', async () => {
    const { container } = await island('viewer_chopped')
    const txt = textOf(container)
    expect(txt).toMatch(/You were chopped in period 5/)
    expect(txt).not.toMatch(/Place FAAB bids|Cast private vote|Set lineup & manage roster|Submit champion/)
    expect(within(screen.getByTestId('sg-tribedraw')).queryByText(/captain/)).toBeNull()
  })
})

describe('the finale', () => {
  it('says who won, at the top, with the podium', async () => {
    await island('finale')
    const set = screen.getByTestId('sg-visual-set')
    expect(set.textContent).toMatch(/You won the island/)
    const podium = within(set).getByTestId('sg-final')
    expect(within(podium).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      expect.stringMatching(/1st.*Torch Bearers/), expect.stringMatching(/2nd.*Merge Monsters/), expect.stringMatching(/3rd.*Final Three/),
    ])
    expect(set.textContent).not.toMatch(/Powers lock in|Place FAAB bids/)
  })
})

describe('said once', () => {
  it('no second lineup, tribe list, chop line or standings below the island', async () => {
    const { container } = await island('in_season')
    expect(screen.queryByRole('heading', { name: 'Elimination watch' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Final standings' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Tribe race' })).toBeNull()
    // Each team: the race, the chop line and the torches. Not five times.
    expect(textOf(container).split('Merge Monsters').length - 1).toBeLessThanOrEqual(4)
    expect(read('components/survivor-guillotine/league.module.css')).not.toMatch(/font-family:\s*(Arial|Georgia)/)
  })
})

describe('before the season', () => {
  it('managers who choose are told so, at the top, with no captain vote and no zero list', async () => {
    const { container } = await island('tribe_choice')
    const race = screen.getByTestId('sg-race')
    expect(race.textContent).not.toMatch(/commissioner or the draw/)
    expect(within(race).getByRole('link', { name: /choose your tribe/i })).toBeTruthy()
    const txt = textOf(container)
    expect(txt).not.toMatch(/Vote for captain|0\.0 active/)
  })
})

describe('plain words', () => {
  it('no engine or developer wording for a manager; no setup picker or channel table', async () => {
    const { container } = await island('in_season')
    expect(textOf(container)).not.toMatch(/engine|capped-games NBA|words pack|not part of this league format|Deciding metric|Notification defaults/)
    expect(screen.queryByTestId('sg-tribesetup')).toBeNull()
  })
  it('dates without seconds, and no empty countdown', async () => {
    const { container } = await island('in_season')
    expect(textOf(container)).not.toMatch(/\d{1,2}:\d{2}:\d{2}/)
    expect(screen.queryByText('Powers lock in')).toBeNull()
  })
})

describe('light mode', () => {
  it('the island joins the shared light rule and reads the shell tokens', () => {
    expect(read('components/league/specialty/specialty.module.css')).toMatch(/:global\(html\[data-mode='light'\]\) \.sp\[data-specialty='survguil'\]/)
    const css = read('components/survivor-guillotine/survguil.module.css')
    expect(css.replace(/var\([^()]*(\([^()]*\))?[^()]*\)/g, '')).not.toMatch(/#9aa3b8|#b9c0d0|#d7dbe6|#e7e9f0/)
    for (const f of ['SGVisualSet', 'SGBoards']) {
      expect(read(`components/survivor-guillotine/${f}.tsx`), f).not.toMatch(/color: '#(9aa3b8|b9c0d0|d7dbe6)'/)
    }
    expect(read('components/survivor-guillotine/league.module.css')).toMatch(/data-mode='light'/)
  })
})

describe('on a phone', () => {
  it('scores sit under the race art, torches are compact, chop-line names wrap', () => {
    const css = read('components/survivor-guillotine/survguil.module.css')
    const tail = css.slice(css.lastIndexOf('/* 2026-11-24 phone */'))
    expect(tail).toMatch(/\.torches\s*\{[^}]*minmax\(7\dpx/)
    expect(tail).toMatch(/\.raceNames/)
    expect(tail).toMatch(/\.chopName[^{]*\{[^}]*white-space:\s*normal/)
  })
})
