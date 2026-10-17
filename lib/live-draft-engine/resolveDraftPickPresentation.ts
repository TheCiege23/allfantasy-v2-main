/**
 * Resolve durable playerId + headshot URL for draft picks when the client/autopick
 * omits them. Used by the commissioner pick-edit service (assign / edit a pick).
 *
 * 🛑 SLEEPER NAMESPACE ONLY, AND AN ID THAT NAMES SOMEONE ELSE IS REFUSED (2026-10-11).
 *
 * This used to look a numeric id up as `OR: [{ sleeperId: id }, { externalId: id }]`. Sleeper's own
 * rows store `sleeper:<id>` in `externalId`, so the `externalId` arm only ever matched a Rolling
 * Insights / backfill / CFBD row — a provider number, for a different person. Measured on production:
 * 9,223 Rolling Insights rows carry an externalId equal to a DIFFERENT NFL player's sleeperId. The
 * first such row's `sleeperId` and `imageUrl` were then SAVED to the pick. Its name fallback kept
 * every namesake when position matched none and took row 0; its identity-map fallback retried
 * WITHOUT the team, so a namesake on another team could still be bound.
 *
 * Now:
 *   1. A numeric id is looked up only by `sleeperIdWhere` / `PlayerIdentityMap.sleeperId`, and only
 *      accepted when that person's name and side of the ball agree with the pick being written.
 *   2. Otherwise the name is resolved over Sleeper-namespace candidates with position AND team,
 *      refusing namesakes it cannot separate and a lone candidate that contradicts.
 *   3. A Sleeper CDN headshot is built only from a Sleeper id one of those two steps VERIFIED.
 */

import { toImageUrl } from '@/lib/media/imageUrl'
import type { LeagueSport } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { looksLikeSleeperExternalId } from '@/lib/draft-sports-models/player-asset-resolver'
import { sleeperHeadshotUrl } from '@/lib/player-media-urls'
import { indexBySleeperId, sleeperIdWhere } from '@/lib/player-identity/externalIdNamespace'
import { buildNameIndex, resolveVerifiedMatch } from '@/lib/player-match/verifiedNameMatch'
import {
  indexSleeperCandidates,
  loadSleeperCandidatesByName,
  matchTeam,
  resolveSleeperCandidate,
} from '@/lib/draft/sleeperNameCandidates'

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
 * Does this row describe the player being written? Same normalized name, and — when both sides say —
 * the same team and side of the ball. A row that fails this belongs to somebody else.
 */
function describesPick(
  row: { name: string; position?: string | null; team?: string | null },
  pick: { name: string; position: string | null; team: string | null },
): boolean {
  if (!pick.name) return false
  return (
    resolveVerifiedMatch(
      buildNameIndex([{ name: row.name, position: row.position ?? null, team: matchTeam(row.team) }]),
      { name: pick.name, position: pick.position, team: pick.team },
      { refuseContradictedSingle: true },
    ).match != null
  )
}

/**
 * Priority:
 * 1. Trust client `playerImageUrl` when present.
 * 2. Verify the id in the Sleeper namespace (or as our SportsPlayer PK) against name/position/team.
 * 3. Otherwise resolve name+position+team over Sleeper-namespace candidates, refusing ambiguity.
 * 4. Image from the verified row, then the Sleeper CDN from a VERIFIED Sleeper id.
 */
export async function resolveDraftPickPresentation(
  input: ResolveDraftPickPresentationInput,
): Promise<ResolveDraftPickPresentationResult> {
  const sport = sportKey(input.leagueSport)
  const name = input.playerName.trim()
  const pos = input.position.trim().toUpperCase() || null
  const team = matchTeam(input.team)
  const pick = { name, position: pos, team }

  const clientImage = trimOrNull(input.playerImageUrl ?? undefined)
  const rawPid = trimOrNull(input.playerId)

  /** A Sleeper id we have confirmed names this player. */
  let verifiedSleeperId: string | null = null
  let dbImage: string | null = null
  /** The caller's id names somebody else — it must not be saved as this player's id. */
  let idContradicted = false

  // --- 1. Lookup by id ---
  if (rawPid && !isSyntheticDraftPlayerId(rawPid)) {
    if (looksLikeSleeperExternalId(rawPid)) {
      const rows = await prisma.sportsPlayer.findMany({
        where: sleeperIdWhere([rawPid], sport),
        select: { name: true, sleeperId: true, source: true, imageUrl: true, team: true, position: true },
      })
      const row = indexBySleeperId(rows).get(rawPid)
      if (row) {
        if (describesPick(row, pick)) {
          verifiedSleeperId = rawPid
          dbImage = toImageUrl(row.imageUrl)
        } else {
          idContradicted = true
        }
      } else {
        const ident = await prisma.playerIdentityMap.findFirst({
          where: { sport, sleeperId: rawPid },
          select: { sleeperId: true, canonicalName: true, position: true, currentTeam: true },
        })
        if (ident) {
          if (describesPick({ name: ident.canonicalName, position: ident.position, team: ident.currentTeam }, pick)) {
            verifiedSleeperId = rawPid
          } else {
            idContradicted = true
          }
        }
      }
    } else {
      // UUID / internal SportsPlayer id
      const byPk = await prisma.sportsPlayer.findUnique({
        where: { id: rawPid },
        select: { sport: true, name: true, sleeperId: true, imageUrl: true, team: true, position: true },
      })
      if (byPk && byPk.sport === sport) {
        if (describesPick(byPk, pick)) {
          dbImage = toImageUrl(byPk.imageUrl)
          // Only the dedicated column — a provider row's bare `externalId` is that provider's number.
          const sid = trimOrNull(byPk.sleeperId)
          if (sid && looksLikeSleeperExternalId(sid)) verifiedSleeperId = sid
        } else {
          idContradicted = true
        }
      }
    }
  }

  // --- 2. Name + position + team, Sleeper namespace, ambiguity refused ---
  if (!verifiedSleeperId && !dbImage && name) {
    const candidates = await loadSleeperCandidatesByName(sport, [name])
    const match = resolveSleeperCandidate(indexSleeperCandidates(candidates), pick)
    if (match) {
      verifiedSleeperId = match.sleeperId
      dbImage = toImageUrl(match.imageUrl)
    }
  }

  // --- Image: client wins, then the verified row, then the Sleeper CDN for a VERIFIED id ---
  let imageOut = clientImage
  if (!imageOut && dbImage) imageOut = dbImage
  if (!imageOut && verifiedSleeperId) imageOut = sleeperHeadshotUrl(verifiedSleeperId, sport.toLowerCase())

  // --- Canonical playerId for persistence ---
  // A verified Sleeper id; else the caller's own non-synthetic id (another platform's id, a UUID)
  // when nothing says it is someone else; never an id that names a different player.
  let playerIdOut: string | null = null
  if (verifiedSleeperId) {
    playerIdOut = verifiedSleeperId
  } else if (rawPid && !isSyntheticDraftPlayerId(rawPid) && !idContradicted) {
    playerIdOut = rawPid
  }

  return {
    playerId: playerIdOut,
    playerImageUrl: imageOut,
  }
}
