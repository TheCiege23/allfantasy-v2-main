/**
 * DB-first read: for each roster in a league's current draft, its manager's
 * reach / value tendency across that manager's OTHER completed drafts.
 *
 * Identity: a manager is matched across leagues by `Roster.platformUserId`, the
 * one per-person key rosters carry. `DraftPick.ownerUserId` is NOT used: it is
 * whoever submitted the pick (a commissioner picking for someone, null for
 * autopicks), so it misattributes exactly the picks that are not a manager's own
 * choice. Leagues imported from different platforms carry different ids for the
 * same person, so history only links within one identity space.
 *
 * ADP per past pick: `pickMetadata.adpAtPick` when the pick recorded it (picks
 * made since this was added), else that league's cached draft pool. Picks with
 * neither are skipped, never guessed.
 */

import { prisma } from '@/lib/prisma'
import { isAiManagerPlatformUserId, isOrphanPlatformUserId } from '@/lib/orphan-ai-manager/orphan-platform-ids'
import { buildAdpLookup, type AdpLookup } from './draftPulse'
import { readLeaguePoolEntries } from './adpAtPick'
import { CURRENT_DRAFT_SESSION_ORDER } from './currentDraftSession'
import { summarizeManagerHistory, type HistoryPick, type ManagerHistorySummary } from './managerDraftHistory'

/** Past drafts considered per manager, newest first. */
export const MAX_HISTORY_DRAFTS_PER_MANAGER = 5

export type HistoryRosterRow = { id: string; leagueId: string; platformUserId: string }
export type HistorySessionRow = { id: string; leagueId: string; updatedAt: Date }
export type HistoryPickRow = {
  sessionId: string
  rosterId: string
  overall: number
  playerId: string | null
  playerName: string
  position: string
  pickMetadata: unknown
}

/**
 * A person-level identity, or null. Orphan and AI-manager rosters carry generated ids
 * and draft by algorithm, so they have no "style" to carry across leagues.
 */
export function managerIdentity(platformUserId: string | null | undefined): string | null {
  const id = String(platformUserId ?? '').trim()
  if (!id || isOrphanPlatformUserId(id) || isAiManagerPlatformUserId(id)) return null
  return id
}

export function adpFromPickMetadata(meta: unknown): number | null {
  if (!meta || typeof meta !== 'object') return null
  const v = (meta as { adpAtPick?: unknown }).adpAtPick
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
}

/**
 * Pure assembly. `lookupByLeague` supplies a pool ADP lookup for picks that did
 * not record their own ADP; a league with no cached pool simply has none.
 */
export function buildManagerHistoryByRoster(input: {
  currentRosters: readonly HistoryRosterRow[]
  identityRosters: readonly HistoryRosterRow[]
  pastSessions: readonly HistorySessionRow[]
  picks: readonly HistoryPickRow[]
  lookupByLeague: ReadonlyMap<string, AdpLookup>
  maxDraftsPerManager?: number
}): Record<string, ManagerHistorySummary | null> {
  const maxDrafts = input.maxDraftsPerManager ?? MAX_HISTORY_DRAFTS_PER_MANAGER
  const identityByRoster = new Map<string, string>()
  for (const r of input.identityRosters) {
    const identity = managerIdentity(r.platformUserId)
    if (identity) identityByRoster.set(r.id, identity)
  }
  const sessionById = new Map(input.pastSessions.map((s) => [s.id, s]))

  // Group usable past picks by manager identity.
  const picksByIdentity = new Map<string, Array<HistoryPick & { at: number }>>()
  for (const p of input.picks) {
    const identity = identityByRoster.get(p.rosterId)
    const session = sessionById.get(p.sessionId)
    if (!identity || !session) continue
    const adp =
      adpFromPickMetadata(p.pickMetadata) ??
      input.lookupByLeague.get(session.leagueId)?.({ playerId: p.playerId, playerName: p.playerName, position: p.position }) ??
      null
    if (adp == null) continue
    const list = picksByIdentity.get(identity) ?? []
    list.push({ sessionId: p.sessionId, overall: p.overall, adpAtPick: adp, at: session.updatedAt.getTime() })
    picksByIdentity.set(identity, list)
  }

  const out: Record<string, ManagerHistorySummary | null> = {}
  for (const roster of input.currentRosters) {
    const identity = managerIdentity(roster.platformUserId)
    const all = identity ? picksByIdentity.get(identity) ?? [] : []
    // Newest drafts first, capped, so an old style does not outvote a current one.
    const recentSessions = [...new Map(all.map((p) => [p.sessionId, p.at])).entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxDrafts)
      .map(([id]) => id)
    const keep = new Set(recentSessions)
    out[roster.id] = summarizeManagerHistory(all.filter((p) => keep.has(p.sessionId)))
  }
  return out
}

/** History for every roster in the league's current draft session. */
export async function loadManagerHistoryForLeague(
  leagueId: string,
): Promise<Record<string, ManagerHistorySummary | null>> {
  const current = await prisma.draftSession.findFirst({
    where: { leagueId },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
    select: { id: true, sportType: true },
  })
  if (!current) return {}

  const currentRosters = await prisma.roster.findMany({
    where: { leagueId },
    select: { id: true, leagueId: true, platformUserId: true },
  })
  const identities = [
    ...new Set(currentRosters.map((r) => managerIdentity(r.platformUserId)).filter((x): x is string => x != null)),
  ]
  if (identities.length === 0) return {}

  const identityRosters = await prisma.roster.findMany({
    where: { platformUserId: { in: identities } },
    select: { id: true, leagueId: true, platformUserId: true },
  })
  const pastSessions = await prisma.draftSession.findMany({
    where: {
      leagueId: { in: [...new Set(identityRosters.map((r) => r.leagueId))] },
      status: 'completed',
      id: { not: current.id },
      // ADP habits do not carry across sports; compare like with like when known.
      ...(current.sportType ? { sportType: current.sportType } : {}),
    },
    orderBy: { updatedAt: 'desc' },
    take: 200,
    select: { id: true, leagueId: true, updatedAt: true },
  })
  if (pastSessions.length === 0) return Object.fromEntries(currentRosters.map((r) => [r.id, null]))

  const picks = await prisma.draftPick.findMany({
    where: {
      sessionId: { in: pastSessions.map((s) => s.id) },
      rosterId: { in: identityRosters.map((r) => r.id) },
      assetType: 'player',
    },
    select: {
      sessionId: true,
      rosterId: true,
      overall: true,
      playerId: true,
      playerName: true,
      position: true,
      pickMetadata: true,
    },
  })

  // Pool fallback only for leagues that have picks without a recorded ADP.
  const sessionLeague = new Map(pastSessions.map((s) => [s.id, s.leagueId]))
  const leaguesNeedingPool = new Set(
    picks.filter((p) => adpFromPickMetadata(p.pickMetadata) == null).map((p) => sessionLeague.get(p.sessionId)!),
  )
  const lookupByLeague = new Map<string, AdpLookup>()
  for (const lid of leaguesNeedingPool) {
    const entries = await readLeaguePoolEntries(lid)
    if (entries.length > 0) lookupByLeague.set(lid, buildAdpLookup(entries))
  }

  return buildManagerHistoryByRoster({ currentRosters, identityRosters, pastSessions, picks, lookupByLeague })
}
