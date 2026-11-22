// @vitest-environment jsdom
/**
 * Every League Settings sub-page is drawn in one style that follows the viewer's theme. The older
 * editors use fixed dark-navy Tailwind colours; `components/league/league-admin.css` maps them onto
 * AF Core tokens inside `.af-league-admin`. Measured in Chromium against the real Tailwind output:
 * on the light theme the saved / error / warning notes went from 1.3–1.8:1 contrast to ~5.4:1, and
 * the main button became the same accent button as the rest of the app.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import { LeagueSettingsHome } from '@/components/league-settings/home/LeagueSettingsHome'
import { CommissionerCenter } from '@/components/league-settings/home/CommissionerCenter'
import type { SettingsHomeSection } from '@/lib/league-settings-home/buildLeagueSettingsHome'

afterEach(() => cleanup())

const css = readFileSync(join(process.cwd(), 'components/league/league-admin.css'), 'utf8')
const block = css.slice(css.indexOf('One visual style across League Settings'))

const sections: SettingsHomeSection[] = [
  { id: 'draft', title: 'Draft', rows: [{ id: 'draft-shape', label: 'Draft', value: 'Snake', target: 'draft' }] },
]
const renderSubPage = () => ({ title: 'Draft', content: <p>editor</p> })

describe('one visual style across League Settings', () => {
  it('maps the status colours and the main button onto theme tokens', () => {
    expect(block).toMatch(/text-emerald-[^{]*\{ color: var\(--good\)/)
    expect(block).toMatch(/text-red-[^{]*\{ color: var\(--bad\)/)
    expect(block).toMatch(/text-amber-[^{]*\{ color: var\(--warn\)/)
    expect(block).toMatch(/bg-cyan-600\/80[^{]*\{\s*background: var\(--accent\)/)
  })

  it('never matches a hover: / focus: variant, which would apply all the time', () => {
    // `[class*='border-cyan-']` would also match `focus:border-cyan-500` and paint every input
    // accent while unfocused. Each substring match must be anchored: `^=` or a leading space.
    const unanchored = [...block.matchAll(/\[class\*='([^']*)'\]/g)].map((m) => m[1]).filter((v) => !v.startsWith(' '))
    expect(unanchored).toEqual([])
  })

  it('wraps the phone sub-page and the desktop pane in the theme bridge', () => {
    render(<LeagueSettingsHome sections={sections} canEdit renderSubPage={renderSubPage} />)
    fireEvent.click(screen.getByTestId('lsh-row-draft-shape'))
    expect(screen.getByText('editor').closest('.af-league-admin')).not.toBeNull()
    cleanup()

    render(
      <CommissionerCenter
        sections={sections}
        renderSubPage={renderSubPage}
        inSeason={false}
        managers={{ joined: 0, total: 4, inviteUrl: null }}
      />,
    )
    expect(screen.getByText('editor').closest('.af-league-admin')).not.toBeNull()
  })
})
