/**
 * Light mode: pale cyan text on league screens.
 *
 * `text-cyan-100` is #cffafe. Light mode only rewrites `text-white*` (globals.css,
 * under `.mode-readable`), so pale cyan stayed pale cyan on a light page and the
 * buttons, badges and notes using it were close to invisible. League screens now
 * use `--badge-text-cyan`, which is dark teal in light mode and pale cyan in dark.
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n')

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(e.name)) out.push(p)
  }
  return out
}

const LEAGUE_FILES = [...walk('components/league'), ...walk('app/league')]

describe('league screens: no pale cyan text in light mode', () => {
  it('scans a real file set', () => {
    expect(LEAGUE_FILES.length).toBeGreaterThan(50)
    expect(LEAGUE_FILES.some((f) => f.endsWith('PowerRankings.tsx'))).toBe(true)
  })

  it('no league file uses text-cyan-100', () => {
    const hits = LEAGUE_FILES.filter((f) => /(^|[^:\w-])text-cyan-100(?![\d])/.test(read(f)))
    expect(hits).toEqual([])
  })

  it('the pattern catches the class it is looking for (positive control)', () => {
    const re = /(^|[^:\w-])text-cyan-100(?![\d])/
    expect(re.test('className="px-2 text-cyan-100"')).toBe(true)
    expect(re.test('className="text-cyan-100/80"')).toBe(true)
    expect(re.test('className="text-cyan-200"')).toBe(false)
  })

  it('--badge-text-cyan is dark in light mode and pale in dark mode', () => {
    const css = read('app/globals.css')
    const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')))
    expect(root).toMatch(/--badge-text-cyan:\s*#155e75/i)
    const darkStart = css.indexOf('html[data-mode="dark"] {')
    const dark = css.slice(darkStart, css.indexOf('}', darkStart))
    expect(dark).toMatch(/--badge-text-cyan:\s*#a5f3fc/i)
  })

  it('the converted screens use the token', () => {
    for (const f of [
      'components/league/PowerRankings.tsx',
      'components/league/LeagueSurfaceState.tsx',
      'app/league/[leagueId]/dispersal-draft/[draftId]/page.tsx',
    ]) {
      expect(read(f)).toContain('text-[var(--badge-text-cyan)]')
    }
  })
})
