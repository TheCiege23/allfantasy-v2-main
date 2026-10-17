/**
 * A stylesheet that ANIMATES must say what it does under `prefers-reduced-motion: reduce`.
 *
 * Measured 2026-09-28 across the 102 stylesheets under components/ and app/: 26 honoured the
 * setting, and exactly two animated without honouring it —
 *   - components/core-app/af-commish-hub.css   `af-ch-pulse`, an INFINITE skeleton pulse
 *   - components/StartSitPopup/StartSitPopup.module.css  `spin`, an INFINITE spinner
 * Both were guarded (the second file has since been deleted with the unmounted popup); this keeps
 * the count at zero.
 *
 * ⚠ SCOPED TO `@keyframes` / `animation:`, NOT `transition:`. A transition fires once on an
 * interaction and is a different (much larger, much lower-risk) population — folding it in here
 * would turn a guard that can reach zero into a permanent red number nobody reads. Infinite
 * motion is the case the media query exists for, and it is what this asserts.
 *
 * ⚠ AND IT SAYS NOTHING ABOUT WHETHER THE GUARD IS ANY GOOD. A file can satisfy this with a block
 * that stops the wrong selector. The spinner is the worked example: `animation: none` alone leaves
 * a ring with one coloured edge frozen mid-turn, which reads as broken rather than busy, so its
 * guard also squares up the border. That judgement belongs to whoever writes the rule; this only
 * makes sure the question was asked.
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOTS = [join(process.cwd(), 'components'), join(process.cwd(), 'app')]

function cssFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) cssFiles(full, found)
    else if (entry.endsWith('.css')) found.push(full)
  }
  return found
}

const ANIMATES = /@keyframes\b|animation:\s*(?!none)/
const GUARDED = /prefers-reduced-motion/

/**
 * 🛑 COMMENTS STRIPPED, AND THIS TEST CAUGHT ITSELF NEEDING IT. `af-commish-hub.css` carries a
 * comment explaining WHY its guard exists — which contains the words `prefers-reduced-motion`. With
 * the raw text, deleting the actual `@media` block left the prose behind and the test stayed GREEN:
 * a guard satisfied by the documentation of the thing it wants. The mutation control is the only
 * reason that surfaced, and it is the same trap this repo already records for source-string guards.
 */
const code = (file: string) => readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

describe('every animating stylesheet honours prefers-reduced-motion', () => {
  const all = ROOTS.flatMap((r) => cssFiles(r))
  const animating = all.filter((f) => ANIMATES.test(code(f)))

  it('found the stylesheets at all — an empty scan passes everything below', () => {
    expect(all.length).toBeGreaterThan(50)
    expect(animating.length).toBeGreaterThan(10)
  })

  it('no animating stylesheet is missing a reduced-motion block', () => {
    const unguarded = animating
      .filter((f) => !GUARDED.test(code(f)))
      .map((f) => f.slice(f.indexOf('components') >= 0 ? f.indexOf('components') : f.indexOf('app')).replace(/\\/g, '/'))
    expect(
      unguarded,
      `these stylesheets animate with no prefers-reduced-motion block:\n${unguarded.map((f) => `  ${f}`).join('\n')}`,
    ).toEqual([])
  })
})
