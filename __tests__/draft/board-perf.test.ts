/**
 * P1 Fix #9 — Draft board performance invariants
 *
 * Verifies that large dynasty, devy, C2C, and multi-sport draft boards remain
 * smooth with many teams, many rounds, and hundreds of picks.
 *
 * Concrete issues this fix addresses:
 *
 *   1. session.picks received a new array reference on every 8-second poll (because
 *      timerEndAt changes → new session object → new picks array) even when no new
 *      picks had landed. This bypassed DraftBoard.React.memo on every timer tick,
 *      triggering a full boardRowsByRoundAndSlot recompute and re-rendering all
 *      N×M cells. Fixed: boardPicks useMemo in DraftRoomPageClient fingerprints on
 *      picks.length + lastPickOverall; timer-only polls return the same reference.
 *
 *   2. The per-cell render loop called picks.find() — O(N) per cell — to check
 *      emptiness and drive pickHighlight. For a 20-team × 25-round board that's
 *      500 × 500 = 250,000 iterations per re-render. Fixed: isPickEditorEmpty and
 *      pickedByRosterId are now pre-computed in boardRowsByRoundAndSlot (O(N total))
 *      and stored in SequentialBoardEntry; the render loop uses them directly.
 *
 *   3. The sticky team header re-rendered on every parent update. Fixed: extracted
 *      as BoardTeamHeader = React.memo; only re-renders when currentOwnerSlot or
 *      orderedSlots change (i.e., when it's a new team's turn).
 *
 *   4. Inline onOpenTradeHistory and onViewCellTradeHistory lambdas in DraftRoomPageClient
 *      gave DraftBoard.React.memo a new function identity on every parent render,
 *      bypassing the memo guard. Fixed: both wrapped in useCallback with empty deps
 *      (React setState dispatches are stable — no deps needed).
 *
 *   5. DraftTeamStrip was a plain function component, causing it to re-render on every
 *      parent render even when no team meta had changed. Fixed: wrapped in React.memo.
 *
 *   6. boardRowsByRoundAndSlot preserves Map identity for rounds whose cell data has
 *      not changed via a per-round Map stability cache (roundMapCacheRef). When a
 *      single new pick lands, only the affected round's Map reference changes.
 *
 * All assertions are static-source (no JSDOM, no DB, no network).
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..', '..')
// Normalize CRLF → LF so all indexOf/regex patterns work on Windows
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8').replace(/\r\n/g, '\n')

const boardSrc = read('components/app/draft-room/DraftBoard.tsx')
const stripSrc = read('components/app/draft-room/DraftTeamStrip.tsx')
const pageSrc = read('components/app/draft-room/DraftRoomPageClient.tsx')

// ---------------------------------------------------------------------------
// 1. boardPicks stable fingerprint (DraftRoomPageClient)
// ---------------------------------------------------------------------------

describe('P1 Fix #9 — boardPicks stable reference in DraftRoomPageClient', () => {
  it('declares boardPicks with useMemo', () => {
    expect(pageSrc).toMatch(/const boardPicks = useMemo\(/)
  })

  it('boardPicks fingerprint uses picks length', () => {
    const idx = pageSrc.indexOf('const boardPicks = useMemo(')
    expect(idx).toBeGreaterThan(-1)
    // The fingerprint variables are declared just above the useMemo call
    const window = pageSrc.slice(idx - 600, idx + 300)
    expect(window).toMatch(/_boardPicksLength/)
  })

  it('boardPicks fingerprint uses last-pick overall', () => {
    const idx = pageSrc.indexOf('const boardPicks = useMemo(')
    const window = pageSrc.slice(idx - 600, idx + 300)
    expect(window).toMatch(/_boardPicksLastOverall/)
  })

  it('boardPicks fingerprint reads last pick overall from session.picks', () => {
    const idx = pageSrc.indexOf('const boardPicks = useMemo(')
    const window = pageSrc.slice(idx - 600, idx + 300)
    expect(window).toMatch(/\.overall/)
  })

  it('DraftBoard receives boardPicks (not session.picks)', () => {
    // The DraftBoard render must not contain session.picks as a direct prop value
    const boardIdx = pageSrc.indexOf('<DraftBoard')
    expect(boardIdx).toBeGreaterThan(-1)
    const block = pageSrc.slice(boardIdx, boardIdx + 1200)
    expect(block).toMatch(/picks=\{boardPicks\}/)
    expect(block).not.toMatch(/picks=\{session\.picks/)
  })
})

// ---------------------------------------------------------------------------
// 2. Stable DraftBoard callbacks (DraftRoomPageClient)
// ---------------------------------------------------------------------------

describe('P1 Fix #9 — stable DraftBoard trade-history callbacks', () => {
  it('handleOpenTradeHistory is defined with useCallback', () => {
    expect(pageSrc).toMatch(/const handleOpenTradeHistory = useCallback\(/)
  })

  it('handleViewCellTradeHistory is defined with useCallback', () => {
    expect(pageSrc).toMatch(/const handleViewCellTradeHistory = useCallback\(/)
  })

  it('handleOpenTradeHistory calls setTradeHistoryFocus(null)', () => {
    const idx = pageSrc.indexOf('const handleOpenTradeHistory = useCallback(')
    const block = pageSrc.slice(idx, idx + 300)
    expect(block).toMatch(/setTradeHistoryFocus\(null\)/)
  })

  it('handleViewCellTradeHistory sets round and originalRosterId on tradeHistoryFocus', () => {
    const idx = pageSrc.indexOf('const handleViewCellTradeHistory = useCallback(')
    const block = pageSrc.slice(idx, idx + 400)
    expect(block).toMatch(/round/)
    expect(block).toMatch(/originalRosterId/)
  })

  it('DraftBoard render uses handleOpenTradeHistory (not an inline lambda)', () => {
    const boardIdx = pageSrc.indexOf('<DraftBoard')
    // The DraftBoard JSX block has many long props — use 2500 chars to reach onOpenTradeHistory
    const block = pageSrc.slice(boardIdx, boardIdx + 2500)
    expect(block).toMatch(/onOpenTradeHistory=\{handleOpenTradeHistory\}/)
    expect(block).not.toMatch(/onOpenTradeHistory=\{[^}]*=>/)
  })

  it('DraftBoard render uses handleViewCellTradeHistory (not an inline lambda)', () => {
    const boardIdx = pageSrc.indexOf('<DraftBoard')
    const block = pageSrc.slice(boardIdx, boardIdx + 2500)
    expect(block).toMatch(/onViewCellTradeHistory=\{handleViewCellTradeHistory\}/)
    expect(block).not.toMatch(/onViewCellTradeHistory=\{[^}]*=>/)
  })
})

// ---------------------------------------------------------------------------
// 3. SequentialBoardEntry — pre-computed cell fields
// ---------------------------------------------------------------------------

describe('P1 Fix #9 — SequentialBoardEntry pre-computed fields', () => {
  it('SequentialBoardEntry includes isPickEditorEmpty field', () => {
    const entryStart = boardSrc.indexOf('type SequentialBoardEntry =')
    expect(entryStart).toBeGreaterThan(-1)
    const entryBlock = boardSrc.slice(entryStart, entryStart + 400)
    expect(entryBlock).toMatch(/isPickEditorEmpty:\s*boolean/)
  })

  it('SequentialBoardEntry includes pickedByRosterId field', () => {
    const entryStart = boardSrc.indexOf('type SequentialBoardEntry =')
    const entryBlock = boardSrc.slice(entryStart, entryStart + 400)
    expect(entryBlock).toMatch(/pickedByRosterId:\s*string \| null/)
  })

  it('boardRowsByRoundAndSlot sets isPickEditorEmpty on each entry', () => {
    const memoStart = boardSrc.indexOf('const boardRowsByRoundAndSlot = useMemo(')
    expect(memoStart).toBeGreaterThan(-1)
    // The useMemo body is large (many board-computation lines); use 6000 chars to reach the new fields
    const memoBlock = boardSrc.slice(memoStart, memoStart + 6000)
    expect(memoBlock).toMatch(/isPickEditorEmpty/)
    // Must be computed using isDraftPickRowEmptyFromSnapshot (existing emptiness logic)
    expect(memoBlock).toMatch(/isDraftPickRowEmptyFromSnapshot/)
  })

  it('boardRowsByRoundAndSlot sets pickedByRosterId from existing.rosterId', () => {
    const memoStart = boardSrc.indexOf('const boardRowsByRoundAndSlot = useMemo(')
    const memoBlock = boardSrc.slice(memoStart, memoStart + 6000)
    expect(memoBlock).toMatch(/pickedByRosterId:\s*existing\?\.rosterId/)
  })
})

// ---------------------------------------------------------------------------
// 4. No O(N) picks.find() in the per-cell render loop
// ---------------------------------------------------------------------------

describe('P1 Fix #9 — no picks.find() in the sequential board render loop', () => {
  it('picks.find() does not appear in the orderedSlots.map render loop', () => {
    // The sequential render path begins at orderedSlots.map and the cells are rendered
    // via a map over orderedSlots inside each round section. We verify there is no
    // picks.find() between the cell loop and the DraftBoardCell render.
    const loopStart = boardSrc.indexOf('orderedSlots.map((slotEntry) =>')
    expect(loopStart).toBeGreaterThan(-1)
    // The render loop is bounded to 2000 chars which covers a full round's cell grid
    const loopBlock = boardSrc.slice(loopStart, loopStart + 2000)
    // picks.find() must NOT appear in this block
    expect(loopBlock).not.toMatch(/picks\.find\(/)
  })

  it('isPickEditorEmptyCell destructured from cell inside the loop', () => {
    const loopStart = boardSrc.indexOf('orderedSlots.map((slotEntry) =>')
    const loopBlock = boardSrc.slice(loopStart, loopStart + 2000)
    expect(loopBlock).toMatch(/isPickEditorEmpty:\s*isPickEditorEmptyCell/)
  })

  it('pickedByRosterId destructured from cell inside the loop', () => {
    const loopStart = boardSrc.indexOf('orderedSlots.map((slotEntry) =>')
    const loopBlock = boardSrc.slice(loopStart, loopStart + 2000)
    expect(loopBlock).toMatch(/pickedByRosterId/)
  })

  it('DraftBoardCell pickHighlight uses calcPickHighlight(pickedByRosterId) in sequential path', () => {
    const loopStart = boardSrc.indexOf('orderedSlots.map((slotEntry) =>')
    // pickHighlight prop sits after several other DraftBoardCell props — use 3000 chars
    const loopBlock = boardSrc.slice(loopStart, loopStart + 3000)
    expect(loopBlock).toMatch(/calcPickHighlight\(pickedByRosterId\)/)
  })
})

// ---------------------------------------------------------------------------
// 5. Round Map stability cache
// ---------------------------------------------------------------------------

describe('P1 Fix #9 — roundMapCacheRef stabilizes round Maps', () => {
  it('roundMapCacheRef is declared with useRef in DraftBoardInner', () => {
    expect(boardSrc).toMatch(/const roundMapCacheRef = useRef<Map<number, Map<number, SequentialBoardEntry>>>/)
  })

  it('roundMapCacheRef is used inside boardRowsByRoundAndSlot useMemo', () => {
    const memoStart = boardSrc.indexOf('const boardRowsByRoundAndSlot = useMemo(')
    // Cache logic lives after the main loop body — need 7000 chars to reach it
    const memoBlock = boardSrc.slice(memoStart, memoStart + 7000)
    expect(memoBlock).toMatch(/roundMapCacheRef\.current/)
  })

  it('boardRowsByRoundAndSlot preserves previous Map reference for unchanged rounds', () => {
    const memoStart = boardSrc.indexOf('const boardRowsByRoundAndSlot = useMemo(')
    const memoBlock = boardSrc.slice(memoStart, memoStart + 7000)
    // Must compare isPickEditorEmpty to detect unchanged rounds
    expect(memoBlock).toMatch(/isPickEditorEmpty !== entry\.isPickEditorEmpty/)
    // Must assign previous Map when unchanged
    expect(memoBlock).toMatch(/byRoundSlot\[rn\] = prevMap/)
  })
})

// ---------------------------------------------------------------------------
// 6. BoardTeamHeader as React.memo
// ---------------------------------------------------------------------------

describe('P1 Fix #9 — BoardTeamHeader is a memoized component', () => {
  it('BoardTeamHeader is defined with React.memo', () => {
    expect(boardSrc).toMatch(/const BoardTeamHeader = React\.memo\(/)
  })

  it('BoardTeamHeader has a BoardTeamHeaderProps type', () => {
    expect(boardSrc).toMatch(/type BoardTeamHeaderProps =/)
  })

  it('BoardTeamHeaderProps includes orderedSlots, currentOwnerSlot, teamCount, presentationVariant', () => {
    const propsStart = boardSrc.indexOf('type BoardTeamHeaderProps =')
    const propsBlock = boardSrc.slice(propsStart, propsStart + 300)
    expect(propsBlock).toMatch(/orderedSlots/)
    expect(propsBlock).toMatch(/currentOwnerSlot/)
    expect(propsBlock).toMatch(/teamCount/)
    expect(propsBlock).toMatch(/presentationVariant/)
  })

  it('BoardTeamHeader renders the draft-board-team-header testid', () => {
    const headerStart = boardSrc.indexOf('const BoardTeamHeader = React.memo(')
    const headerBlock = boardSrc.slice(headerStart, headerStart + 2500)
    expect(headerBlock).toMatch(/data-testid="draft-board-team-header"/)
  })

  it('DraftBoardInner renders <BoardTeamHeader> instead of the inline sticky div', () => {
    expect(boardSrc).toMatch(/<BoardTeamHeader/)
    // The inline sticky header must be gone from inside DraftBoardInner
    // (it now lives inside the BoardTeamHeader component function above)
    const innerStart = boardSrc.indexOf('function DraftBoardInner(')
    const innerBlock = boardSrc.slice(innerStart)
    // The inline div with sticky + draft-board-team-header should NOT appear inside DraftBoardInner
    expect(innerBlock).not.toMatch(/data-testid="draft-board-team-header"/)
  })
})

// ---------------------------------------------------------------------------
// 7. DraftTeamStrip wrapped in React.memo
// ---------------------------------------------------------------------------

describe('P1 Fix #9 — DraftTeamStrip wrapped in React.memo', () => {
  it('DraftTeamStrip is exported as a React.memo-wrapped component', () => {
    // Must use React.memo (or the memo alias) and export a stable identity
    expect(stripSrc).toMatch(/export const DraftTeamStrip = memo\(|export const DraftTeamStrip = React\.memo\(/)
  })

  it('The inner implementation function is named DraftTeamStripInner', () => {
    expect(stripSrc).toMatch(/function DraftTeamStripInner\(/)
  })

  it('DraftTeamStrip still renders draft-team-strip testid', () => {
    expect(stripSrc).toMatch(/data-testid="draft-team-strip"/)
  })
})

// ---------------------------------------------------------------------------
// 8. DraftBoard still wrapped in React.memo (regression guard)
// ---------------------------------------------------------------------------

describe('P1 Fix #9 — DraftBoard outer export is still React.memo (regression guard)', () => {
  it('DraftBoard export is React.memo(DraftBoardInner)', () => {
    expect(boardSrc).toMatch(/export const DraftBoard = React\.memo\(DraftBoardInner\)/)
  })

  it('DraftBoard still accepts picks, slotOrder, teamCount, rounds props', () => {
    const propsStart = boardSrc.indexOf('export type DraftBoardProps =')
    const propsBlock = boardSrc.slice(propsStart, propsStart + 500)
    expect(propsBlock).toMatch(/picks:\s*DraftPickSnapshot\[\]/)
    expect(propsBlock).toMatch(/slotOrder/)
    expect(propsBlock).toMatch(/teamCount/)
    expect(propsBlock).toMatch(/rounds/)
  })

  it('draft-board-grid testid is preserved', () => {
    expect(boardSrc).toMatch(/data-testid="draft-board-grid"/)
  })

  it('calcPickHighlight function replaces pickHighlight and accepts a rosterId string', () => {
    expect(boardSrc).toMatch(/const calcPickHighlight = \(rosterId: string \| null \| undefined\)/)
    // The old pickHighlight that took a DraftPickSnapshot argument must be gone
    expect(boardSrc).not.toMatch(/const pickHighlight = \(existing: DraftPickSnapshot/)
  })
})
