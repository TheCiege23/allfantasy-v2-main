/**
 * Regression guard for the Draft Room Regression TDZ.
 *
 * `draftRoomState` is a `useMemo` (it depends on ~12 values derived earlier in the
 * component). It was previously USED near the top of `DraftRoomPageClient` (in
 * `startDraftBlocked`, ~L527) but DECLARED far below (~L897) — a temporal dead zone
 * that crashed the draft room at render:
 *   `ReferenceError: Cannot access 'draftRoomState' before initialization`
 * That reddened the required `Draft Room Regression` Playwright job on every branch.
 *
 * A full render test of this ~5,300-line component isn't feasible as a unit test, so
 * this locks the invariant that actually matters: the `draftRoomState` declaration
 * must appear before the first `draftRoomState.<prop>` usage. This is deterministic
 * and catches any re-introduction of the same TDZ.
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

describe('DraftRoomPageClient — draftRoomState declared before first use (no TDZ)', () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), 'components/app/draft-room/DraftRoomPageClient.tsx'),
    'utf8',
  )
  const lines = src.split('\n')

  it('declares the draftRoomState useMemo before any draftRoomState.* usage', () => {
    const declLine = lines.findIndex((l) => /const\s+draftRoomState\s*=/.test(l))
    // First property access, ignoring commented lines (the fix comment mentions it).
    const firstUseLine = lines.findIndex(
      (l) => /draftRoomState\s*\./.test(l) && !/^\s*(\/\/|\*)/.test(l),
    )

    expect(declLine, 'draftRoomState declaration not found').toBeGreaterThanOrEqual(0)
    expect(firstUseLine, 'draftRoomState usage not found').toBeGreaterThanOrEqual(0)
    // Declaration must come before the first use, or it's a temporal-dead-zone crash.
    expect(declLine).toBeLessThan(firstUseLine)
  })
})
