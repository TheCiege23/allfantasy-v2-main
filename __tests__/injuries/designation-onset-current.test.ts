import { describe, expect, it } from 'vitest'

import { designationOnset } from '@/lib/core-app/designationOnset'

/*
 * The current word on the Player Finder and the "Your shares" / game-day lists (injuryClaims.ts).
 *
 * 🛑 It took the freshest row by `fetchedAt` and never read `expiresAt` (2026-10-11), so a player who
 * dropped off every report kept his last "Out" for good, and Rolling Insights re-pulling Friday's
 * "Questionable" every 30 minutes beat ESPN's Sunday "Active".
 */
const now = new Date(Date.UTC(2026, 9, 11, 16))
const H = 3_600_000
const at = (h: number) => new Date(now.getTime() - h * H)

describe('designationOnset — the current word', () => {
  it('a newer report beats a more recently fetched older one', () => {
    const out = designationOnset(
      [
        { status: 'Questionable', description: 'Limited practice Friday.', date: at(50), fetchedAt: at(0.02), expiresAt: at(-6) },
        { status: 'Active', description: null, date: at(3), fetchedAt: at(0.3), expiresAt: at(-6) },
      ],
      now,
    )
    expect(out?.status).toBe('Active')
  })

  it('a row no feed carries any more is not the word: a healed player has none', () => {
    const out = designationOnset([{ status: 'Out', description: 'Knee.', date: at(96), fetchedAt: at(90), expiresAt: at(84) }], now)
    expect(out).toBeNull()
  })

  it('an expired row still dates the episode of a live designation', () => {
    const out = designationOnset(
      [
        { status: 'Out', description: null, date: at(1), fetchedAt: at(0.1), expiresAt: at(-6) },
        { status: 'Out', description: 'Ruled out Friday.', date: at(48), fetchedAt: at(40), expiresAt: at(34) },
      ],
      now,
    )
    expect(out?.status).toBe('Out')
    expect(out?.reportedAt?.toISOString()).toBe(at(48).toISOString())
    expect(out?.description).toBe('Ruled out Friday.')
  })

  it('rows without expiresAt behave as before', () => {
    const out = designationOnset([{ status: 'Doubtful', description: null, date: at(5), fetchedAt: at(1) }], now)
    expect(out?.status).toBe('Doubtful')
  })
})
