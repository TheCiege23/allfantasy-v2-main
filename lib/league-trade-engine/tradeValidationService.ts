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

  const perSide = new Map<string, number>()
  for (const asset of assets) perSide.set(asset.fromRosterId, (perSide.get(asset.fromRosterId) ?? 0) + 1)
  if (settings.maxAssetsPerSide != null && [...perSide.values()].some((count) => count > settings.maxAssetsPerSide!)) {
    return { ok: false, code: 'MAX_ASSETS_PER_SIDE', message: `A trade side exceeds the persisted maximum of ${settings.maxAssetsPerSide} assets.` }
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

    if (t === 'future_pick') {
      return { ok: false, code: 'FUTURE_REDRAFT_PICK_UNSUPPORTED', message: 'Future-season picks are not valid redraft trade assets.' }
    }
    if (a.metadata?.conditional === true || a.metadata?.condition != null) {
      return { ok: false, code: 'CONDITIONAL_TRADE_UNSUPPORTED', message: 'Conditional trade assets are not supported.' }
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
      if (t === 'future_pick' && !settings.c2cTradingAllowed) {
        /* c2c flag also used for cross-layer picks */
      }
      const ref = String(a.itemReference ?? '').trim()
      if (!ref) {
        return { ok: false, code: 'PICK_REF_REQUIRED', message: 'Pick trades require itemReference (pick id).' }
      }
      const from = a.fromRosterId === proposer.id ? proposer : receiver
      const picks = extractDraftPicksFromPlayerData(from.playerData, from.id)
      const hasPick = picks.some((p) => p.pickId === ref)
      if (!hasPick) {
        const root = asRecord(from.playerData)
        const lists: unknown[] = []
        if (root) {
          for (const key of ['draftPicks', 'futurePicks', 'draft_picks', 'picks']) {
            const v = root[key]
            if (Array.isArray(v)) lists.push(...v)
          }
        }
        const found = lists.some((raw) => pickKeyFromRaw(raw) === ref)
        if (!found) {
          return { ok: false, code: 'PICK_NOT_OWNED', message: 'Pick is not on the sending roster.' }
        }
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
