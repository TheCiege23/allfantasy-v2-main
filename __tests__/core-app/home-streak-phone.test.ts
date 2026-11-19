/**
 * Home step 2 of 3 (2026-11-07): the streak card drops its seven week dots on a phone. Re-landed alone
 * after #3332 was reverted for a home freeze, so this piece can be checked live on its own.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('streak card on a phone', () => {
  it('hides the week dots in a top-level phone query, and nothing else', () => {
    const css = readFileSync(resolve(process.cwd(), 'components/core-app/home/af-streak.css'), 'utf8').replace(/\r\n/g, '\n')
    const block = /@media \(max-width: 640px\) \{\s*\.af-streak-week \{\s*display: none;\s*\}\s*\.af-streak-glance \{\s*margin-top: 8px;\s*\}\s*\}/
    expect(css).toMatch(block)
    const before = css.slice(0, css.search(block))
    expect((before.match(/\{/g) ?? []).length).toBe((before.match(/\}/g) ?? []).length)
  })
})
