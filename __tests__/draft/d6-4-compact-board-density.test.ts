/**
 * D.6.4 — Commit 21: Sleeper-style compact board density
 *
 * Source-level assertions that verify the visual-polish pass applied to
 * DraftBoardCell.  No rendering, no DB, no network. (The DraftManagerStrip half
 * went with the component, which nothing rendered.)
 *
 * Goals locked here:
 *   - Board cell height: h-[56px] / sm:h-[60px] (was 42/44px — raised for readability).
 *   - Amber glow (draft-live-current-pick) class on current-pick cell.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..', '..')
function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

const cellSrc = read('components/app/draft-room/DraftBoardCell.tsx')
const boardSrc = read('components/app/draft-room/DraftBoard.tsx')

// ---------------------------------------------------------------------------
// 6. DraftBoardCell shape
// ---------------------------------------------------------------------------

describe('DraftBoardCell — room v2 rectangle tiles', () => {
  it('uses full-width rectangle tiles of one fixed height (room v2, 2026-11)', () => {
    expect(cellSrc).toMatch(/flex h-\[68px\] w-full flex-col/)
    expect(cellSrc).not.toMatch(/aspect-square/)
  })

  it('board columns fill the width with a 84px floor, and gaps are 4px', () => {
    // Phones cap the track via --af-board-col-max (2026-10-29); md+ leaves it unset, so 1fr fills.
    expect(boardSrc).toMatch(/const BOARD_COLUMN = 'minmax\(84px, var\(--af-board-col-max, 1fr\)\)'/)
    expect(boardSrc).toMatch(/grid gap-\[4px\]/)
  })

  it('filled tiles are solid position colours with dark text', () => {
    expect(cellSrc).toMatch(/positionTintHex\(pick\.position, sportNorm\)/)
    expect(cellSrc).toMatch(/\{ backgroundColor: fillHex \}/)
    expect(cellSrc).toMatch(/text-\[#14172a\]/)
  })
})

// ---------------------------------------------------------------------------
// 8. Current-pick amber glow class
// ---------------------------------------------------------------------------

describe('DraftBoardCell — current-pick glow (Commit 21; cyan since room v2)', () => {
  it('cells carry draft-live-current-pick class when isCurrentPick', () => {
    expect(cellSrc).toMatch(/draft-live-current-pick/)
  })

  it('data-current="true" attribute is set on the current pick cell', () => {
    expect(cellSrc).toMatch(/data-current=\{isCurrentPick \? 'true' : 'false'\}/)
  })

  it('the current pick is the v2 cyan clock tile with an "On the clock" label, not a gold fill', () => {
    expect(cellSrc).toMatch(/ring-2 ring-cyan-300/)
    expect(cellSrc).toMatch(/draft-board-cell-on-clock-\$\{pick\.overall\}/)
    expect(cellSrc).not.toMatch(/ring-\[#f6c445\]/)
  })
})
