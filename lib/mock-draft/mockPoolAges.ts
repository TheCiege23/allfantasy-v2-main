/**
 * Player ages for the mock-draft pool (room v2, 2026-11), so a league mock can show the same age chip
 * as the league's live board (`lib/draft-room/leagueSignature.ts`).
 *
 * The NFL mock pool is built from ADP lists (FFC, the analytics snapshot, the consensus board) that
 * mostly carry no age. The live room reads `SportsPlayer.age`, so the mock reads the same column,
 * keyed on the Sleeper id the pool already resolves. An age the ADP row carries itself wins.
 * A failed read leaves every age null: the tile then shows no chip, never a wrong one.
 */
import { prisma } from '@/lib/prisma'

/** Ages outside a playing career are bad data; the tile's reader applies the same bounds. */
export function plausibleAge(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value.trim()) : value
  return typeof n === 'number' && Number.isFinite(n) && n >= 16 && n <= 50 ? Math.floor(n) : null
}

export async function loadNflAgesBySleeperId(ids: ReadonlyArray<string | null | undefined>): Promise<Map<string, number>> {
  const wanted = [...new Set(ids.map((id) => (typeof id === 'string' ? id.trim() : '')).filter(Boolean))]
  const out = new Map<string, number>()
  if (wanted.length === 0) return out
  try {
    const rows = await prisma.sportsPlayer.findMany({
      where: { sport: 'NFL', sleeperId: { in: wanted }, age: { not: null } },
      select: { sleeperId: true, age: true },
    })
    for (const row of rows) {
      const age = plausibleAge(row.age)
      // Several sources can hold one player; the first plausible age stands.
      if (row.sleeperId && age != null && !out.has(row.sleeperId)) out.set(row.sleeperId, age)
    }
  } catch {
    return new Map()
  }
  return out
}
