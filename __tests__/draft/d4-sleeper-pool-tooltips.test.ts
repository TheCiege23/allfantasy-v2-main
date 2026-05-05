import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  SLEEPER_POOL_TABLE_COLUMNS,
  cellTooltip,
} from '@/components/app/draft-room/SleeperPoolTable.constants'

/**
 * D.4 — Sleeper-pool tooltips + polish. Pure-logic tests on the tooltip
 * helper and column-spec metadata, plus static-source assertions for the
 * row/header tooltip wiring inside SleeperPoolTable.tsx.
 */

const root = resolve(__dirname, '..', '..')
function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

describe('D.4 — column header tooltip metadata', () => {
  it('every numeric / draft column has a friendly title', () => {
    const expected: Record<string, RegExp> = {
      adp: /Average Draft Position/,
      aiAdp: /AllFantasy AI Draft Position/,
      bye: /bye week/i,
      pts: /fantasy points/i,
      avg: /per game/i,
      ru_att: /Rushing attempts/i,
      ru_yds: /Rushing yards/i,
      ru_td: /Rushing touchdowns/i,
      rec: /Receptions/i,
      rec_yds: /Receiving yards/i,
      rec_td: /Receiving touchdowns/i,
      pa_att: /Passing attempts/i,
      pa_yds: /Passing yards/i,
      pa_td: /Passing touchdowns/i,
      pa_int: /Passing interceptions/i,
    }
    for (const [key, pattern] of Object.entries(expected)) {
      const col = SLEEPER_POOL_TABLE_COLUMNS.find((c) => c.key === key)
      expect(col, `column ${key}`).toBeDefined()
      expect(col!.title, `column ${key} title`).toBeDefined()
      expect(col!.title!).toMatch(pattern)
    }
  })

  it('RK and PLAYER columns also get descriptive headers (not just abbreviations)', () => {
    const rk = SLEEPER_POOL_TABLE_COLUMNS.find((c) => c.key === 'rk')!
    const player = SLEEPER_POOL_TABLE_COLUMNS.find((c) => c.key === 'player')!
    expect(rk.title).toMatch(/rank/i)
    expect(player.title).toMatch(/player/i)
  })

  it('every stat column has a humanized statLabel for row-cell tooltips', () => {
    const statColumns = ['pts', 'avg', 'ru_att', 'ru_yds', 'ru_td', 'rec', 'rec_yds', 'rec_td', 'pa_att', 'pa_yds', 'pa_td', 'pa_int']
    for (const key of statColumns) {
      const col = SLEEPER_POOL_TABLE_COLUMNS.find((c) => c.key === key)!
      expect(col.statLabel, `column ${key} statLabel`).toBeDefined()
      // Must NOT be the same as the abbreviated label — readers shouldn't see "PTS" twice.
      expect(col.statLabel).not.toBe(col.label)
    }
  })

  it('actions column intentionally has no title or statLabel (no hover hint needed)', () => {
    const actions = SLEEPER_POOL_TABLE_COLUMNS.find((c) => c.key === 'actions')!
    expect(actions.title).toBeUndefined()
    expect(actions.statLabel).toBeUndefined()
  })
})

