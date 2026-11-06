/**
 * The /core home on a phone leads with work (2026-11-06 phone pass). Live at 375px the first screen was
 * the bracket promo, the setup guide and a two-row streak card, with "16 lineups to fix" below the fold.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')

describe('home leads with work on a phone', () => {
  it('renders the bracket promo after the screen, not above it', () => {
    const shell = read('components/core-app/AfCoreShell.tsx')
    const promo = shell.indexOf('<section className="af-core-bracket-promo"')
    const screen = shell.indexOf('<PlayerCardProvider>{children}</PlayerCardProvider>')
    expect(promo).toBeGreaterThan(-1)
    expect(screen).toBeGreaterThan(-1)
    expect(promo).toBeGreaterThan(screen)
    expect(shell.match(/className="af-core-bracket-promo"/g)).toHaveLength(1)
  })

  it('drops the streak week dots on a phone, in a top-level query', () => {
    const css = read('components/core-app/home/af-streak.css')
    const block = /@media \(max-width: 640px\) \{\s*\.af-streak-week \{\s*display: none;\s*\}/
    expect(css).toMatch(block)
    // Top level: everything before the block closes every brace it opens.
    const before = css.slice(0, css.search(block))
    expect((before.match(/\{/g) ?? []).length).toBe((before.match(/\}/g) ?? []).length)
  })
})
