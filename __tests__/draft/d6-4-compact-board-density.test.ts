/**
 * D.6.4 — Commit 21: Sleeper-style compact board density
 *
 * Source-level assertions that verify the visual-polish pass applied to
 * DraftManagerStrip and DraftBoardCell.  No rendering, no DB, no network.
 *
 * Goals locked here:
 *   1. Manager strip outer padding is compact (pb-1 pt-0.5 / sm:pb-1.5 sm:pt-1).
 *   2. Manager avatar outer container shrank: h-9 w-9 / sm:h-11 sm:w-11.
 *   3. Manager avatar inner circle shrank: h-8 w-8 / sm:h-9 sm:w-9.
 *   4. Manager slot min-width tightened: min-w-[56px] / sm:min-w-[64px].
 *   5. Manager label column narrowed: w-[62px] / sm:w-[70px].
 *   6. Board cell height reduced: h-[42px] / sm:h-[44px].
 *   7. data-testid="draft-manager-strip" wrapper is present.
 *   8. Amber glow (draft-live-current-pick) class on current-pick cell.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..', '..')
function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

const stripSrc = read('components/app/draft-room/DraftManagerStrip.tsx')
const cellSrc = read('components/app/draft-room/DraftBoardCell.tsx')

// ---------------------------------------------------------------------------
// 1. Strip outer wrapper — compact padding
// ---------------------------------------------------------------------------

describe('DraftManagerStrip — compact outer padding (Commit 21)', () => {
  it('outer wrapper uses pb-1 pt-0.5 (reduced from pb-2 pt-1)', () => {
    expect(stripSrc).toMatch(/pb-1 pt-0\.5/)
  })

  it('outer wrapper uses sm:pb-1.5 sm:pt-1 (reduced from sm:pb-2.5 sm:pt-1.5)', () => {
    expect(stripSrc).toMatch(/sm:pb-1\.5 sm:pt-1/)
  })

  it('old padding pb-2 pt-1 is no longer in the outer wrapper', () => {
    // The outer wrapper must not still carry the old padding pair together
    expect(stripSrc).not.toMatch(/pb-2 pt-1 sm:px-3 sm:pb-2\.5/)
  })
})

// ---------------------------------------------------------------------------
// 2. Avatar outer container — smaller dimensions
// ---------------------------------------------------------------------------

describe('DraftManagerStrip — avatar outer container (Commit 21)', () => {
  it('outer container is h-9 w-9 at mobile (reduced from h-11 w-11)', () => {
    expect(stripSrc).toMatch(/flex h-9 w-9 items-center justify-center sm:h-11 sm:w-11/)
  })

  it('outer container is sm:h-11 sm:w-11 (reduced from sm:h-[52px] sm:w-[52px])', () => {
    // The old fixed-pixel class must not appear on the outer container line
    expect(stripSrc).not.toMatch(/sm:h-\[52px\] sm:w-\[52px\]/)
  })
})

// ---------------------------------------------------------------------------
// 3. Avatar inner circle — smaller dimensions
// ---------------------------------------------------------------------------

describe('DraftManagerStrip — avatar inner circle (Commit 21)', () => {
  it('inner circle is h-8 w-8 at mobile (reduced from h-9 w-9)', () => {
    expect(stripSrc).toMatch(/flex h-8 w-8 items-center justify-center overflow-hidden rounded-full/)
  })

  it('inner circle is sm:h-9 sm:w-9 (reduced from sm:h-11 sm:w-11)', () => {
    expect(stripSrc).toMatch(/sm:h-9 sm:w-9/)
  })
})

// ---------------------------------------------------------------------------
// 4. Manager slot min-width — tighter columns
// ---------------------------------------------------------------------------

describe('DraftManagerStrip — slot min-width (Commit 21)', () => {
  it('slot min-w is min-w-[56px] (reduced from min-w-[64px])', () => {
    expect(stripSrc).toMatch(/min-w-\[56px\]/)
  })

  it('slot sm:min-w is sm:min-w-[64px] (reduced from sm:min-w-[70px])', () => {
    expect(stripSrc).toMatch(/sm:min-w-\[64px\]/)
  })

  it('old min-w-[64px] is gone from slot definition', () => {
    // min-w-[64px] must not appear adjacent to min-w-[56px] (no double entry)
    expect(stripSrc).not.toMatch(/min-w-\[64px\] flex-col items-center/)
  })
})

// ---------------------------------------------------------------------------
// 5. Manager label column — narrower
// ---------------------------------------------------------------------------

describe('DraftManagerStrip — label column width (Commit 21)', () => {
  it('label div is w-[62px] (reduced from w-[70px])', () => {
    expect(stripSrc).toMatch(/w-\[62px\]/)
  })

  it('label div is sm:w-[70px] (reduced from sm:w-[78px])', () => {
    // w-[70px] in the label position — adjacent to sm: variant
    expect(stripSrc).toMatch(/w-\[62px\] sm:w-\[70px\]/)
  })
})

// ---------------------------------------------------------------------------
// 6. DraftBoardCell height — tighter tiles
// ---------------------------------------------------------------------------

describe('DraftBoardCell — compact height (Commit 21)', () => {
  it('cell base height is h-[42px] (reduced from h-[44px])', () => {
    expect(cellSrc).toMatch(/h-\[42px\]/)
  })

  it('cell min-height is min-h-[42px]', () => {
    expect(cellSrc).toMatch(/min-h-\[42px\]/)
  })

  it('cell sm height is sm:h-[44px] (reduced from sm:h-[46px])', () => {
    expect(cellSrc).toMatch(/sm:h-\[44px\]/)
  })

  it('cell sm min-height is sm:min-h-[44px]', () => {
    expect(cellSrc).toMatch(/sm:min-h-\[44px\]/)
  })

  it('old h-[44px] base height is gone', () => {
    expect(cellSrc).not.toMatch(/flex h-\[44px\] min-h-\[44px\]/)
  })
})

// ---------------------------------------------------------------------------
// 7. data-testid="draft-manager-strip" wrapper is present
// ---------------------------------------------------------------------------

describe('DraftManagerStrip — testid anchor (Commit 21)', () => {
  it('data-testid="draft-manager-strip" is on the scroll container', () => {
    expect(stripSrc).toMatch(/data-testid="draft-manager-strip"/)
  })

  it('data-testid="draft-manager-strip" is on the flex overflow-x-auto row', () => {
    expect(stripSrc).toMatch(/overflow-x-auto[\s\S]{0,80}data-testid="draft-manager-strip"/)
  })
})

// ---------------------------------------------------------------------------
// 8. Current-pick amber glow class
// ---------------------------------------------------------------------------

describe('DraftBoardCell — current-pick amber glow (Commit 21)', () => {
  it('cells carry draft-live-current-pick class when isCurrentPick', () => {
    expect(cellSrc).toMatch(/draft-live-current-pick/)
  })

  it('data-current="true" attribute is set on the current pick cell', () => {
    expect(cellSrc).toMatch(/data-current=\{isCurrentPick \? 'true' : 'false'\}/)
  })

  it('amber shadow is applied on the current pick cell', () => {
    expect(cellSrc).toMatch(/shadow-\[0_0_4[06]px_rgba\(246,196,69/)
  })
})
