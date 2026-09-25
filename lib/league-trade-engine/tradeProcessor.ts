/**
 * Applies AF league trade items to `Roster.playerData` / `faabRemaining` in a transaction.
 */

import { prisma } from '@/lib/prisma'
import { extractDraftPicksFromPlayerData } from '@/lib/dispersal-draft/assetPoolBuilder'
import {
  addPlayerToRosterData,
  getRosterPlayerIds,
  removePlayerFromRosterData,
} from '@/lib/waiver-wire/roster-utils'
import type { TradeAssetInput } from '@/lib/league-trade-engine/types'
import { parseInventoryPickId, transferNativeFuturePick } from '@/lib/league-trade-engine/nativeFuturePicks'

export type LeagueTradeTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function pickKey(raw: unknown): string {
  const o = asRecord(raw)
  if (!o) return ''
  return String(o.id ?? o.pick_id ?? o.draft_pick_id ?? o.pickId ?? '')
}

function removePickFromPlayerData(playerData: unknown, pickRef: string): unknown {
  const root = asRecord(playerData) ?? {}
  const out = { ...root }
  for (const key of ['draftPicks', 'futurePicks', 'draft_picks', 'picks']) {
    const v = out[key]
    if (!Array.isArray(v)) continue
    out[key] = v.filter((raw) => pickKey(raw) !== pickRef)
  }
  if (Array.isArray(playerData)) return out.players ?? out
  return out
}

function addPickToPlayerData(playerData: unknown, pick: unknown): unknown {
  const root = asRecord(playerData) ?? {}
  const draftPicks = Array.isArray(root.draftPicks) ? [...root.draftPicks] : []
  draftPicks.push(pick)
  return { ...root, draftPicks }
}

function extractPickObject(fromData: unknown, pickRef: string): unknown | null {
  const root = asRecord(fromData)
  if (!root) return null
  for (const key of ['draftPicks', 'futurePicks', 'draft_picks', 'picks']) {
    const v = root[key]
    if (!Array.isArray(v)) continue
    const found = v.find((raw) => pickKey(raw) === pickRef)
    if (found) return found
  }
  const picks = extractDraftPicksFromPlayerData(fromData, '')
  const hit = picks.find((p) => p.pickId === pickRef)
  return hit ? { id: hit.pickId, season: hit.pickYear, round: hit.pickRound } : null
}

export async function applyTradeAssetsInTransaction(
  tx: LeagueTradeTx,
  input: {
    leagueId: string
    proposerRosterId: string
    receiverRosterId: string
    participantRosterIds?: string[]
    assets: TradeAssetInput[]
    /** Recorded on a native future pick's row as the trade that last moved it. */
    tradeId?: string | null
  },
): Promise<void> {
  const participantIds = [...new Set([
    input.proposerRosterId,
    input.receiverRosterId,
    ...(input.participantRosterIds ?? []),
    ...input.assets.flatMap((a) => [a.fromRosterId, a.toRosterId]),
  ])]
  const rosters = await tx.roster.findMany({ where: { id: { in: participantIds }, leagueId: input.leagueId } })
  if (rosters.length !== participantIds.length) throw new Error('Roster league mismatch')
  const dataByRoster = new Map<string, unknown>(rosters.map((r) => [r.id, r.playerData]))
  const faabByRoster = new Map<string, number>(rosters.map((r) => [r.id, r.faabRemaining ?? 0]))

  for (const a of input.assets) {
    const fromId = a.fromRosterId
    const toId = a.toRosterId

    if (a.itemType === 'player' && a.itemReference) {
      const pid = a.itemReference
      const fromData = dataByRoster.get(fromId)
      const toData = dataByRoster.get(toId)
      if (!getRosterPlayerIds(fromData).includes(pid)) throw new Error(`Player ${pid} not on sending roster`)
      dataByRoster.set(fromId, removePlayerFromRosterData(fromData, pid))
      dataByRoster.set(toId, addPlayerToRosterData(toData, pid))
    }

    if (a.itemType === 'faab') {
      const amt = Math.floor(Number(a.faabAmount ?? 0))
      if (amt <= 0) throw new Error('Invalid FAAB')
      const fromFaab = faabByRoster.get(fromId) ?? 0
      if (fromFaab < amt) throw new Error('Insufficient FAAB (sending roster)')
      faabByRoster.set(fromId, fromFaab - amt)
      faabByRoster.set(toId, (faabByRoster.get(toId) ?? 0) + amt)
    }

    if (a.itemType === 'rookie_pick' || a.itemType === 'future_pick' || a.itemType === 'devy_pick') {
      const ref = String(a.itemReference ?? '')
      if (!ref) throw new Error('Pick ref required')
      // A native dynasty league's future pick lives in `future_draft_picks`, not in `playerData`.
      if (parseInventoryPickId(ref)) {
        await transferNativeFuturePick(tx, {
          leagueId: input.leagueId,
          ref,
          fromRosterId: fromId,
          toRosterId: toId,
          tradeId: input.tradeId ?? null,
        })
        continue
      }
      const fromData = dataByRoster.get(fromId)
      const toData = dataByRoster.get(toId)
      const pickObj = extractPickObject(fromData, ref)
      if (!pickObj) throw new Error('Pick not found on roster')
      const nextFrom = removePickFromPlayerData(fromData, ref)
      const nextTo = addPickToPlayerData(toData, pickObj)
      dataByRoster.set(fromId, nextFrom)
      dataByRoster.set(toId, nextTo)
    }

    if (a.itemType === 'specialty_asset') {
      const fromData = dataByRoster.get(fromId)
      const toData = dataByRoster.get(toId)
      const fromRoot = asRecord(fromData) ?? {}
      const spec = Array.isArray(fromRoot.specialtyAssets) ? [...fromRoot.specialtyAssets] : []
      const key = String(a.itemReference ?? '')
      const idx = spec.findIndex((x) => asRecord(x)?.id === key || JSON.stringify(x) === key)
      if (idx < 0) throw new Error('Specialty asset not found on sending roster')
      const [row] = spec.splice(idx, 1)
      const toRoot = asRecord(toData) ?? {}
      const toSpec = Array.isArray(toRoot.specialtyAssets) ? [...toRoot.specialtyAssets] : []
      toSpec.push(row)
      const nextFrom = { ...fromRoot, specialtyAssets: spec }
      const nextTo = { ...toRoot, specialtyAssets: toSpec }
      dataByRoster.set(fromId, nextFrom)
      dataByRoster.set(toId, nextTo)
    }
  }

  for (const roster of rosters) {
    await tx.roster.update({
      where: { id: roster.id },
      data: {
        playerData: dataByRoster.get(roster.id) as import('@prisma/client').Prisma.InputJsonValue,
        faabRemaining: faabByRoster.get(roster.id) ?? 0,
      },
    })
  }
}
