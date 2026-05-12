/**
 * Draft Room Bug Stabilization Pass — regression tests for the 3 real bugs.
 *
 * Triage of the 13 reported items found 10 already-correct (covered elsewhere
 * by D.5/D.6/D.7/F.1/F.2 tests) and 3 actual code bugs:
 *
 *   #3  DEF/DST position-pill filter returned 0 — alias group missing.
 *   #10 Paused timer countdown started immediately when commissioner changed
 *       the timer length — should have been staged into pausedRemainingSeconds.
 *   #2  GlobalModeToggle's fixed bottom-4 right-4 button overlapped the
 *       WarRoomPopup trigger at the same coordinates — /draft/ was missing
 *       from the toggle's pathname exclusion list.
 *
 * These tests pin the fixes so they don't regress on the next refactor.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { filterByPosition, type DraftPlayer } from '@/lib/draft-room/DraftPlayerSearchResolver'

const root = resolve(__dirname, '..', '..')
function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

const POOL: DraftPlayer[] = [
  { name: 'Bijan Robinson', position: 'RB', team: 'ATL', adp: 4 },
  { name: 'CeeDee Lamb', position: 'WR', team: 'DAL', adp: 9 },
  // Pool emits 'DEF' for team defenses (Sleeper convention).
  { name: 'Denver Defense', position: 'DEF', team: 'DEN', adp: 145 },
  { name: 'Philadelphia Defense', position: 'DEF', team: 'PHI', adp: 152 },
  // Some legacy/external feeds use 'DST' or 'D/ST' — the alias group must
  // accept these too so a single click returns the same set.
  { name: 'Pittsburgh Defense', position: 'DST', team: 'PIT', adp: 158 },
  { name: 'Baltimore Defense', position: 'D/ST', team: 'BAL', adp: 161 },
]

describe('bug-stab #3 — DEF/DST position pill returns defense rows', () => {
  it("clicking the 'DEF' pill returns all defenses regardless of upstream label", () => {
    const filtered = filterByPosition(POOL, 'DEF')
    expect(filtered.map((p) => p.name).sort()).toEqual([
      'Baltimore Defense',
      'Denver Defense',
      'Philadelphia Defense',
      'Pittsburgh Defense',
    ])
  })

  it("clicking the 'DST' pill returns the same set (NFL standard slot label)", () => {
    const filtered = filterByPosition(POOL, 'DST')
    expect(filtered.map((p) => p.name).sort()).toEqual([
      'Baltimore Defense',
      'Denver Defense',
      'Philadelphia Defense',
      'Pittsburgh Defense',
    ])
  })

  it("'D/ST' (legacy slash variant) also matches the alias group", () => {
    const filtered = filterByPosition(POOL, 'D/ST')
    expect(filtered).toHaveLength(4)
  })

  it('case-insensitive — lowercase "def" input still hits the alias group', () => {
    // The fix uppercases the filter key before checking DEFENSE_POSITIONS, so
    // a stray lowercase pill value (e.g. from a future i18n bug) still works.
    const filtered = filterByPosition(POOL, 'def')
    expect(filtered).toHaveLength(4)
  })

  it('regression guard — non-defense filters still work (RB returns just RBs)', () => {
    expect(filterByPosition(POOL, 'RB').map((p) => p.name)).toEqual(['Bijan Robinson'])
    expect(filterByPosition(POOL, 'WR').map((p) => p.name)).toEqual(['CeeDee Lamb'])
  })

  it('PlayerPanel pill-count logic also collapses the alias group', () => {
    const src = read('components/app/draft-room/PlayerPanel.tsx')
    // Available-count branch — explicitly handles all three forms.
    expect(src).toMatch(/v === 'DEF' \|\| v === 'DST' \|\| v === 'D\/ST'/)
    // Drafted-count branch sums across the three buckets so the badge isn't
    // 0 when the user already drafted Denver Defense (saved as 'DEF').
    expect(src).toMatch(/draftedByPos\.DEF \?\? 0\) \+ \(draftedByPos\.DST \?\? 0\) \+ \(draftedByPos\['D\/ST'\] \?\? 0/)
  })
})

describe('bug-stab #10 — paused-timer countdown stays frozen until resume', () => {
  // Static-source assertions: the engine fix lives in setTimerSeconds. Setting
  // up a real Prisma session and calling setTimerSeconds in-process would
  // require a test DB. The structural assertion guards the logic shape.
  const src = read('lib/live-draft-engine/DraftSessionService.ts')

  it("when paused, setTimerSeconds writes pausedRemainingSeconds and does NOT touch timerEndAt", () => {
    // Scope the assertions to the setTimerSeconds function specifically — the
    // file has multiple `session.status === 'paused'` branches (resetTimer
    // also has one, by design). Match from `setTimerSeconds(` through its
    // closing brace via `await prisma.draftSession.update` of the same scope.
    const setTimerFn = src.match(
      /export async function setTimerSeconds\([\s\S]*?(?=export async function undoLastPick)/,
    )
    expect(setTimerFn, 'setTimerSeconds function must exist').not.toBeNull()
    const fnBody = setTimerFn![0]

    // The fix: paused branch stages into pausedRemainingSeconds.
    expect(fnBody).toMatch(/if \(session\.status === 'paused'\) \{[\s\S]*?data\.pausedRemainingSeconds = sec/)

    // Extract the paused branch body and assert it does NOT touch timerEndAt.
    const pausedBlock = fnBody.match(
      /if \(session\.status === 'paused'\) \{([\s\S]*?)\n {4}\} else \{/,
    )
    expect(pausedBlock, 'paused branch must exist as a distinct if/else split').not.toBeNull()
    expect(pausedBlock![1]).not.toMatch(/data\.timerEndAt\s*=/)
  })

  it("when in_progress, setTimerSeconds DOES restart timerEndAt (live behavior preserved)", () => {
    expect(src).toMatch(/} else \{[\s\S]*?data\.timerEndAt = new Date\(Date\.now\(\) \+ sec \* 1000\)/)
  })

  it('resumeDraft consumes pausedRemainingSeconds first when positive (so the staged value applies)', () => {
    // hasUsableRemaining guards the stored seconds: > 0 prevents a 0-value
    // (timer expired before pause) from producing a 1-second timerEndAt on resume.
    // changed-while-paused → resume picks up the new positive value.
    expect(src).toMatch(/hasUsableRemaining/)
    expect(src).toMatch(/session\.pausedRemainingSeconds > 0/)
    expect(src).toMatch(/sec = hasUsableRemaining \? session\.pausedRemainingSeconds/)
  })
})

describe('bug-stab #2 — GlobalModeToggle excludes /draft/ to free the War Room corner', () => {
  const src = read('components/theme/GlobalModeToggle.tsx')

  it('explicitly returns null on /draft/* so the bottom-right corner is free for WarRoomPopup', () => {
    expect(src).toMatch(/pathname\?\.startsWith\("\/draft\/"\)/)
  })

  it('still excludes the original list (admin, dashboard, league)', () => {
    expect(src).toMatch(/pathname\?\.startsWith\("\/admin"\)/)
    expect(src).toMatch(/pathname\?\.startsWith\("\/dashboard"\)/)
    expect(src).toMatch(/pathname\?\.startsWith\("\/league\/"\)/)
  })
})

describe('bug-stab — NO-OP confirmations (line citations for the manual smoke report)', () => {
  it('Queue button is rendered in SleeperPoolTable rows (Plus icon, aria-label, testid)', () => {
    const src = read('components/app/draft-room/SleeperPoolTable.tsx')
    expect(src).toMatch(/aria-label=\{`Queue \$\{p\.name\}`\}/)
    expect(src).toMatch(/<Plus className="h-3\.5 w-3\.5" \/>/)
    // The button calls onAddToQueue(p) — wired up at the row level (not inside
    // the popup), so the user can queue without opening the modal.
    expect(src).toMatch(/onAddToQueue\(\)/)
  })

  it('Rookies Only toggle has a stable testid in PlayerPanel', () => {
    const src = read('components/app/draft-room/PlayerPanel.tsx')
    expect(src).toMatch(/data-testid="draft-filter-rookies-only"/)
  })

  it('SleeperPoolTable shows ADP from p.adp with em-dash fallback', () => {
    const src = read('components/app/draft-room/SleeperPoolTable.tsx')
    expect(src).toMatch(/const adpDisplay = p\.adp != null \? p\.adp\.toFixed\(1\) : '—'/)
    expect(src).toMatch(/data-testid=\{`\$\{testIdBase\}-adp`\}/)
  })

  it('DraftChatPanel scroll-pinning respects user manual scroll-up', () => {
    const src = read('components/app/draft-room/DraftChatPanel.tsx')
    // stickBottomRef tracks scroll position; only auto-scrolls when pinned.
    expect(src).toMatch(/const stickBottomRef = useRef\(true\)/)
    expect(src).toMatch(/if \(!stickBottomRef\.current\) return/)
    // 96px threshold for "near bottom" (gap < 96 → still pinned).
    expect(src).toMatch(/stickBottomRef\.current = gap < 96/)
  })

  it('autopick path forwards source: "auto" so chat-card AI badge fires', () => {
    const src = read('lib/live-draft-engine/autopickBestAvailableSubmit.ts')
    expect(src).toMatch(/source: 'auto'/)
  })
})
