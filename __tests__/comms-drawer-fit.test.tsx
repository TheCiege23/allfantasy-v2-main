import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { LeagueScopePicker, SEARCH_FROM_LEAGUES } from '@/components/core-app/comms/LeagueScopePicker'

/**
 * The comms drawer on a phone and docked on a desktop (owner, 2026-09-24: "looks bad on mobile
 * and PC"). The docked panel is 352–392px on a screen far wider than 520px, so a compact layout
 * keyed on the SCREEN never reached it: tabs overflowed their track, "Find a lea", a two-line
 * footer. These pin the parts of the fix a later layer could quietly undo.
 */

const leagues = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `L${i}`, name: `League ${i}`, platform: 'sleeper' })) as never

describe('the league filter box', () => {
  it('is left out beside a short dropdown, where it filtered nothing and read "Find a lea"', () => {
    render(<LeagueScopePicker leagues={leagues(SEARCH_FROM_LEAGUES - 1)} value={null} onChange={() => {}} allowGlobal />)
    expect(screen.queryByRole('searchbox', { name: 'Filter leagues' })).toBeNull()
    expect(screen.getByRole('combobox', { name: 'League scope' })).toBeTruthy()
  })

  it('is there for the long list it exists for', () => {
    render(<LeagueScopePicker leagues={leagues(SEARCH_FROM_LEAGUES)} value={null} onChange={() => {}} allowGlobal />)
    expect(screen.getByRole('searchbox', { name: 'Filter leagues' })).toBeTruthy()
  })
})

describe('the drawer stylesheet', () => {
  const css = readFileSync(join(process.cwd(), 'components/core-app/af-comms.css'), 'utf8')
  // Rules only: a comment line starts with `*` or `/*`, so anchoring to a line start that is a
  // selector keeps a sentence ABOUT a rule from satisfying the test.
  const compact = css.slice(css.lastIndexOf('@container af-cm (max-width: 520px)'))

  it('makes the PANEL the size container, so docked-on-desktop gets the compact layout', () => {
    expect(css).toMatch(/^\.af-cm \{ container: af-cm \/ inline-size; \}$/m)
    expect(css.lastIndexOf('@container af-cm (max-width: 520px)')).toBeGreaterThan(-1)
  })

  it('lays the five tabs out as five equal columns, and stacks icon over label when compact', () => {
    expect(css).toMatch(/^\.af-cm-tabs \{ display: grid; grid-template-columns: repeat\(5, minmax\(0, 1fr\)\); \}$/m)
    expect(compact).toMatch(/^\s+\.af-cm-tab \{ flex-direction: column;/m)
  })

  it('gives the composer no resize grip and a send button that is not stretched', () => {
    expect(css).toMatch(/^\.af-cm \.af-cm-input \{ resize: none; field-sizing: content;/m)
    expect(css).toMatch(/^\.af-cm-composer \{ align-items: flex-end; \}$/m)
  })
})
