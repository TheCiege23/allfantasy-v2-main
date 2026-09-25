/**
 * Turn the assets each trade surface carries into what the one grader prices. PURE.
 *
 * Each surface stores a deal its own way — a Sleeper offer as `PendingTradeAsset`, a native trade as
 * `AfLeagueTradeItem` rows, Chimmy as resolved names — and before 2026-09-24 each one priced its own
 * shape with its own pricer. Now they all convert to the console's `TradeAssetInput` and go through
 * `lib/decision-os/trade/leagueTradeGrader.ts`.
 *
 * ⚠ PLAYERS ARE HANDED OVER BY NAME, NEVER BY A PROVIDER ID. The console's `playerId` is a
 * `SportsPlayerRecord.id`; a Sleeper id there misses, and a miss in `getPlayer` queues a background
 * importer run for the whole sport. The NFL pricer keys on the name anyway (`pricePlayer`).
 *
 * ⚠ AN ASSET THAT CANNOT BE PRICED IS RETURNED AS A REASON, NOT DROPPED. A pick with no year or
 * round has no price; leaving it out would grade the deal as though it were not in it.
 */
import type { TradeAssetInput } from '@/lib/trade-value-console/types'

export type GradeInputs = { assets: TradeAssetInput[]; unpriceable: string[] }

type PendingLike = {
  playerName: string
  isPick?: boolean
  pickRound?: string
  pickYear?: number
  pickRoundNumber?: number
  faabAmount?: number
}

/** A Sleeper/Yahoo pending-offer asset (`PendingTradeAsset`). */
export function gradeInputsFromPending(assets: ReadonlyArray<PendingLike>): GradeInputs {
  const out: GradeInputs = { assets: [], unpriceable: [] }
  for (const a of assets) {
    if (a.faabAmount != null) {
      out.assets.push({ kind: 'faab', amount: a.faabAmount })
    } else if (a.isPick) {
      if (a.pickYear && a.pickRoundNumber) out.assets.push({ kind: 'pick', year: a.pickYear, round: a.pickRoundNumber })
      else out.unpriceable.push(a.pickRound || a.playerName || 'a draft pick')
    } else if (a.playerName?.trim()) {
      out.assets.push({ kind: 'player', name: a.playerName.trim() })
    } else {
      out.unpriceable.push('an unnamed player')
    }
  }
  return out
}

type NativeItemLike = {
  itemType: string | null | undefined
  itemReference: string | null
  faabAmount?: number | null
  metadata: unknown
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/*
 * A pick reference that names its own season and round: `fdp:<season>:<round>:<originalRosterId>`
 * (native future picks) or `pick:<season>:<round>:<rosterId>` (Chimmy). The Trade Center's propose
 * panel sends NO metadata on a pick (measured 2026-09-24), so the reference is the only place a
 * season and round can come from.
 */
const SELF_DESCRIBING_PICK = /^(?:fdp|pick):(\d{4}):(\d{1,2})(?::|$)/

/**
 * A native `AfLeagueTradeItem`. Field fallbacks match `tradeAssetSummary` in serverTradeDecision.
 *
 * ⚠ `nameForId` IS NOT OPTIONAL IN PRACTICE. The Trade Center proposes with a Sleeper id and no
 * metadata, so without a lookup almost every native player reads as unnamed and the deal is
 * withheld. The trades panel resolves the ids through `SportsPlayer` and passes them in.
 */
export function gradeInputsFromNativeItems(
  items: ReadonlyArray<NativeItemLike>,
  nameForId?: (id: string) => string | null | undefined,
): GradeInputs {
  const out: GradeInputs = { assets: [], unpriceable: [] }
  for (const item of items) {
    const meta = record(item.metadata)
    // Defaulted the way `assetLabel` in the trades panel defaults it: a row with no type is a player.
    const type = String(item.itemType ?? 'player').toLowerCase()
    const faab = item.faabAmount ?? num(meta.faabAmount ?? meta.amount)
    if (type.includes('faab')) {
      if (faab != null) out.assets.push({ kind: 'faab', amount: faab })
      else out.unpriceable.push('FAAB with no amount')
      continue
    }
    if (type.includes('pick')) {
      const ref = SELF_DESCRIBING_PICK.exec(item.itemReference ?? '')
      const year = num(meta.pickSeason ?? meta.season) ?? (ref ? Number(ref[1]) : null)
      const round = num(meta.pickRound ?? meta.round) ?? (ref ? Number(ref[2]) : null)
      if (year && round) out.assets.push({ kind: 'pick', year, round })
      // Named by its label, never by its id: a row id in a sentence tells a manager nothing.
      else out.unpriceable.push(str(meta.pickLabel ?? meta.label) ?? 'a draft pick with no season or round on file')
      continue
    }
    const name = str(meta.playerName ?? meta.name) ?? (item.itemReference ? str(nameForId?.(item.itemReference)) : null)
    if (name) out.assets.push({ kind: 'player', name })
    else out.unpriceable.push('a player with no name on file')
  }
  return out
}

/** The reason a deal is not graded because of assets that cannot be priced, or null. */
export function unpriceableReason(give: GradeInputs, get: GradeInputs): string | null {
  const all = [...give.unpriceable, ...get.unpriceable]
  if (all.length === 0) return null
  return `${all.slice(0, 3).join(', ')} cannot be priced, and a missing asset is not graded as worthless.`
}
