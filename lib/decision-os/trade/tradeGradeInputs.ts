/**
 * Turn the assets each trade surface carries into what the one grader prices. PURE.
 *
 * Each surface stores a deal its own way — a Sleeper offer as `PendingTradeAsset`, a native trade as
 * `AfLeagueTradeItem` rows, Chimmy as resolved names — and before 2026-09-24 each one priced its own
 * shape with its own pricer. Now they all convert to the console's `TradeAssetInput` and go through
 * `lib/decision-os/trade/leagueTradeGrader.ts`.
 *
 * Provider references retain their namespace. The shared pricer resolves Sleeper IDs directly
 * and Yahoo references through the canonical identity resolver, never through Sleeper's ID space.
 *
 * ⚠ AN ASSET THAT CANNOT BE PRICED IS RETURNED AS A REASON, NOT DROPPED. A pick with no year or
 * round has no price; leaving it out would grade the deal as though it were not in it.
 */
import type { TradeAssetInput } from '@/lib/trade-value-console/types'
import { parsePickLabel } from '@/lib/parsePickLabel'

export type GradeInputs = { assets: TradeAssetInput[]; unpriceable: string[] }

type PendingLike = {
  playerName: string
  playerId?: string | null
  position?: string | null
  team?: string | null
  isPick?: boolean
  pickRound?: string
  pickYear?: number
  pickRoundNumber?: number
  faabAmount?: number
}

/** A Sleeper/Yahoo pending-offer asset (`PendingTradeAsset`). */
export function gradeInputsFromPending(assets: ReadonlyArray<PendingLike>, provider?: 'sleeper' | 'yahoo'): GradeInputs {
  const out: GradeInputs = { assets: [], unpriceable: [] }
  for (const a of assets) {
    if (a.faabAmount != null) {
      out.assets.push({ kind: 'faab', amount: a.faabAmount })
    } else if (a.isPick) {
      if (a.pickYear && a.pickRoundNumber) out.assets.push({ kind: 'pick', year: a.pickYear, round: a.pickRoundNumber })
      else out.unpriceable.push(a.pickRound || a.playerName || 'a draft pick')
    } else if (a.playerName?.trim()) {
      const id = a.playerId?.trim()
      out.assets.push({ kind: 'player', name: a.playerName.trim(),
        ...(id && provider ? { providerIdentity: { provider, id,
          ...(a.position?.trim() ? { position: a.position.trim() } : {}),
          ...(a.team?.trim() ? { team: a.team.trim() } : {}),
        } } : {}),
      })
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
  metadata?: unknown
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
    const ref = str(item.itemReference)
    const verifiedName = ref ? str(nameForId?.(ref)) : null
    const name = verifiedName ?? str(meta.playerName ?? meta.name)
    if (name) out.assets.push({ kind: 'player', name,
      // The lookup is specifically by SportsPlayer.sleeperId. Metadata alone does not verify a namespace.
      ...(ref && verifiedName ? { providerIdentity: { provider: 'sleeper' as const, id: ref,
        ...(str(meta.position) ? { position: str(meta.position)! } : {}),
      } } : ref?.includes(':') ? { playerId: ref } : {}),
    })
    else out.unpriceable.push('a player with no name on file')
  }
  return out
}

/**
 * A redraft proposal's (or preview's) assets as grader inputs. Redraft rows keep the player's name and
 * pick season/round in COLUMNS rather than in `metadata`; this lifts them into the shape
 * `gradeInputsFromNativeItems` already reads, so there is one mapping rule, not two.
 */
export function gradeInputsFromRedraftAssets(
  assets: ReadonlyArray<{
    assetType: string | null | undefined
    playerId?: string | null
    playerName?: string | null
    pickSeason?: number | null
    pickRound?: number | null
    metadata?: unknown
  }>,
): GradeInputs {
  return gradeInputsFromNativeItems(
    assets.map((a) => {
      const meta = record(a.metadata)
      return {
        itemType: a.assetType,
        itemReference: a.playerId ?? null,
        metadata: {
          ...meta,
          playerName: meta.playerName ?? a.playerName ?? null,
          pickSeason: meta.pickSeason ?? a.pickSeason ?? null,
          pickRound: meta.pickRound ?? a.pickRound ?? null,
        },
      }
    }),
  )
}

/**
 * One side of a trade typed as text, as the dynasty analyzer's form sends it: chips joined by " + ".
 *
 * 🛑 The route used to split on `/,|and/i`, which never split on " + " (so a two-player side arrived as
 * ONE asset) and DID split inside names: "Mark Andrews" became "Mark " and "rews", "Brandon Aiyuk"
 * became "Br" and "on Aiyuk". "and" now splits only as a whole word.
 */
export function splitSideAssets(side: string): string[] {
  return side
    .split(/\s\+\s|,|\band\b/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 1)
}

/*
 * A player label as a form built it: "Josh Allen (QB)". The position suffix is the form's decoration,
 * not part of the name the player database knows.
 */
const TRAILING_POSITION = /\s*\((?:QB|RB|WR|TE|K|DEF|DST|D\/ST|DL|LB|DB|IDP|FLEX|[A-Z]{1,4})\)\s*$/
const FAAB_LABEL = /^\$?\s*(\d{1,4})\s*(?:\$\s*)?faab$|^faab\s*\$?\s*(\d{1,4})$/i
/** Anything carrying a draft year reads as a pick, so an unreadable one is refused, not looked up as a name. */
const LOOKS_LIKE_PICK = /\b20\d{2}\b.*\b(?:\d{1,2}(?:st|nd|rd|th)|round|rd|pick)\b|\bpick\b/i

/**
 * Assets typed as labels — the dynasty trade analyzer's chips ("Josh Allen (QB)", "2026 1st",
 * "2027 Early 2nd"). A pick is read by `parsePickLabel`, the same reader the trade evaluator uses; a
 * label that looks like a pick but cannot be read is returned as unpriceable rather than searched
 * for as a player, where it would withhold with a misleading "not in the player database".
 */
export function gradeInputsFromAssetLabels(
  labels: ReadonlyArray<{ name: string; type?: 'player' | 'pick' | null }>,
): GradeInputs {
  const out: GradeInputs = { assets: [], unpriceable: [] }
  for (const l of labels) {
    const label = String(l.name ?? '').trim()
    if (!label) continue
    const faab = label.match(FAAB_LABEL)
    if (faab) {
      out.assets.push({ kind: 'faab', amount: Number(faab[1] ?? faab[2]) })
      continue
    }
    if (l.type === 'pick' || (l.type !== 'player' && LOOKS_LIKE_PICK.test(label))) {
      const pick = parsePickLabel(label)
      if (pick) out.assets.push({ kind: 'pick', year: pick.year, round: pick.round, ...(pick.bucket ? { tier: pick.bucket } : {}), label })
      else out.unpriceable.push(`"${label}"`)
      continue
    }
    const name = label.replace(TRAILING_POSITION, '').trim()
    if (name) out.assets.push({ kind: 'player', name })
    else out.unpriceable.push(`"${label}"`)
  }
  return out
}

/** The reason a deal is not graded because of assets that cannot be priced, or null. */
export function unpriceableReason(give: GradeInputs, get: GradeInputs): string | null {
  const all = [...give.unpriceable, ...get.unpriceable]
  if (all.length === 0) return null
  return `${all.slice(0, 3).join(', ')} cannot be priced, and a missing asset is not graded as worthless.`
}
