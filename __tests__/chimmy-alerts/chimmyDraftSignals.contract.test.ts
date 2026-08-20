import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// __tests__/chimmy-alerts → repo root is two levels up (not three).
const root = resolve(__dirname, '../..')

describe('Phase 5F Chimmy draft signals', () => {
  it('hydrator delegates draft slice to loadChimmyDraftSignalSlice', () => {
    const hydrator = readFileSync(resolve(root, 'lib/chimmy-alerts/ChimmyAlertSignalHydrator.ts'), 'utf8')
    expect(hydrator).toMatch(/loadChimmyDraftSignalSlice/)
    expect(hydrator).not.toMatch(/draftRoomStateRow\.findFirst/)
  })

  it('chimmyDraftSignals prefers DraftSession branch before legacy fallback', () => {
    const src = readFileSync(resolve(root, 'lib/chimmy-alerts/chimmyDraftSignals.ts'), 'utf8')
    expect(src).toMatch(/draftSession\.findUnique/)
    expect(src).toMatch(/draftRoomStateRow\.findFirst/)
    expect(src).toMatch(/chimmy_legacy_draft_signal_fallback/)
  })
})
