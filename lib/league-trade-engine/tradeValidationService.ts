/**
 * Validates AF league trade proposals against rosters, settings, and concept rules.
 */

import type { League, Roster } from '@prisma/client'
import { extractDraftPicksFromPlayerData } from '@/lib/dispersal-draft/assetPoolBuilder'
import { getRosterPlayerIds, getRosterSize } from '@/lib/waiver-wire/roster-utils'
import {
  isPastTradeDeadline,
  resolveLeagueTradeSettings,
  type ResolvedLeagueTradeSettings,
} from '@/lib/league-trade-engine/tradeSettingsResolver'
import type { TradeAssetInput } from '@/lib/league-trade-engine/types'
import { TRADE_ITEM_TYPES, type TradeItemType } from '@/lib/league-trade-engine/types'

export type TradeValidationResult = { ok: true; settings: ResolvedLeagueTradeSettings } | { ok: false; code: string; message: string }

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function pickKeyFromRaw(raw: unknown): string {
  const o = asRecord(raw)
  if (!o) return ''
  return String(o.id ?? o.pick_id ?? o.draft_pick_id ?? o.pickId ?? '')
}

/** A pick that can be named in a proposal, because it has an id to name it by. */
export type ProposablePick = {
  /** The exact string `validateTradeAssets` will look for as `itemReference`. */
  pickId: string
  season: number | null
  round: number | null
  label: string
}

/**
 * The picks on a roster that a trade proposal can actually reference.
 *
 * ⚠ A PICK WITHOUT A STORED ID IS NOT PROPOSABLE, AND THAT IS NOT A BUG HERE.
 * `validateTradeAssets` matches `itemReference` against these same keys, so a
 * pick whose raw record carries no `id` / `pick_id` / `draft_pick_id` / `pickId`
 * has nothing an offer could point at. `extractDraftPicksFromPlayerData` mints a
 * random pool id for those, which is right for a dispersal draft and wrong here
 * — a reference generated on read cannot be matched on write. They are dropped
 * rather than offered with an id that will fail validation a second later.
 *
 * ⚠ ONE DEFINITION, USED BY BOTH SIDES. The validator below calls this for its
 * ownership check and the rosters API calls it to build the picker, so a UI can
 * never offer a pick the engine would then refuse. Two copies of this parsing
 * would drift apart the first time a platform spelled a key differently.
 */
export function listProposablePicks(playerData: unknown): ProposablePick[] {
  const root = asRecord(playerData)
  if (!root) return []

  const raws: unknown[] = []
  for (const key of ['draftPicks', 'futurePicks', 'draft_picks', 'picks']) {
    const v = root[key]
    if (Array.isArray(v)) raws.push(...v)
  }

  const seen = new Set<string>()
  const out: ProposablePick[] = []
  for (const raw of raws) {
    const pickId = pickKeyFromRaw(raw)
    if (!pickId || seen.has(pickId)) continue
    seen.add(pickId)

    const o = asRecord(raw) ?? {}
    const seasonRaw = o.season ?? o.year ?? o.pickYear
    const season = Number(seasonRaw)
    const roundRaw = o.round
    const round = Number(roundRaw)

    out.push({
      pickId,
      season: Number.isFinite(season) && season > 0 ? season : null,
      round: Number.isFinite(round) && round > 0 ? round : null,
      label:
        typeof o.label === 'string' && o.label.trim()
          ? o.label.trim()
          : [Number.isFinite(season) ? season : null, Number.isFinite(round) ? `round ${round}` : null]
              .filter(Boolean)
              .join(' ') || 'Draft pick',
    })
  }
  return out
}

