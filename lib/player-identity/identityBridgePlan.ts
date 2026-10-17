/**
 * What to write onto `PlayerIdentityMap` to bridge a platform's own player ids to Sleeper ids.
 *
 * Pure, so the rules are tested without a database. The writer is `fantasyCalcIdentityBridge.ts`.
 *
 * ⚠ ONE-TO-ONE OR NOTHING, IN BOTH DIRECTIONS. `sleeperId` is unique on `PlayerIdentityMap`; the
 * provider columns are NOT. A provider id that the source ties to two Sleeper ids, or a Sleeper id
 * the source ties to two provider ids, is dropped — translating through either would put a stranger
 * on somebody's roster (`crosswalkRules.ts` records the same rule for the read side).
 *
 * ⚠ NEVER OVERWRITES. A row that already holds a DIFFERENT value, or a provider id already held by
 * a different row, is a conflict and is counted, not resolved. Something else wrote that value; a
 * cache of player values is not the authority to replace it.
 */

export const BRIDGE_COLUMNS = ['fleaflickerId', 'mflId'] as const
export type BridgeColumn = (typeof BRIDGE_COLUMNS)[number]

/** One player as the source describes him: his Sleeper id and his id on each bridged platform. */
export type BridgeSource = { sleeperId: string | null | undefined } & Partial<Record<BridgeColumn, string | null | undefined>>

/** A `PlayerIdentityMap` row, as far as the bridge cares. */
export type BridgeRow = { sleeperId: string | null } & Partial<Record<BridgeColumn, string | null>>

export type BridgeWrite = { sleeperId: string; column: BridgeColumn; value: string }

export type BridgeColumnStats = {
  /** Pairs the source offered after dropping ambiguous ones. */
  candidates: number
  ambiguous: number
  alreadySet: number
  conflicts: number
  /** No `PlayerIdentityMap` row carries that Sleeper id — nothing to write onto. */
  noRow: number
  writes: number
}

function clean(v: string | null | undefined): string | null {
  const s = v == null ? '' : String(v).trim()
  return s ? s : null
}

export function planIdentityBridge(
  sources: readonly BridgeSource[],
  rows: readonly BridgeRow[],
): { writes: BridgeWrite[]; stats: Record<BridgeColumn, BridgeColumnStats> } {
  const writes: BridgeWrite[] = []
  const stats = {} as Record<BridgeColumn, BridgeColumnStats>
  const rowBySleeper = new Map<string, BridgeRow>()
  for (const r of rows) if (r.sleeperId) rowBySleeper.set(r.sleeperId, r)

  for (const column of BRIDGE_COLUMNS) {
    const s: BridgeColumnStats = { candidates: 0, ambiguous: 0, alreadySet: 0, conflicts: 0, noRow: 0, writes: 0 }
    stats[column] = s

    // provider id → sleeper ids, and sleeper id → provider ids, to find ambiguity both ways.
    const toSleeper = new Map<string, Set<string>>()
    const toProvider = new Map<string, Set<string>>()
    for (const src of sources) {
      const sleeperId = clean(src.sleeperId)
      const providerId = clean(src[column])
      if (!sleeperId || !providerId) continue
      ;(toSleeper.get(providerId) ?? toSleeper.set(providerId, new Set()).get(providerId)!).add(sleeperId)
      ;(toProvider.get(sleeperId) ?? toProvider.set(sleeperId, new Set()).get(sleeperId)!).add(providerId)
    }

    // Who already holds each provider id on the table.
    const holderOf = new Map<string, string>()
    for (const r of rows) {
      const v = clean(r[column] ?? null)
      if (v && r.sleeperId) holderOf.set(v, r.sleeperId)
    }

    for (const [providerId, sleepers] of toSleeper) {
      const [sleeperId] = [...sleepers]
      if (sleepers.size !== 1 || toProvider.get(sleeperId!)!.size !== 1) {
        s.ambiguous += 1
        continue
      }
      s.candidates += 1
      const row = rowBySleeper.get(sleeperId!)
      if (!row) {
        s.noRow += 1
        continue
      }
      const held = clean(row[column] ?? null)
      if (held === providerId) {
        s.alreadySet += 1
        continue
      }
      const holder = holderOf.get(providerId)
      if (held || (holder && holder !== sleeperId)) {
        s.conflicts += 1
        continue
      }
      writes.push({ sleeperId: sleeperId!, column, value: providerId })
      s.writes += 1
    }
  }
  return { writes, stats }
}