describe('D.4 — cellTooltip helper', () => {
  it('formats integer values with thousands separators', () => {
    expect(cellTooltip('Bijan Robinson', 'rushing yards', 1340)).toBe(
      'Bijan Robinson — rushing yards: 1,340',
    )
  })

  it('formats fractional values to 2 decimals', () => {
    expect(cellTooltip('Joe Burrow', 'fantasy points per game', 17.18)).toBe(
      'Joe Burrow — fantasy points per game: 17.18',
    )
  })

  it('says "no <stat> data available" when value is null', () => {
    expect(cellTooltip('Joe Burrow', 'receiving yards', null)).toBe(
      'Joe Burrow — no receiving yards data available',
    )
  })

  it('says "no data available" for undefined / NaN', () => {
    expect(cellTooltip('Joe Burrow', 'rushing attempts', undefined)).toMatch(/no rushing attempts data available/)
    expect(cellTooltip('Joe Burrow', 'rushing attempts', Number.NaN)).toMatch(/no rushing attempts data available/)
  })

  it('handles empty player name gracefully', () => {
    expect(cellTooltip('', 'rushing yards', 50)).toBe('Player — rushing yards: 50')
  })

  it('matches the user-spec format for each example shape', () => {
    // Spec: "Bijan Robinson rushing yards" — slight delimiter polish, but the substring is preserved.
    expect(cellTooltip('Bijan Robinson', 'rushing yards', 800)).toContain('Bijan Robinson')
    expect(cellTooltip('Bijan Robinson', 'rushing yards', 800)).toContain('rushing yards')
    // Spec: "Joe Burrow passing touchdowns"
    expect(cellTooltip('Joe Burrow', 'passing touchdowns', 32)).toContain('Joe Burrow')
    expect(cellTooltip('Joe Burrow', 'passing touchdowns', 32)).toContain('passing touchdowns')
    // Spec: "No receiving data available" — we say it more explicitly.
    expect(cellTooltip('Joe Burrow', 'receiving yards', null)).toMatch(/no receiving yards data available/)
  })
})

describe('D.4 — SleeperPoolTable wires tooltips onto every stat cell', () => {
  const src = read('components/app/draft-room/SleeperPoolTable.tsx')

  it('imports cellTooltip from the constants module', () => {
    expect(src).toMatch(/import \{[\s\S]*?cellTooltip[\s\S]*?\} from '\.\/SleeperPoolTable\.constants'/)
  })

  it('numeric/stat cells use tipFor or explicit title strings (ADP / BYE / stat cells)', () => {
    const tipForCalls = src.match(/title=\{tipFor\(/g) ?? []
    expect(tipForCalls.length).toBeGreaterThanOrEqual(3)
  })

  it('stat cells pass statLabel + DraftStatColumnDef label into tipFor', () => {
    expect(src).toMatch(/col\.statLabel \?\? def\.label/)
  })

  it('player name cell gets a context-aware title (drafted / available)', () => {
    expect(src).toMatch(/already drafted/)
    expect(src).toMatch(/click row to open detail/)
  })
})

describe('D.4 — header buttons carry full-text tooltip + aria-label', () => {
  const src = read('components/app/draft-room/SleeperPoolTable.tsx')

  it('sortable header buttons set both `title` and `aria-label`', () => {
    expect(src).toMatch(/title=\{buttonTitle\}/)
    expect(src).toMatch(/aria-label=\{col\.title \?\? col\.label\}/)
  })

  it('button title hint reflects the next click direction', () => {
    expect(src).toMatch(/click to sort \$\{ariaSort === 'ascending' \? 'descending' : 'ascending'\}/)
    expect(src).toMatch(/' · click to sort'/)
  })

  it('active sort header carries a non-color cue (underline) — a11y rule', () => {
    // The user spec says: "Do not rely only on color to show active sort."
    expect(src).toMatch(/underline/)
    expect(src).toMatch(/decoration-cyan-300/)
  })

  it('aria-sort still applies after the tooltip changes (D.3 contract intact)', () => {
    expect(src).toMatch(/aria-sort=\{ariaSort\}/)
  })
})

describe('D.4 — drafted / hover / action-button polish preserved', () => {
  const src = read('components/app/draft-room/SleeperPoolTable.tsx')

  it('drafted rows still carry the data attribute + Drafted badge + dimmed text', () => {
    expect(src).toMatch(/data-drafted=\{drafted \? 'true' : 'false'\}/)
    expect(src).toMatch(/text-white\/35/)
    expect(src).toMatch(/Drafted/)
  })

  it('row hover still gets a subtle background lift (Sleeper-style)', () => {
    expect(src).toMatch(/hover:bg-white\/\[0\.05\]/)
  })

  it('action buttons still stop propagation (Compare / Queue / Draft do not open modal)', () => {
    const stops = src.match(/e\.stopPropagation\(\)/g) ?? []
    expect(stops.length).toBeGreaterThanOrEqual(3)
  })
})
