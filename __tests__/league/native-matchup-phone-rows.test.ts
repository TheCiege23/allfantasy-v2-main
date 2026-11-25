import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Native Matchup on a phone (2026-11-24, the simplify pass): no player photo in the two-sided starter grid
 * (stacked above the name it made each row ~170px), the names get the width back, and the scoreboard
 * glance in the side column is not drawn — "League scoreboard" is a tab at the top.
 */
const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const phone = (css: string) => css.slice(css.indexOf('@media (max-width: 767px)'))

describe('native matchup rows on a phone', () => {
  const base = phone(read('components/league/native/screens/native-screens.css'))
  const redraft = phone(read('components/league/native/screens/redraft-native-screens.css'))

  it('hides the photo and the scoreboard glance inside the phone query', () => {
    expect(base).toMatch(/\.nls-mrow \.nls-mavatar \{ display: none; \}/)
    expect(base).toMatch(/\.nls-aside \.nls-glance \{ display: none; \}/)
    expect(base).not.toMatch(/\.nls-pl\[data-media=true\] \{ flex-direction: column/)
  })

  it('gives the names the width: 40px middle columns in both sheets', () => {
    expect(base).toMatch(/\.nls-mrow \{ grid-template-columns: minmax\(0, 1fr\) 40px 40px 40px minmax\(0, 1fr\); gap: 4px; \}/)
    expect(redraft).toMatch(/\.nls-mrow \{ grid-template-columns: minmax\(0, 1fr\) 40px 40px 40px minmax\(0, 1fr\); gap: 4px;/)
  })

  it('trades: the four counts are one row on a phone, and an open offer\'s sentence takes the full width', () => {
    const css = read('components/league/native/screens/native-screens.css')
    const narrow = css.slice(css.lastIndexOf('@media(max-width:600px)'))
    expect(narrow).toMatch(/\.nls-trade-overview\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/)
    expect(narrow).toMatch(/\.nls-offer-out>\.nls-grow\{flex:1 1 100%\}/)
  })

  it('standings: the playoff-format rows are 36px on a phone', () => {
    const css = read('components/league/native/screens/native-screens.css')
    const narrow = css.slice(css.lastIndexOf('@media(max-width:600px)'))
    expect(narrow).toMatch(/\.nls-dl>div\{min-height:36px;font-size:14px\}/)
  })
})
