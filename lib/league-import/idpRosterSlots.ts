/**
 * The roster slot tokens that make an imported football league IDP — one list for every import path.
 *
 * Exact tokens, never substrings: `includes('S')` marked every SUPER_FLEX, DST and RES league as IDP.
 * ESPN, Yahoo, MFL and Fantrax store `SLOT:COUNT` pairs (`LB:2`), so the count is stripped first.
 *
 * `DP` is ESPN's defensive-player flex: lineup slot 15 in `ESPN_SLOT_LABELS`
 * (lib/league-import/espn/EspnLeagueFetchService.ts), the last of ESPN's defensive block (8 DT, 9 DE,
 * 10 LB, 11 DL, 12 CB, 13 S, 14 DB, 15 DP); `sleeperSlotUtils.ts` already counts it as IDP.
 * ESPN's `EDR` (slot 24) is deliberately absent — what an ESPN edge slot accepts is not established
 * (see `importedLineupTemplate.ts` and contracts/espn/GAPS.md).
 */
export const IDP_ROSTER_SLOTS: ReadonlySet<string> = new Set(['DE', 'DT', 'LB', 'CB', 'S', 'DL', 'DB', 'IDP_FLEX', 'IDP', 'DP'])

/** `lb:2` → `LB`. */
export const rosterSlotToken = (slot: unknown): string => String(slot).trim().toUpperCase().replace(/:\d+$/, '')

export function hasIdpRosterSlot(rosterPositions: readonly unknown[]): boolean {
  return rosterPositions.some((p) => IDP_ROSTER_SLOTS.has(rosterSlotToken(p)))
}
