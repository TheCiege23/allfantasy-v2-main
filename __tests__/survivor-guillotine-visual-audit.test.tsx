import fs from 'node:fs'
import path from 'node:path'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SurvivorGuillotineLeague } from '@/components/survivor-guillotine/SurvivorGuillotineLeague'
import { markEdge } from '@/components/survivor-guillotine/SGBoards'
import { operations, season } from '@/app/e2e/survivor-guillotine/fixtures'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

/** The harness fixture: period 4, Vela (tribe-0) and Koa (tribe-1), the viewer a commissioner. */
async function renderLeague() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    ok: true, json: async () => (url.endsWith('/operations') ? operations : season),
  })))
  const view = render(<SurvivorGuillotineLeague leagueId="e2e-guil" />)
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Commissioner control' })).toBeTruthy())
  return view
}

describe('Survivor Guilly visual audit', () => {
  it('names tribes the way the island does, never by engine id', async () => {
    const { container } = await renderLeague()
    const text = container.textContent ?? ''
    expect(text).not.toMatch(/tribe-\d/)
    const race = screen.getByRole('heading', { level: 2, name: 'Tribe race' }).closest('section')!
    expect(within(race).getAllByRole('heading', { level: 3 }).map(h => h.textContent)).toEqual(['Vela · yours', 'Koa'])
    expect(text).toContain('Koa won immunity. Hidden Advantage saved by idols.')
    expect(text).toContain('Vela captain tie fallback')
    // Every option in the commissioner's tie selector is a tribe name.
    const tieTribe = screen.getByRole('combobox', { name: 'Immune tribe' }) as HTMLSelectElement
    expect([...tieTribe.options].map(o => o.textContent)).toEqual(['No tribe immunity', 'Vela', 'Koa'])
    expect([...tieTribe.options].map(o => o.value)).toEqual(['', 'tribe-0', 'tribe-1'])
  })

  it('labels replayed periods with the format name, not the mode code', async () => {
    await renderLeague()
    const replay = screen.getByRole('heading', { level: 2, name: 'Chop Night & replay' }).closest('section')!
    expect([...replay.querySelectorAll('strong')].map(s => s.textContent)).toEqual(['Period 3 · Match Play', 'Period 2 · Match Play'])
  })

  it('hangs a blade-meter label inward near either end so it stays on the card', () => {
    expect(markEdge(0)).toBeTruthy()
    expect(markEdge(100)).toBeTruthy()
    expect(markEdge(0)).not.toBe(markEdge(100))
    expect(markEdge(50)).toBeUndefined()
  })

  it('gives chop-line names the row on a phone instead of the decorative bar', async () => {
    const { container } = await renderLeague()
    const rows = container.querySelectorAll('[data-testid="sg-chopline"] [data-tier]')
    expect(rows.length).toBe(10)
    for (const row of rows) {
      expect(row.querySelector('[class*="chopName"]')).toBeTruthy()
      expect(row.querySelector('[class*="chopBar"]')?.getAttribute('aria-hidden')).toBe('true')
    }
    const css = fs.readFileSync(path.join(process.cwd(), 'components/survivor-guillotine/survguil.module.css'), 'utf8')
    const phone = /@media \(max-width: 520px\) \{([^}]*\}[^}]*\})\s*\}/.exec(css)?.[1] ?? ''
    expect(phone).toMatch(/^\s*\.chopBar \{ display: none; \}/m)
    expect(phone).toMatch(/^\s*\.mrow > \.chopName \{ flex: 1 1 auto; \}/m)
    expect(css).toMatch(/^\.markStart > span \{ left: 0; transform: none; \}/m)
    expect(css).toMatch(/^\.markEnd > span \{ left: auto; right: 0; transform: none; \}/m)
  })
})
