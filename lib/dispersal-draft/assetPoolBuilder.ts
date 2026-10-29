/**
 * Build dispersal draft asset pool from orphaned/dissolved `Roster` rows.
 *
 * Players live in `Roster.playerData` (JSON array or `{ players: [] }` shape) — except in a league
 * AllFantasy runs, whose pool comes from its own tables (./nativeDispersal.ts).
 * Future/traded draft picks may appear under `draftPicks` | `futurePicks` on the same JSON object
 * when synced — otherwise the pool has no pick rows until import shapes are standardized.
 *
 * **FAAB:** Unclaimed FAAB is lost to the league (not transferred to another manager’s balance).
 */

import { randomUUID } from 'node:crypto'

import { prisma } from '@/lib/prisma'

import type { DispersalAsset } from './types'
import { buildNativeAssetPool, isNativeDispersalLeague } from './nativeDispersal'

function newPoolId(): string {
  return randomUUID()
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/** Normalize a single player row from legacy `playerData` arrays (Sleeper-style and variants). */
function rowToPlayerAsset(sourceRosterId: string, raw: unknown): DispersalAsset | null {
  const o = asRecord(raw)
  if (!o) return null
  const playerId =
    (typeof o.playerId === 'string' && o.playerId) ||
    (typeof o.player_id === 'string' && o.player_id) ||
    (typeof o.id === 'string' && o.id) ||
    null
  const playerName =
    (typeof o.name === 'string' && o.name) ||
    (typeof o.full_name === 'string' && o.full_name) ||
    (typeof o.playerName === 'string' && o.playerName) ||
    playerId ||
    'Player'
  const playerPosition =
    (typeof o.position === 'string' && o.position) || (typeof o.pos === 'string' && o.pos) || undefined
  const playerTeam = (typeof o.team === 'string' && o.team) || undefined
  return {
    id: newPoolId(),
    assetType: 'player',
    sourceRosterId,
    playerId: playerId ?? undefined,
    playerName,
    playerPosition,
    playerTeam,
    isAvailable: true,
  }
}

/**
 * Extract player rows from `playerData`: top-level array or nested `players` / `roster`.
 */
export function extractPlayersFromPlayerData(playerData: unknown, sourceRosterId: string): DispersalAsset[] {
  if (playerData == null) return []
  if (Array.isArray(playerData)) {
    return playerData.map((raw) => rowToPlayerAsset(sourceRosterId, raw)).filter((a): a is DispersalAsset => Boolean(a))
  }
  const root = asRecord(playerData)
  if (!root) return []
  const nested = root.players ?? root.roster ?? root.lineup
  if (Array.isArray(nested)) {
    return nested.map((raw) => rowToPlayerAsset(sourceRosterId, raw)).filter((a): a is DispersalAsset => Boolean(a))
  }
  return []
}

type RawDraftPick = Record<string, unknown>

function rawToDraftPickAsset(sourceRosterId: string, raw: unknown): DispersalAsset | null {
  const o = asRecord(raw)
  if (!o) return null
  const pickId =
    (typeof o.id === 'string' && o.id) ||
    (typeof o.pick_id === 'string' && o.pick_id) ||
    (typeof o.draft_pick_id === 'string' && o.draft_pick_id) ||
    newPoolId()
  const season =
    typeof o.season === 'number'
      ? o.season
      : typeof o.year === 'number'
        ? o.year
        : typeof o.pickYear === 'number'
          ? o.pickYear
          : undefined
  const roundRaw = o.round
  const round =
    typeof roundRaw === 'number'
      ? roundRaw
      : typeof roundRaw === 'string'
        ? parseInt(roundRaw, 10)
        : undefined
  const originalOwnerRosterId =
    (typeof o.original_owner_id === 'string' && o.original_owner_id) ||
    (typeof o.originalOwnerRosterId === 'string' && o.originalOwnerRosterId) ||
    undefined
  const tradedToRosterId =
    (typeof o.roster_id === 'string' && o.roster_id) ||
    (typeof o.owner_id === 'string' && o.owner_id) ||
    (typeof o.tradedToRosterId === 'string' && o.tradedToRosterId) ||
    undefined
  const isTradedPick = Boolean(o.is_traded ?? o.isTradedPick ?? originalOwnerRosterId)
  const yr = season ?? new Date().getFullYear()
  const rd = typeof round === 'number' && Number.isFinite(round) ? round : 1
  const pickLabel =
    (typeof o.label === 'string' && o.label) || `${yr} Round ${rd}${isTradedPick ? ' (traded)' : ''}`

  return {
    id: newPoolId(),
    assetType: 'draft_pick',
    sourceRosterId,
    pickId,
    pickRound: Number.isFinite(round) ? round : undefined,
    pickYear: season,
    originalOwnerRosterId,
    tradedToRosterId,
    pickLabel,
    isTradedPick,
    isAvailable: true,
  }
}

/**
 * Extract future/traded draft pick rows from roster JSON when present.
 */
export function extractDraftPicksFromPlayerData(playerData: unknown, sourceRosterId: string): DispersalAsset[] {
  if (playerData == null) return []
  const root = asRecord(playerData)
  const lists: unknown[] = []
  if (root) {
    for (const key of ['draftPicks', 'futurePicks', 'draft_picks', 'picks']) {
      const v = root[key]
      if (Array.isArray(v)) lists.push(...v)
    }
  }
  const out: DispersalAsset[] = []
  for (const raw of lists) {
    const a = rawToDraftPickAsset(sourceRosterId, raw)
    if (a) out.push(a)
  }
  return out
}

export async function buildAssetPoolFromRosters(
  leagueId: string,
  sourceRosterIds: string[]
): Promise<{
  assets: DispersalAsset[]
  totalCount: number
  playerCount: number
  draftPickCount: number
  faabCount: number
  totalFaab: number
}> {
  const assets: DispersalAsset[] = []
  let playerCount = 0
  let draftPickCount = 0
  let faabCount = 0
  let totalFaab = 0

  // A league AllFantasy runs keeps its rosters, picks and FAAB elsewhere (./nativeDispersal.ts).
  if (await isNativeDispersalLeague(prisma, leagueId)) {
    const native = await buildNativeAssetPool(prisma, leagueId, sourceRosterIds)
    const count = (t: DispersalAsset['assetType']) => native.filter((a) => a.assetType === t).length
    return {
      assets: native,
      totalCount: native.length,
      playerCount: count('player'),
      draftPickCount: count('draft_pick'),
      faabCount: count('faab'),
      totalFaab: native.reduce((sum, a) => sum + (a.faabAmount ?? 0), 0),
    }
  }

  const rosters = await prisma.roster.findMany({
    where: { leagueId, id: { in: sourceRosterIds } },
    select: { id: true, playerData: true, faabRemaining: true },
  })

  const byId = new Map(rosters.map((r) => [r.id, r]))

  for (const sid of sourceRosterIds) {
    const roster = byId.get(sid)
    if (!roster) continue

    const players = extractPlayersFromPlayerData(roster.playerData, sid)
    for (const p of players) {
      assets.push(p)
      playerCount += 1
    }

    const picks = extractDraftPicksFromPlayerData(roster.playerData, sid)
    for (const p of picks) {
      assets.push(p)
      draftPickCount += 1
    }

    const faab = roster.faabRemaining
    if (typeof faab === 'number' && faab > 0) {
      totalFaab += faab
      faabCount += 1
      assets.push({
        id: newPoolId(),
        assetType: 'faab',
        sourceRosterId: sid,
        faabAmount: faab,
        isAvailable: true,
      })
    }
  }

  return {
    assets,
    totalCount: assets.length,
    playerCount,
    draftPickCount,
    faabCount,
    totalFaab,
  }
}

/** Same round geometry as `DispersalDraftEngine` (linear draft). */
export function computeSuggestedDraftShape(
  assets: DispersalAsset[],
  participantCount: number
): { suggestedRounds: number; suggestedPicksPerRound: number } {
  const n = Math.max(1, participantCount)
  const countable = assets.filter((a) => a.assetType !== 'faab').length
  let totalRounds = Math.max(1, Math.ceil(countable / n))
  while (totalRounds * n < assets.length) {
    totalRounds += 1
  }
  return { suggestedRounds: totalRounds, suggestedPicksPerRound: n }
}
