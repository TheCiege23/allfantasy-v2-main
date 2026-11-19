/**
 * Rookies a dynasty league just drafted go onto the taxi squad, while it has room.
 *
 * 🛑 THEY ALL LANDED ON THE BENCH. Draft finalization writes every pick as `bench`, so a league with
 * a taxi squad came out of its rookie draft with the squad empty and every team over its active
 * roster, and each manager had to move his rookies across by hand (found on the dynasty offseason
 * walkthrough, 2026-11-18).
 *
 * The rule (owner's decision, 2026-11-19):
 *   - only a rookie draft (`DraftSession.playerPool === 'rookies_only'`) in a dynasty-family league
 *     with taxi slots; a startup draft and every other league are untouched;
 *   - only the rows THIS finalization created. Finalization re-runs (post-draft reads, repair jobs),
 *     and a rookie his manager has since promoted must never be sent back;
 *   - per team, the free taxi spots are filled from the LAST pick backwards: with more rookies than
 *     spots, the earliest picks, the ones most likely to play, stay on the bench;
 *   - it runs after the rollover housekeeping, so spots freed by players who aged off the squad are
 *     counted as free.
 *
 * A commissioner can switch it off (`League.settings.taxi_auto_place_rookies === false`, the Taxi rules
 * card, any plan); a league that never saved it has it on.
 *
 * A rookie is always taxi-eligible, so no experience lookup is needed. This is a system placement in
 * the offseason, when the taxi move rules are open (lib/taxi/taxiMoveRules.ts). Each write is guarded
 * on the row still being an undropped bench row.
 */
import { prisma } from '@/lib/prisma'
import { normalizeToken } from '@/lib/redraft/lineupValidation'
import { isDynastyFamilyLeague } from './carryDynastyRosters'

export const TAXI_AUTO_PLACE_ROOKIES_KEY = 'taxi_auto_place_rookies'

/** On unless the commissioner switched it off. */
export function readTaxiAutoPlaceRookies(settings: unknown): boolean {
  return !(settings && typeof settings === 'object' && (settings as Record<string, unknown>)[TAXI_AUTO_PLACE_ROOKIES_KEY] === false)
}

/** A row finalization just created, in pick order. */
export type DraftedRookieRow = { rowId: string; rosterId: string }

/** PURE: the rows to move, given each team's players already on its taxi squad. */
export function planRookieTaxiPlacement(input: {
  taxiSlots: number
  taxiCountByRoster: ReadonlyMap<string, number>
  drafted: readonly DraftedRookieRow[]
}): string[] {
  if (input.taxiSlots <= 0) return []
  const free = new Map<string, number>()
  const toTaxi: string[] = []
  for (let i = input.drafted.length - 1; i >= 0; i -= 1) {
    const row = input.drafted[i]
    const left = free.get(row.rosterId) ?? Math.max(0, input.taxiSlots - (input.taxiCountByRoster.get(row.rosterId) ?? 0))
    if (left <= 0) continue
    free.set(row.rosterId, left - 1)
    toTaxi.push(row.rowId)
  }
  return toTaxi.reverse()
}

/** Move the just-drafted rookies that fit onto their teams' taxi squads. Returns how many moved. */
export async function placeDraftedRookiesOnTaxi(leagueId: string, drafted: readonly DraftedRookieRow[]): Promise<number> {
  if (drafted.length === 0) return 0
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { leagueType: true, isDynasty: true, taxiSlots: true, settings: true },
  })
  const taxiSlots = league?.taxiSlots ?? 0
  if (!league || taxiSlots <= 0 || !isDynastyFamilyLeague(league) || !readTaxiAutoPlaceRookies(league.settings)) return 0

  const rosterIds = [...new Set(drafted.map((d) => d.rosterId))]
  const held = await prisma.redraftRosterPlayer.findMany({
    where: { rosterId: { in: rosterIds }, droppedAt: null },
    select: { rosterId: true, slotType: true },
  })
  const taxiCountByRoster = new Map<string, number>()
  for (const p of held) {
    if (normalizeToken(p.slotType) !== 'TAXI') continue
    taxiCountByRoster.set(p.rosterId, (taxiCountByRoster.get(p.rosterId) ?? 0) + 1)
  }

  let moved = 0
  for (const rowId of planRookieTaxiPlacement({ taxiSlots, taxiCountByRoster, drafted })) {
    const res = await prisma.redraftRosterPlayer.updateMany({
      where: { id: rowId, droppedAt: null, slotType: 'bench' },
      data: { slotType: 'taxi' },
    })
    moved += res.count
  }
  return moved
}
