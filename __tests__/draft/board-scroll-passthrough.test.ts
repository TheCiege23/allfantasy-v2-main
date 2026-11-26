/**
 * 🛑 THE DRAFT BOARD COULD NOT BE SCROLLED, ON PHONE OR PC (owner + a member, 2026-11-24).
 *
 * The board sits in two nested scroll boxes: the shell's `draft-premium-board-zone` (the one that really
 * scrolls) and, inside it, a wrapper exactly as tall as the board. The wrapper carried `overscroll-contain`,
 * so every wheel tick and swipe that started on the board stopped there — it could not scroll and would not
 * hand the gesture up — and rounds below the fold were unreachable. Measured on production: 5 wheel ticks
 * left the zone at scrollTop 0; with the wrapper's overscroll set to auto, the same ticks scrolled 404px.
 *
 * jsdom does no layout or scroll chaining, so this pins the markup. It reads the wrapper's own opening tag
 * (found by its test id), never the comment above it that explains the bug.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const src = readFileSync(path.join(process.cwd(), 'components/app/draft-room/DraftRoomPageClient.tsx'), 'utf8')
const shell = readFileSync(path.join(process.cwd(), 'components/app/draft-room/DraftRoomShell.tsx'), 'utf8')

function openingTag(source: string, testId: string): string {
  const at = source.search(new RegExp(`^\\s*<div[^>\\n]*data-testid="${testId}"`, 'm'))
  expect(at, `no <div data-testid="${testId}"> in source`).toBeGreaterThanOrEqual(0)
  return source.slice(at, source.indexOf('>', at) + 1)
}

describe('draft board scroll', () => {
  it('🛑 the wrapper inside the board zone passes wheel and swipe up to the zone', () => {
    const tag = openingTag(src, 'draft-board-scroll-passthrough')
    expect(tag).not.toMatch(/overscroll-(contain|none)/)
    // It must wrap the board itself.
    expect(src.slice(src.indexOf('data-testid="draft-board-scroll-passthrough"'), src.indexOf('data-testid="draft-board-scroll-passthrough"') + 200)).toContain('<DraftBoard')
  })

  it('the zone itself stays the scroller, and keeps contain (it does scroll)', () => {
    expect(shell).toMatch(/'min-h-\[160px\] overflow-auto overscroll-contain \[overflow-anchor:none\] border-b'/)
    expect(shell).toContain('data-testid="draft-premium-board-zone"')
  })
})
