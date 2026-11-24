/**
 * The zombie season starts at the first unplayed REAL week (lib/zombie/matchupCompletion.ts). Pre-league
 * weeks are loaded by a background job the draft does not wait for, so they can still be open when the
 * league activates; TheCiege Zombie League (NBA) then started at week 1 and resolved two replayed weeks.
 * A tiny in-memory matchup table applies the real `where` (status notIn, type not, awayRosterId not null).
 */
import { describe, expect, it, vi } from 'vitest'

type M = { week: number; status: string; type: string; awayRosterId: string | null }
const table = vi.hoisted(() => ({ rows: [] as M[] }))

function matches(m: M, where: Record<string, any>): boolean {
  if (where.awayRosterId?.not === null && m.awayRosterId === null) return false
  if (where.status?.notIn && where.status.notIn.includes(m.status)) return false
  if (where.type && 'not' in where.type && m.type === where.type.not) return false
  return true
}
vi.mock('@/lib/prisma', () => ({
  prisma: {
    redraftMatchup: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, any> }) =>
        table.rows.filter((m) => matches(m, where)).sort((a, b) => a.week - b.week)[0] ?? null),
    },
  },
}))

import { getFirstScheduledWeek, getFirstUnplayedWeek } from '@/lib/zombie/matchupCompletion'

const pre = (week: number, status: string): M => ({ week, status, type: 'pre_league', awayRosterId: 'b' })
const reg = (week: number, status = 'scheduled'): M => ({ week, status, type: 'regular', awayRosterId: 'b' })

describe('the first zombie week', () => {
  it('skips pre-league weeks still being loaded', async () => {
    table.rows = [pre(1, 'final'), pre(2, 'final'), pre(3, 'scheduled'), pre(4, 'scheduled'), reg(5), reg(6)]
    expect(await getFirstUnplayedWeek('S')).toBe(5)
    expect(await getFirstScheduledWeek('S')).toBe(5)
  })

  it('[control] a league with no pre-league weeks starts at its first open week', async () => {
    table.rows = [reg(1, 'final'), reg(2), reg(3)]
    expect(await getFirstUnplayedWeek('S')).toBe(2)
    expect(await getFirstScheduledWeek('S')).toBe(1)
  })
})
