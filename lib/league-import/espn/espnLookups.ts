/**
 * ESPN fantasy FOOTBALL id → readable value tables. The one place they live.
 *
 * ⚠ A PURE MODULE — no fetch, no prisma — so a read path, the athlete adapter, a test or a client
 * component can name an ESPN position without importing the fetch service. Before this there were
 * three copies (`EspnLeagueFetchService.ts`, `lib/espn-client.ts`, `espnTeamDefenseIds.ts`) and they
 * already disagreed: one called slot 7 `OP`, another `SUPER_FLEX`; one called position 16 `DEF`,
 * another `D/ST`. Everything now reads these.
 *
 * 🛑 DO NOT ADD IDS FROM MEMORY. ESPN publishes none of this. Every value below was already in this
 * repo and in production use before it moved here; none was added in the move. An id that is not
 * here falls back to a neutral label (`N/A`, `SLOT_<id>`) rather than a guess, because a WRONG
 * position is worse than an unknown one — it silently mislabels players across every surface.
 * IDP `defaultPositionId`s in particular are not mapped: no NFL fantasy-league fixture is committed
 * under `contracts/espn/` yet (`GAPS.md` L-01). Extend this table only alongside a capture.
 *
 * Baseball ids are a different space (slot 0 is C there) and live in `EspnMlbLeagueFetchService.ts`.
 */

import { ESPN_TEAM_ABBREVIATIONS, espnDefenseTeamAbbreviation } from './espnTeamDefenseIds'

export { ESPN_TEAM_ABBREVIATIONS, espnDefenseTeamAbbreviation }

/** `player.defaultPositionId` → position. */
export const ESPN_POSITION_LABELS: Readonly<Record<number, string>> = Object.freeze({
  1: 'QB',
  2: 'RB',
  3: 'WR',
  4: 'TE',
  5: 'K',
  16: 'D/ST',
})

/** `lineupSlotId` (roster entries) and `rosterSettings.lineupSlotCounts` keys → slot label. */
export const ESPN_LINEUP_SLOT_LABELS: Readonly<Record<number, string>> = Object.freeze({
  0: 'QB',
  1: 'TQB',
  2: 'RB',
  3: 'RB/WR',
  4: 'WR',
  5: 'WR/TE',
  6: 'TE',
  /** ESPN's "OP" (offensive player) slot — superflex. */
  7: 'SUPER_FLEX',
  8: 'DT',
  9: 'DE',
  10: 'LB',
  11: 'DL',
  12: 'CB',
  13: 'S',
  14: 'DB',
  15: 'DP',
  16: 'D/ST',
  17: 'K',
  18: 'P',
  19: 'HC',
  20: 'BE',
  21: 'IR',
  23: 'FLEX',
  /** ⚠ Accepted positions unverified — `contracts/espn/GAPS.md` L-01. Not treated as IDP. */
  24: 'EDR',
})

/**
 * Bench and injured reserve. Only 21 is IR — see the 🛑 note on the bench/IR split in
 * `EspnLeagueFetchService.ts`: folding 20 into IR once filed every bench player as injured.
 */
export const ESPN_BENCH_SLOT = 20
export const ESPN_IR_SLOT = 21

/** Activity-feed `messageTypeId` → our transaction type. Only codes already in production use. */
export const ESPN_ACTIVITY_TYPE_MAP: Readonly<
  Record<number, { type: 'free_agent' | 'waiver' | 'drop' | 'trade'; description: string }>
> = Object.freeze({
  178: { type: 'free_agent', description: 'added' },
  179: { type: 'drop', description: 'dropped' },
  180: { type: 'waiver', description: 'added' },
  181: { type: 'waiver', description: 'dropped' },
  239: { type: 'drop', description: 'dropped' },
  244: { type: 'trade', description: 'traded_away' },
})

/** Sent in the activity feed's `x-fantasy-filter`. Order kept exactly as production has sent it. */
export const ESPN_ACTIVITY_MESSAGE_TYPE_IDS: readonly number[] = Object.freeze([178, 180, 179, 239, 181, 244])

function toId(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isInteger(n) ? n : null
}

/** Position label for a `defaultPositionId`, or `fallback` when ESPN sent an id we have not mapped. */
export function espnPositionLabel(positionId: unknown, fallback = 'N/A'): string {
  const id = toId(positionId)
  return id != null ? ESPN_POSITION_LABELS[id] ?? fallback : fallback
}

/** Slot label for a `lineupSlotId`. 0 is a real slot (QB), so it is never treated as missing. */
export function espnLineupSlotLabel(slotId: unknown): string {
  const id = toId(slotId)
  if (id == null || id < 0) return 'SLOT_UNKNOWN'
  return ESPN_LINEUP_SLOT_LABELS[id] ?? `SLOT_${id}`
}

/** NFL team abbreviation for a `proTeamId`; '' for 0 (free agent) or an unknown id. */
export function espnProTeamAbbreviation(proTeamId: unknown): string {
  const id = toId(proTeamId)
  return id != null ? ESPN_TEAM_ABBREVIATIONS[id] ?? '' : ''
}

/** Where a roster entry sits: starting lineup, bench, or injured reserve. */
export function classifyEspnLineupSlot(slotId: unknown): 'starter' | 'bench' | 'ir' {
  const id = toId(slotId)
  if (id === ESPN_IR_SLOT) return 'ir'
  if (id == null || id < 0 || id === ESPN_BENCH_SLOT) return 'bench'
  return 'starter'
}
