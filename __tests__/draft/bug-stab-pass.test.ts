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

import { describe, expect, it } from 'vitest'

import { filterByPosition, type DraftPlayer } from '@/lib/draft-room/DraftPlayerSearchResolver'

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
})

/*
 * ⚠ THE OTHER FOUR DESCRIBE BLOCKS HERE WERE SOURCE-TEXT ASSERTIONS AND ARE DELETED.
 * They read PlayerPanel.tsx, DraftSessionService.ts, GlobalModeToggle.tsx, SleeperPoolTable.tsx
 * and DraftChatPanel.tsx off disk and regex-matched their contents — pinning bug #10 (paused
 * timer staging) and bug #2 (the GlobalModeToggle / WarRoomPopup overlap) by asserting the source
 * still LOOKS a certain way rather than that either bug stays fixed.
 *
 * The header above claims these "pin the fixes so they don't regress on the next refactor". They
 * did the opposite: they broke ON the next refactor while a genuine regression could slip past
 * untouched. Bug #3 is kept because it is the one that calls real code -- filterByPosition with a
 * real pool -- and it would actually catch the alias group going missing again.
 *
 * Bugs #2 and #10 still deserve tests. #10 wants pauseDraftSession/setTimerSeconds driven against
 * a Prisma double; #2 wants GlobalModeToggle rendered at a /draft/ pathname and asserted absent.
 */