export function validateTradeAssets(params: {
  league: League
  settings: ResolvedLeagueTradeSettings
  proposer: Roster
  receiver: Roster
  assets: TradeAssetInput[]
  /** Current fantasy week for deadline checks */
  currentWeek: number | null
}): TradeValidationResult {
  const { league, settings, proposer, receiver, assets, currentWeek } = params

  if (!settings.tradesAllowed) {
    return { ok: false, code: 'TRADES_DISABLED', message: 'Trades are disabled for this league format or settings.' }
  }

  if (isPastTradeDeadline(league, currentWeek)) {
    return { ok: false, code: 'TRADE_DEADLINE', message: 'Trade deadline has passed.' }
  }

  if (assets.length === 0) {
    return { ok: false, code: 'NO_ASSETS', message: 'At least one asset is required.' }
  }

  const rosterIds = new Set([proposer.id, receiver.id])
  const seen = new Set<string>()

  for (const a of assets) {
    if (!rosterIds.has(a.fromRosterId) || !rosterIds.has(a.toRosterId)) {
      return { ok: false, code: 'INVALID_ROSTER', message: 'Each asset must move between the two trading rosters.' }
    }
    if (a.fromRosterId === a.toRosterId) {
      return { ok: false, code: 'INVALID_DIRECTION', message: 'fromRosterId and toRosterId must differ.' }
    }

    const t = a.itemType as TradeItemType
    if (!TRADE_ITEM_TYPES.includes(t)) {
      return { ok: false, code: 'INVALID_ITEM_TYPE', message: `Unknown itemType: ${a.itemType}` }
    }

    if (t === 'faab') {
      if (!settings.faabTradingAllowed) {
        return { ok: false, code: 'FAAB_TRADE_BLOCKED', message: 'FAAB trading is not allowed in this league.' }
      }
      const amt = Number(a.faabAmount ?? a.metadata?.amount ?? 0)
      if (!Number.isFinite(amt) || amt <= 0) {
        return { ok: false, code: 'INVALID_FAAB', message: 'FAAB amount must be positive.' }
      }
      const from = a.fromRosterId === proposer.id ? proposer : receiver
      const cur = from.faabRemaining ?? 0
      if (amt > cur) {
        return { ok: false, code: 'FAAB_INSUFFICIENT', message: 'Insufficient FAAB for this trade.' }
      }
    }

    if (t === 'player') {
      const pid = String(a.itemReference ?? '').trim()
      if (!pid) {
        return { ok: false, code: 'PLAYER_ID_REQUIRED', message: 'Player trades require itemReference (player id).' }
      }
      const from = a.fromRosterId === proposer.id ? proposer : receiver
      if (!getRosterPlayerIds(from.playerData).includes(pid)) {
        return { ok: false, code: 'PLAYER_NOT_ON_ROSTER', message: `Player ${pid} is not on the sending roster.` }
      }
      const key = `player:${pid}`
      if (seen.has(key)) return { ok: false, code: 'DUPLICATE_ASSET', message: 'Duplicate asset in trade bundle.' }
      seen.add(key)
    }

    if (t === 'rookie_pick' || t === 'future_pick' || t === 'devy_pick') {
      if (!settings.draftPickTradingAllowed && t !== 'devy_pick') {
        return { ok: false, code: 'PICK_TRADING_BLOCKED', message: 'Draft pick trading is disabled.' }
      }
      if (t === 'devy_pick' && !settings.devyTradingAllowed) {
        return { ok: false, code: 'DEVY_TRADE_BLOCKED', message: 'Devy asset trading is not allowed.' }
      }
      /*
       * 🛑 THIS BRANCH WAS AN EMPTY BLOCK — `{ /* c2c flag also used for cross-layer picks *\/ }`.
       *
       * The condition was evaluated and nothing happened, so a league with C2C trading switched OFF
       * still accepted `future_pick` assets. Its two siblings immediately above (draft picks, devy)
       * both refuse; this one read as a guard, passed review as a guard, and was not one. Nothing
       * type-checks an empty block and no test covered the branch.
       *
       * The refusal below is the author's stated intent from that comment, implemented — not a new
       * rule: when the C2C (cross-layer) flag is off, a cross-layer pick is not tradeable.
       *
       * ⚠ REACHABILITY, MEASURED RATHER THAN ASSUMED, because it decides the blast radius:
       * `c2cTradingAllowed` resolves as `leagueType.includes('c2c') || Boolean(ext.c2cTrading ?? true)`.
       * The default is TRUE, and the first clause means a C2C-TYPE LEAGUE CAN NEVER TURN IT OFF.
       * So this refusal fires in exactly one case: a non-C2C league that explicitly set
       * `c2cTrading: false`. Every other league is unaffected by filling the block in.
       *
       * ⚠ THAT `||` IS LEFT ALONE DELIBERATELY. `devyTradingAllowed` has the identical shape, so
       * "a devy league always permits devy assets, a C2C league always permits cross-layer picks"
       * is a consistent product reading rather than a slip — and changing it would silently start
       * blocking assets in leagues built around them. It is reported, not rewritten.
       */
      if (t === 'future_pick' && !settings.c2cTradingAllowed) {
        return {
          ok: false,
          code: 'C2C_TRADE_BLOCKED',
          message: 'Cross-layer (C2C) pick trading is not allowed in this league.',
        }
      }
      const ref = String(a.itemReference ?? '').trim()
      if (!ref) {
        return { ok: false, code: 'PICK_REF_REQUIRED', message: 'Pick trades require itemReference (pick id).' }
      }
      const from = a.fromRosterId === proposer.id ? proposer : receiver
      const picks = extractDraftPicksFromPlayerData(from.playerData, from.id)
      /*
       * Two ways a reference can be legitimate. `extractDraftPicksFromPlayerData`
       * mints a pool id when the raw record has none, so its ids only match for
       * picks that carried one; `listProposablePicks` reads the stored key
       * directly, and is what the rosters API offers the picker. Both are
       * checked so an id from either path is honoured.
       */
      const hasPick =
        picks.some((p) => p.pickId === ref) ||
        listProposablePicks(from.playerData).some((p) => p.pickId === ref)
      if (!hasPick) {
        return { ok: false, code: 'PICK_NOT_OWNED', message: 'Pick is not on the sending roster.' }
      }
      const key = `pick:${ref}`
      if (seen.has(key)) return { ok: false, code: 'DUPLICATE_ASSET', message: 'Duplicate pick in trade bundle.' }
      seen.add(key)
    }

    if (t === 'specialty_asset') {
      const key = `spec:${String(a.itemReference ?? JSON.stringify(a.metadata ?? {})).slice(0, 200)}`
      if (seen.has(key)) return { ok: false, code: 'DUPLICATE_ASSET', message: 'Duplicate specialty asset.' }
      seen.add(key)
    }
  }

  const max = league.rosterSize ?? 999
  let pCount = getRosterSize(proposer.playerData)
  let rCount = getRosterSize(receiver.playerData)
  for (const a of assets) {
    if (a.itemType === 'player' && a.itemReference) {
      if (a.fromRosterId === proposer.id && a.toRosterId === receiver.id) {
        pCount -= 1
        rCount += 1
      } else if (a.fromRosterId === receiver.id && a.toRosterId === proposer.id) {
        rCount -= 1
        pCount += 1
      }
    }
  }
  if (pCount > max || rCount > max) {
    return { ok: false, code: 'ROSTER_ILLEGAL', message: `Roster would exceed league limit (${max}).` }
  }

  return { ok: true, settings }
}
