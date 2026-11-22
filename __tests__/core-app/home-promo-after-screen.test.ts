/**
 * Home step 1 of 3 (2026-11-07): the bracket promo renders after the screen, not above it. Re-landed
 * alone after #3332 was reverted for a home freeze, so this piece can be checked live on its own.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('home leads with work', () => {
  it('renders the bracket promo after the screen, exactly once', () => {
    const shell = readFileSync(resolve(process.cwd(), 'components/core-app/AfCoreShell.tsx'), 'utf8')
    const promo = shell.indexOf('<section className="af-core-bracket-promo"')
    const screen = shell.indexOf('<PlayerCardProvider>{children}</PlayerCardProvider>')
    expect(promo).toBeGreaterThan(-1)
    expect(screen).toBeGreaterThan(-1)
    expect(promo).toBeGreaterThan(screen)
    expect(shell.match(/className="af-core-bracket-promo"/g)).toHaveLength(1)
  })
})
