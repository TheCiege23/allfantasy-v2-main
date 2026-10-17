import type { PrismaClient } from '@prisma/client'

import { resolveWriteAuthority } from '@/lib/league/write-authority'
import { slotCategory } from '@/lib/league-runtime/redraftSlotType'

/**
 * WHO WAS IN THE LINEUP FOR *THAT* WEEK — not who is in it now.
 *
 * 🛑 `RedraftRosterPlayer.slotType` IS CURRENT STATE. The lineup engine keeps it in step with every
 * native save (`lib/roster-lineup-engine/redraftSlotSync.ts`), which is what made a save change who
 * scores at all — and also what lets a save for week N+1 reach BACK into week N. The finalizer
 * seals week N twelve hours after its last kickoff (`WEEK_FINALIZE_GRACE_MS`); a manager setting
 * next week's lineup inside that window benched this week's starters as far as scoring could tell.
 *
 * The per-week record already exists: `af_roster_lineup_assignments`, written by the same engine
 * save, keyed (AF roster, season, week). Scoring reads it here and falls back to `slotType`:
 *
 *   - A roster with assignment rows for (season, week) is scored from THOSE rows.
 *   - A player on the roster but absent from those rows — a waiver add after the save — keeps his
 *     `slotType`. The saved lineup never named him, so it cannot say where he sits.
 *   - A roster with NO rows for that week (a week never saved through the engine, or no AF roster
 *     linked via `Roster.redraftRosterId`) is scored from `slotType`, exactly as before.
 *
 * ⚠ NATIVE LEAGUES ONLY. The engine writes assignments for imported (SHADOW) leagues too — they are
 * AllFantasy-side what-ifs, never the platform's lineup — so they must not decide a score. The same
 * gate `persistRosterLineupWithEngine` applies to its `slotType` sync.
 */

/** redraftRosterId → playerId → saved section (`starters` | `bench` | `ir` | `taxi` | `devy`). */
export type WeekLineups = Map<string, Map<string, string>>

export async function loadWeekLineups(
  db: Pick<PrismaClient, 'roster' | 'afRosterLineupAssignment'>,
  args: { redraftRosterIds: readonly string[]; season: number; week: number },
): Promise<WeekLineups> {
  const out: WeekLineups = new Map()
  if (args.redraftRosterIds.length === 0) return out

  const links = await db.roster.findMany({
    where: { redraftRosterId: { in: [...args.redraftRosterIds] } },
    select: { id: true, redraftRosterId: true, league: { select: { platform: true } } },
  })
  const redraftByAf = new Map<string, string>()
  for (const l of links) {
    if (!l.redraftRosterId) continue
    if (resolveWriteAuthority(l.league?.platform) !== 'NATIVE') continue
    redraftByAf.set(l.id, l.redraftRosterId)
  }
  if (redraftByAf.size === 0) return out

  const rows = await db.afRosterLineupAssignment.findMany({
    where: { rosterId: { in: [...redraftByAf.keys()] }, season: args.season, week: args.week },
    select: { rosterId: true, section: true, playerId: true },
  })
  for (const r of rows) {
    const redraftRosterId = redraftByAf.get(r.rosterId)
    if (!redraftRosterId) continue
    const byPlayer = out.get(redraftRosterId) ?? new Map<string, string>()
    byPlayer.set(r.playerId, r.section)
    out.set(redraftRosterId, byPlayer)
  }
  return out
}

/**
 * The slot to SCORE a roster player in for the loaded week, in `slotType`'s own vocabulary so
 * `countsTowardScore` and the best-ball candidate rule read it unchanged. A starter keeps a
 * starter label already stored (`FLEX` stays `FLEX`); one coming off the bench scores under his
 * position, the convention `slotTypeFor` writes.
 */
export function weekSlotType(
  row: { rosterId: string; playerId: string; slotType: string; position?: string | null },
  lineups: WeekLineups,
): string {
  const section = lineups.get(row.rosterId)?.get(row.playerId)
  if (section == null) return row.slotType
  switch (section.trim().toLowerCase()) {
    case 'starters':
      return slotCategory(row.slotType) === 'starter' ? row.slotType : row.position || 'starter'
    case 'bench':
      return 'bench'
    case 'ir':
      return 'ir'
    case 'taxi':
      return 'taxi'
    case 'devy':
      return 'devy'
    default:
      return row.slotType
  }
}
