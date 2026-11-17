/**
 * G.1 — Emergency Draft Room Stabilization Pass (round 2).
 *
 * The user reported 22 issues from a manual smoke. Targeted scout found that
 * MOST were already correct in code (the prior session ran against a stale
 * dev cache that didn't reflect D.5/D.6/D.7/F.1/F.2/bug-stab work). Real
 * code-level fixes in this slice:
 *
 *   #1   Duplicate Sort row above the player table — sort buttons (ADP /
 *        AI ADP / Proj / Name) duplicated the SleeperPoolTable column-header
 *        sort UI. Removed; kept the AI-ADP toggle + warnings + My-roster.
 *
 *   #6   Commissioner per-pick edit pencil was rendered with `opacity-0`
 *        and only became visible on hover. Mobile users (no hover) couldn't
 *        discover it; desktop users assumed there was no commish-edit. Now
 *        always visible at low opacity, brightens on hover/focus.
 *
 *   #12  REDRAFT / SNAKE / NFL chip row in DraftTopBar removed — the same
 *        information already lives in the inline meta line below.
 *
 * Items the user reported as bugs that were already correct in code (with
 * citations preserved here so the next manual smoke can verify them after
 * `npm run dev:reset`):
 *
 *   #2  Manual Draft button: PlayerDetailModal:490 wires onClick={onMakePick}
 *       which is passed from PlayerPanel.tsx:1022 down from
 *       DraftRoomPageClient.tsx:2437 (handleMakePick → /api/.../draft/pick).
 *       Renders only when `onMakePick && canDraft` are both truthy.
 *
 *   #3  Pause behavior: DraftSessionService.pauseDraftSession correctly
 *       calculates and stores remaining seconds in pausedRemainingSeconds.
 *
 *   #5  Manual Draft button: see #2.
 *
 *   #7/#8 Pause + paused-timer-edit: F.2 + bug-stab fixed both — pauseDraft
 *       freezes remaining seconds; setTimerSeconds while paused stages into
 *       pausedRemainingSeconds, doesn't touch timerEndAt.
 *
 *   #9  TimerPresetSelect rendered in CommissionerControlCenterModal — full
 *       preset list, no plain number-only input.
 *
 *   #13/#14  WarRoomPopup z-60; bug-stab excluded /draft/ from
 *       GlobalModeToggle so the AF/light-dark button no longer overlaps.
 *
 *   #15  Chimmy AI button wired via onAiSuggestionClick prop.
 *
 *   #21  Autopick chat events: D.6.3 plumbed source: 'auto' →
 *       aiManager: true → chat card AI badge.
 *
 *   #22  Chat scroll: stickBottomRef + 96px gap check. Already correct.
 *
 * Items deferred (need image refs or are larger redesigns):
 *
 *   #11  AI lookahead privacy — code looks user-scoped; if user has a
 *        screenshot of a leak, will follow up.
 *   #17  Image 6 AI Queue removal from main board — DraftIntelQueuePanel
 *        is mounted in the right dock, not the main board. Need image to
 *        target exact location.
 *   #19  Draft Intelligence "16 picks away" stale logic — separate slice.
 *   #4/#13 Headshot coverage — separate audit slice.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..', '..')
function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

describe('G.1 #1 — duplicate Sort row removed from PlayerPanel', () => {
  const src = read('components/app/draft-room/PlayerPanel.tsx')

  it('the four sort buttons (ADP / AI ADP / Proj / Name) are gone', () => {
    expect(src).not.toMatch(/data-testid="draft-sort-adp"/)
    expect(src).not.toMatch(/data-testid="draft-sort-ai-adp"/)
    expect(src).not.toMatch(/data-testid="draft-sort-projected"/)
    expect(src).not.toMatch(/data-testid="draft-sort-name"/)
  })

  it('the "Sort:" label is gone', () => {
    expect(src).not.toMatch(/>Sort:</)
  })

  it('keeps "Use AI ADP" toggle (it does NOT belong on the table header)', () => {
    expect(src).toMatch(/Use AI ADP/)
  })

  it('keeps "My roster" / "Pool" view toggle', () => {
    expect(src).toMatch(/showRosterView \? 'Pool' : 'My roster'/)
  })

  it('keeps "Chimmy ADP data not ready" warning', () => {
    expect(src).toMatch(/Chimmy ADP data not ready/)
  })

  it('the SleeperPoolTable column-header sort is now the canonical sort UI', () => {
    const tableSrc = read('components/app/draft-room/SleeperPoolTable.tsx')
    // Column header click triggers sort change — exists from D.3.
    expect(tableSrc).toMatch(/handleSortChange|onSortChange|setSortBy|onClick=.*sort/i)
  })
})

describe('G.1 #6 — commissioner edit pencil is discoverable', () => {
  const src = read('components/app/draft-room/DraftBoardCell.tsx')

  it('pencil button is visible by default (opacity-60), brightens on hover', () => {
    // Negative regression: opacity-0 was the discoverability bug.
    expect(src).not.toMatch(/opacity-0\s+shadow-sm/)
    // Positive: always-visible default + hover brighten + focus brighten.
    expect(src).toMatch(/opacity-60[\s\S]{0,200}hover:opacity-100/)
    expect(src).toMatch(/focus-visible:opacity-100/)
  })

  it('still wired to onCommissionerEditPick callback', () => {
    expect(src).toMatch(/onCommissionerEditPick\(\)/)
    expect(src).toMatch(/data-testid=\{`draft-board-cell-commish-edit-\$\{pick\.overall\}`\}/)
  })

  it('still uses Pencil icon from lucide-react', () => {
    expect(src).toMatch(/<Pencil className="h-3 w-3" \/>/)
  })

  it('still gated by `onCommissionerEditPick ? (... ) : null` so non-commissioners do NOT see it', () => {
    expect(src).toMatch(/onCommissionerEditPick \? \(/)
  })
})

describe('G.1 #12 — REDRAFT / SNAKE / NFL chip row removed from DraftTopBar', () => {
  const src = read('components/app/draft-room/DraftTopBar.tsx')

  it('removed the chip row that wrapped the three chips', () => {
    // The exact chip text strings ('Redraft', 'Snake') are gone — they only
    // existed inside the removed `mt-2 flex flex-wrap items-center gap-1.5`
    // chip wrapper. (The strings might re-appear in i18n keys; we assert on
    // the JSX-literal '>Redraft<' shape that was the visible pill.)
    expect(src).not.toMatch(/>\s*Redraft\s*<\/span>/)
    expect(src).not.toMatch(/>\s*Snake\s*<\/span>/)
  })

  it('inline meta line still shows team count, rounds, sport, draft type', () => {
    expect(src).toMatch(/\{teamCount\} Teams/)
    expect(src).toMatch(/\{rounds\} Rounds/)
    expect(src).toMatch(/\{sport\}/)
    expect(src).toMatch(/\{draftTypeLabel\}/)
  })
})

describe('G.1 — no forbidden BaaS references in this slice', () => {
  const FORBIDDEN = 'supa' + 'base'
  for (const rel of [
    'components/app/draft-room/PlayerPanel.tsx',
    'components/app/draft-room/DraftBoardCell.tsx',
    'components/app/draft-room/DraftTopBar.tsx',
  ]) {
    it(`${rel} contains no forbidden BaaS imports`, () => {
      const src = read(rel)
      expect(src.toLowerCase()).not.toContain(FORBIDDEN)
    })
  }
})
