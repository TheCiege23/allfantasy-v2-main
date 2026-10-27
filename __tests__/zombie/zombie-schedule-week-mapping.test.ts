// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/workers/api-chain', () => ({ apiChain: {} }))

import { resolveImportedGameWeek } from '@/lib/workers/schedule-importer'

describe('provider game to Zombie scoring week', () => {
  it('keeps a verified NFL provider week', () => {
    expect(resolveImportedGameWeek('NFL', 2026, new Date('2026-09-10T20:00:00Z'), 1)).toBe(1)
    expect(resolveImportedGameWeek('NFL', 2026, new Date('2026-09-17T20:00:00Z'), undefined, 2)).toBe(2)
  })

  it.each([
    ['NBA', '2026-10-20T23:00:00Z', '2026-10-27T23:00:00Z'],
    ['NHL', '2026-09-29T23:00:00Z', '2026-10-06T23:00:00Z'],
    ['MLB', '2026-03-25T23:00:00Z', '2026-04-01T23:00:00Z'],
  ])('maps %s games into full seven-day periods', (sport, first, second) => {
    expect(resolveImportedGameWeek(sport, 2026, new Date(first), 500)).toBe(1)
    expect(resolveImportedGameWeek(sport, 2026, new Date(second), 500)).toBe(2)
  })

  it('does not turn preseason or unknown dates into a playable week', () => {
    expect(resolveImportedGameWeek('NHL', 2026, new Date('2026-09-26T23:00:00Z'), 500)).toBe(0)
    expect(resolveImportedGameWeek('NBA', 2027, new Date('2027-10-20T23:00:00Z'), 500)).toBe(0)
  })
})
