import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 🛑 TWO SCREENS, ONE ROOT CLASS (live, 2026-11-07). League Career's root was `.af-lc`, the class the
 * launch countdown already owned. `af-launch.css` loads with the shell and sets `.af-lc` to an
 * inline-flex, centred, 18px monospace box, so the whole League Career page took the countdown's
 * font, and once its banner moved onto StatStrip (#3311) the page collapsed to 0px wide: four tiles
 * 34px across, "5—3" stacked vertically, "1,104" drawn over "62.5%".
 *
 * The rule this pins: the two stylesheets share NO class name, so neither can restyle the other.
 */
const root = process.cwd()
const css = (rel: string) => readFileSync(join(root, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const classesIn = (text: string) => new Set([...text.matchAll(/\.(af-[a-z0-9-]+)/g)].map((m) => m[1]))

describe('League Career and the launch countdown never share a class', () => {
  const career = classesIn(css('components/core-app/af-league-career.css'))
  const launch = classesIn(css('components/launch/af-launch.css'))

  it('reads both sheets (a matcher that found nothing would pass vacuously)', () => {
    expect(career.has('af-lcareer')).toBe(true)
    expect(launch.has('af-lc')).toBe(true)
  })

  // The shell's own classes, which both sheets scope under on purpose.
  const SHARED_SHELL = new Set(['af-core', 'af-num'])

  it('has no class name in common beyond the shell scope', () => {
    expect([...career].filter((c) => launch.has(c) && !SHARED_SHELL.has(c))).toEqual([])
  })

  it('the screen renders the career root, not the countdown root', () => {
    const tsx = readFileSync(join(root, 'components/core-app/screens/LeagueCareer.tsx'), 'utf8')
    expect(tsx).not.toMatch(/className="af-lc"/)
    expect(tsx.match(/className="af-lcareer"/g)?.length).toBe(3)
  })
})
