import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Season Story on a phone: the season tabs beside the title squeezed "Season story" and its subtitle into
 * an 88px column, 219px deep (2026-11-07 Survivor audit). The head already wraps; the title block needed a
 * basis so the tabs move to their own line instead of shrinking it. Asserted at brace depth 0 and scoped to
 * .svk-head, so other .svk-grow rows keep `flex: 1; min-width: 0`.
 */
const css = readFileSync(path.join(process.cwd(), 'components/survivor/survivor-core.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, (c) => ' '.repeat(c.length))

function topLevel(selector: string): string {
  const at = css.indexOf(`${selector}{`)
  if (at < 0) throw new Error(`no rule ${selector}`)
  const before = css.slice(0, at)
  if (before.split('{').length !== before.split('}').length) throw new Error(`${selector} is nested`)
  return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at))
}

describe('Survivor page head', () => {
  it('gives the title block a basis inside the head', () => {
    expect(topLevel('.svk-head>.svk-grow')).toMatch(/flex:\s*1 1 (\d{3})px/)
    const basis = Number(/flex:\s*1 1 (\d+)px/.exec(topLevel('.svk-head>.svk-grow'))![1])
    expect(basis).toBeGreaterThanOrEqual(200)
  })

  it('leaves the general .svk-grow rule alone', () => {
    expect(topLevel('.svk-grow')).toBe('flex:1;min-width:0')
  })
})
