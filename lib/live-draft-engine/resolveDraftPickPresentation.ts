/**
 * Resolve durable playerId + headshot URL for draft picks when the client/autopick
 * omits them. Used by submitPick so all pick sources share one path.
 */

import { toImageUrl } from '@/lib/media/imageUrl'
import type { LeagueSport } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { looksLikeSleeperExternalId } from '@/lib/draft-sports-models/player-asset-resolver'
import { sleeperHeadshotUrl } from '@/lib/player-media-urls'

function trimOrNull(s: string | null | undefined): string | null {
  const t = s?.trim()
  return t ? t : null
}

/** Synthetic keys from normalizeDraftPlayer (`name:...`) — never persist as canonical id when we can resolve real. */
export function isSyntheticDraftPlayerId(id: string | null | undefined): boolean {
  const t = String(id ?? '').trim()
  if (!t) return true
  return t.includes(':')
}

function sportKey(sport: LeagueSport | string): string {
  return String(sport ?? 'NFL').toUpperCase()
}

export type ResolveDraftPickPresentationInput = {
  leagueSport: LeagueSport | string
  playerName: string
  position: string
  team?: string | null
  playerId?: string | null
  /** When set, treated as highest-priority image (client / pool already resolved). */
  playerImageUrl?: string | null
}

export type ResolveDraftPickPresentationResult = {
  playerId: string | null
  playerImageUrl: string | null
}

/**
 * Priority:
 * 1. Trust client `playerImageUrl` when present.
 * 2. Resolve DB row via external/sleeper id, SportsPlayer PK, or name+position+team.
 * 3. Fill image from DB `imageUrl`, then Sleeper CDN from numeric external id.
 * 4. Prefer storing real Sleeper/external id over UUID or synthetic keys.
 */
export async function resolveDraftPickPresentation(
  input: ResolveDraftPickPresentationInput,
): Promise<ResolveDraftPickPresentationResult> {
  const sport = sportKey(input.leagueSport)
  const name = input.playerName.trim()
  const pos = input.position.trim().toUpperCase()
  const teamUpper = trimOrNull(input.team)?.toUpperCase() ?? null

  let imageOut = trimOrNull(input.playerImageUrl ?? undefined)
  let resolvedExternal: string | null = null
  let dbImage: string | null = null

  const rawPid = trimOrNull(input.playerId)

  const tryAssignFromSportsPlayer = (sp: {
    id: string
    sleeperId: string | null
    externalId: string
    imageUrl: string | null
    team: string | null
    position: string | null
  }) => {
    dbImage = toImageUrl(sp.imageUrl)
    resolvedExternal = trimOrNull(sp.sleeperId) ?? (looksLikeSleeperExternalId(sp.externalId) ? sp.externalId : null)
  }

  // --- Lookup by id ---
  if (rawPid && !isSyntheticDraftPlayerId(rawPid)) {
    if (looksLikeSleeperExternalId(rawPid)) {
      const bySleeper = await prisma.sportsPlayer.findFirst({
        where: {
          sport,
          OR: [{ sleeperId: rawPid }, { externalId: rawPid }],
        },
        select: { id: true, sleeperId: true, externalId: true, imageUrl: true, team: true, position: true },
      })
      if (bySleeper) tryAssignFromSportsPlayer(bySleeper)
      if (!resolvedExternal) {
        const ident = await prisma.playerIdentityMap.findFirst({
          where: { sport, sleeperId: rawPid },
          select: { sleeperId: true },
        })
        if (ident?.sleeperId) resolvedExternal = ident.sleeperId
      }
      if (!resolvedExternal && looksLikeSleeperExternalId(rawPid)) resolvedExternal = rawPid
    } else {
      // UUID / internal SportsPlayer id
      const byPk = await prisma.sportsPlayer.findUnique({
        where: { id: rawPid },
        select: {
          sport: true,
          id: true,
          sleeperId: true,
          externalId: true,
          imageUrl: true,
          team: true,
          position: true,
        },
      })
      if (byPk && byPk.sport === sport) {
        tryAssignFromSportsPlayer(byPk)
      }
    }
  }

  // --- Name + position + optional team ---
  if (!resolvedExternal && !dbImage && name) {
    const rows = await prisma.sportsPlayer.findMany({
      where: {
        sport,
        name: { equals: name, mode: 'insensitive' },
      },
      take: 25,
      select: { id: true, sleeperId: true, externalId: true, imageUrl: true, team: true, position: true },
    })
    let candidates = rows.filter((r) => !pos || (String(r.position ?? '').trim().toUpperCase() === pos))
    if (!candidates.length) candidates = rows
    if (teamUpper && candidates.length > 1) {
      const teamFiltered = candidates.filter((r) => (r.team ?? '').toUpperCase() === teamUpper)
      if (teamFiltered.length) candidates = teamFiltered
    }
    const first = candidates[0]
    if (first) tryAssignFromSportsPlayer(first)
  }

  // --- PlayerIdentityMap by normalized name ---
  if (!resolvedExternal && name) {
    const normalizedName = name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
    if (normalizedName) {
      const identWhere: {
        sport: string
        normalizedName: string
        position?: string
        currentTeam?: string
      } = { sport, normalizedName }
      if (pos) identWhere.position = pos
      if (teamUpper) identWhere.currentTeam = teamUpper

      let ident = await prisma.playerIdentityMap.findFirst({
        where: identWhere,
        select: { sleeperId: true },
      })
      if (!ident?.sleeperId && teamUpper) {
        ident = await prisma.playerIdentityMap.findFirst({
          where: { sport, normalizedName },
          select: { sleeperId: true },
        })
      }
      if (ident?.sleeperId) resolvedExternal = ident.sleeperId
    }
  }

  // --- Image: client wins, then DB, then Sleeper CDN ---
  if (!imageOut && dbImage) imageOut = dbImage
  const cdnId = resolvedExternal && looksLikeSleeperExternalId(resolvedExternal) ? resolvedExternal : null
  if (!imageOut && cdnId) {
    imageOut = sleeperHeadshotUrl(cdnId, sport.toLowerCase())
  }

  // --- Canonical playerId for persistence: real Sleeper/external id, else non-synthetic client id (e.g. UUID) ---
  let playerIdOut: string | null = null
  if (resolvedExternal) {
    playerIdOut = resolvedExternal
  } else if (rawPid && !isSyntheticDraftPlayerId(rawPid)) {
    playerIdOut = rawPid
  }

  return {
    playerId: playerIdOut,
    playerImageUrl: imageOut,
  }
}
