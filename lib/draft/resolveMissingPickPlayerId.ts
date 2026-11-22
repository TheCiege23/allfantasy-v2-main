/**
 * Give a draft pick that was saved without a player id the id its stats are filed under.
 *
 * 🛑 A PICK WITH NO PLAYER ID SCORES ZERO ALL SEASON, AND NOTHING SAYS SO. Seen in a live NFL draft on
 * 2026-11-19: two autopicks (Kenneth Walker III, Caleb Williams) were saved with a name, position and
 * team but no id. When the draft finishes, such a pick is given a made-up id built from its name
 * (`finalizeDraftToRedraftSeason.stablePlayerId`). No stat row is filed under that id, so the player
 * sits on a roster and never scores.
 *
 * NFL only: its rosters and its stats share one id space (Sleeper's), which the player registry
 * carries. Other sports file stats under other ids, and guessing one would be a confident wrong answer.
 *
 * Only an unambiguous match is used. A shared name the position and team cannot separate resolves to
 * nothing, and the caller keeps what it did before.
 */
import { prisma } from '@/lib/prisma'

type Candidate = { sleeperId: string | null; name: string; position: string | null; team: string | null }
type Reader = { sportsPlayer: { findMany: (args: unknown) => Promise<Candidate[]> } }

const SUFFIX = /\s+(jr\.?|sr\.?|ii|iii|iv|v)$/i
const norm = (s: string | null | undefined) => String(s ?? '').trim().toLowerCase().replace(/[.'’]/g, '').replace(/\s+/g, ' ')
const bare = (s: string) => norm(s.trim().replace(SUFFIX, ''))

/** PURE: the one registry id for this pick, or null when none or more than one fits. */
export function pickRegistryId(
  pick: { playerName: string; position?: string | null },
  candidates: readonly Candidate[],
): string | null {
  const wanted = bare(pick.playerName)
  if (!wanted) return null
  const position = norm(pick.position).toUpperCase()
  let fits = candidates.filter((c) => c.sleeperId && bare(c.name) === wanted)
  if (position) {
    const samePosition = fits.filter((c) => norm(c.position).toUpperCase() === position)
    // A registry row with no position cannot be told apart by it; one that names another position can.
    fits = samePosition.length ? samePosition : fits.filter((c) => !norm(c.position))
  }
  const ids = (rows: readonly Candidate[]) => [...new Set(rows.map((c) => c.sleeperId as string))]
  if (ids(fits).length > 1) {
    // Several namesakes at one position: the one on a team today, if exactly one is.
    const rostered = fits.filter((c) => norm(c.team))
    if (ids(rostered).length === 1) return ids(rostered)[0]
    return null
  }
  return ids(fits)[0] ?? null
}

export async function resolveMissingNflPickPlayerId(
  pick: { sport: string | null | undefined; playerName: string; position?: string | null; playerId?: string | null },
  db: Reader = prisma as unknown as Reader,
): Promise<string | null> {
  if (String(pick.playerId ?? '').trim()) return null
  if (String(pick.sport ?? '').toUpperCase() !== 'NFL') return null
  const name = pick.playerName?.trim()
  if (!name || norm(pick.position).toUpperCase() === 'SKIP') return null
  const stripped = name.replace(SUFFIX, '').trim()
  try {
    const candidates = await db.sportsPlayer.findMany({
      where: {
        sport: 'NFL',
        sleeperId: { not: null },
        OR: [...new Set([name, stripped])].flatMap((n) => [
          { name: { equals: n, mode: 'insensitive' } },
          { name: { startsWith: `${n} `, mode: 'insensitive' } },
        ]),
      },
      select: { sleeperId: true, name: true, position: true, team: true },
      take: 50,
    })
    return pickRegistryId(pick, candidates)
  } catch {
    return null
  }
}
