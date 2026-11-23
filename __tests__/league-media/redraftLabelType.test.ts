/**
 * Redraft label type (2026-11-06): titles read as words, data reads as data. Screen eyebrows, card titles,
 * the season-race title and tab section titles are sentence-case sans; mono caps stay on the data beside
 * them (a card label's right-hand count, the race's "Week 9 of 17", chips, table headers). Shared rules that
 * other formats use are left as they were and overridden only under `.nl-workspace[data-format=redraft]`.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const SCREENS = read('components/league/native/screens/redraft-native-screens.css')
const HOME = read('components/league/native/redraft-home.css')
const IDENTITY = read('components/league/native/redraft-identity.css')
const TABS = read('app/league/[leagueId]/tabs/redraft-tailwind-tabs.css')
const NATIVE = read('components/league/native/native-league.css')
const BASE_SCREENS = read('components/league/native/screens/native-screens.css')

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** Declarations of every top-level rule whose selector list contains `selector` exactly, in source order. */
function decls(css: string, selector: string): string {
  const re = new RegExp(`(?:^|[}])\\s*((?:[^{}]*,\\s*)?${esc(selector)}(?:\\s*,[^{}]*)?)\\s*\\{([^}]*)\\}`, 'gm')
  const found = [...css.matchAll(re)].map((m) => m[2])
  expect(found.length, `no rule for ${selector}`).toBeGreaterThan(0)
  return found.join(';')
}
const isSans = (d: string) => /archivo/i.test(d) && !/mono/i.test(d)
const isTitle = (d: string) => isSans(d) && /text-transform:\s*none/.test(d) && /letter-spacing:\s*0\b/.test(d)

describe('redraft titles are sentence-case sans', () => {
  it('screen eyebrows and card labels', () => {
    expect(isTitle(decls(SCREENS, '.nl-workspace[data-format=redraft] .nls-eyebrow'))).toBe(true)
    expect(isTitle(decls(SCREENS, '.nl-workspace[data-format=redraft] .nls-label'))).toBe(true)
  })
  it('home card titles and the shared card label, redraft only', () => {
    const rdh = decls(HOME, '.rdh-label')
    expect(isSans(rdh) && !/uppercase/.test(rdh)).toBe(true)
    expect(isTitle(decls(HOME, '.nl-workspace[data-format=redraft] .nl-card-label'))).toBe(true)
  })
  it('the season-race title', () => {
    expect(isTitle(decls(IDENTITY, '.nl-rd-track-head>span'))).toBe(true)
  })
  it('tab section titles, inside a redraft workspace', () => {
    expect(isTitle(decls(TABS, '.nl-workspace[data-format=redraft] .rdt-eyebrow'))).toBe(true)
  })
})

describe('data keeps mono caps', () => {
  it("a card label's right-hand value", () => {
    const d = decls(SCREENS, '.nl-workspace[data-format=redraft] .nls-label > span + span')
    expect(d).toMatch(/var\(--nl-mono\)/)
    expect(d).toMatch(/text-transform:\s*uppercase/)
  })
  it('the race week and the league chips', () => {
    expect(decls(IDENTITY, '.nl-rd-track-head')).toMatch(/mono[\s\S]*text-transform:uppercase/)
    expect(decls(IDENTITY, '.nl-workspace .nl-rd-chip')).toMatch(/text-transform:uppercase/)
  })
})

describe('other formats are unchanged', () => {
  it('keeps the shared mono-caps rules as they were', () => {
    expect(decls(TABS, '.rdt-eyebrow')).toMatch(/var\(--rdt-mono\)[\s\S]*text-transform:uppercase/)
    expect(decls(NATIVE, '.nl-card-label')).toMatch(/mono[\s\S]*text-transform:uppercase/)
    expect(decls(BASE_SCREENS, '.nls-eyebrow')).toMatch(/var\(--nl-mono\)[\s\S]*text-transform: uppercase/)
    expect(decls(BASE_SCREENS, '.nls-label')).toMatch(/var\(--nl-mono\)[\s\S]*text-transform: u/)
  })
})
