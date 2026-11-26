/**
 * 🛑 THE TEAM SCREEN PRINTED THE WHOLE LOCK SENTENCE ON EVERY LOCKED ROW (owner report, 2026-11-24). The row
 * now shows a short "until when"; the sentence stays the tooltip, screen-reader text and toast.
 */
import { describe, expect, it } from 'vitest'
import { lockRowLabel } from '@/lib/league/native/lockRowLabel'

describe('lockRowLabel', () => {
  it('maps each reason the server and the screen give to a short label', () => {
    expect(lockRowLabel("This player's first game of the fantasy week has started; he is locked until the week ends.")).toBe('Until next week')
    expect(lockRowLabel("This player's game today has started; he is locked until tomorrow.")).toBe('Until tomorrow')
    expect(lockRowLabel('His game has started.')).toBe('Game started')
    expect(lockRowLabel('Locked for this scoring period.')).toBe('Until next week')
  })
  it('never prints an unknown sentence on the row', () => {
    expect(lockRowLabel('Some brand new reason nobody mapped yet, quite long.')).toBe('For now')
    expect(lockRowLabel(undefined)).toBe('For now')
  })
})
