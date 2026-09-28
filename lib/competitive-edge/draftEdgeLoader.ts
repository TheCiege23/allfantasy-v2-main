/**
 * Loads Competitive Edge for a draft (./draftEdge.ts holds the rule and the contract).
 *
 * DB-FIRST: reads the picks the Sleeper import wrote (`dw_draft_facts`) with the owner the sync
 * records on each (`metadata.ownerSleeperId`). It never calls Sleeper.
 *
 * ⚠ A PICK WITHOUT AN OWNER IS LEFT OUT, NEVER GUESSED. Seasons imported before the owner was
 * recorded carry none until `scripts/backfill-draft-owner-ids.ts` has run; those seasons are named
 * as unattributed, so a short record says why it is short instead of reading as a quiet drafter.
 *
 * ⚠ SLEEPER ONLY — the same boundary as the trade and waiver edges. Other importers' picks have no
 * owner id to match a person on.
 */
import 'server-only'

import { prisma } from '@/lib/prisma'
import { platformLabel } from '@/lib/core-app/platformLinks'
import type { SectionState } from '@/lib/core-app/leagueHome'
import type { CoreDepthAccess } from '@/lib/core-app/coreDepthAccess'
import { buildDraftEdge, type DraftEdge, type EdgeDraftPick } from './draftEdge'

function ownerOf(metadata: unknown): string | null {
  const v = metadata && typeof metadata === 'object' ? (metadata as { ownerSleeperId?: unknown }).ownerSleeperId : null
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

export async function loadDraftEdge(input: { leagueId: string; userId: string }): Promise<SectionState<DraftEdge>> {
  const league = await prisma.league.findUnique({
    where: { id: input.leagueId },
    select: { platform: true, platformLeagueId: true, sport: true },
  })
  if (!league) return { available: false, reason: 'This league could not be read.' }

  const platform = String(league.platform ?? '').toLowerCase()
  if (platform !== 'sleeper' || !league.platformLeagueId) {
    return {
      available: false,
      reason: `Competitive Edge reads Sleeper draft history today. ${platformLabel(platform)} leagues aren't connected yet.`,
    }
  }

  const [rows, teams] = await Promise.all([
    prisma.draftFact.findMany({
      where: { leagueId: input.leagueId },
      select: { season: true, round: true, playerId: true, metadata: true },
    }),
    prisma.leagueTeam.findMany({
      where: { leagueId: input.leagueId },
      select: { externalId: true, ownerName: true, teamName: true, platformUserId: true, claimedByUserId: true },
    }),
  ])

  const unattributed = new Set<number>()
  const owned: Array<{ season: number; round: number; playerId: string; owner: string }> = []
  for (const r of rows) {
    if (r.season == null) continue
    const owner = ownerOf(r.metadata)
    if (!owner) {
      unattributed.add(r.season)
      continue
    }
    owned.push({ season: r.season, round: r.round, playerId: r.playerId, owner })
  }

  // Positions from the league's own sport: a Sleeper id means nothing across sports.
  const playerIds = [...new Set(owned.map((p) => p.playerId))]
  const players =
    playerIds.length > 0
      ? await prisma.sportsPlayer
          .findMany({
            where: { sleeperId: { in: playerIds }, sport: String(league.sport) },
            select: { sleeperId: true, position: true },
          })
          .catch(() => [])
      : []
  const positionBySleeperId = new Map<string, string>()
  for (const pl of players) {
    if (pl.sleeperId && pl.position && !positionBySleeperId.has(pl.sleeperId)) positionBySleeperId.set(pl.sleeperId, pl.position)
  }

  const picks: EdgeDraftPick[] = owned.map((p) => ({
    season: p.season,
    round: p.round,
    position: positionBySleeperId.get(p.playerId) ?? null,
    ownerSleeperId: p.owner,
  }))

  const managers = teams
    .filter((t) => t.platformUserId?.trim())
    .map((t) => ({
      ownerSleeperId: t.platformUserId!.trim(),
      name: t.ownerName?.trim() || t.teamName?.trim() || 'A manager',
      teamExternalId: t.externalId,
    }))
  const viewer = teams.find((t) => t.claimedByUserId === input.userId) ?? null

  return {
    available: true,
    data: buildDraftEdge({
      picks,
      managers,
      viewerOwnerSleeperId: viewer?.platformUserId?.trim() || null,
      unattributedSeasons: [...unattributed],
    }),
  }
}

/**
 * The Draft HQ screen's read: the edge for a viewer whose plan includes it, and NOTHING otherwise.
 * The server withholds; the screen's lock only draws (the same rule as every /core depth).
 */
export async function loadDraftEdgeForScreen(input: {
  leagueId: string | null
  access: CoreDepthAccess | null
  userId: string
}): Promise<SectionState<DraftEdge> | null> {
  if (!input.leagueId || !input.access?.unlocked) return null
  return loadDraftEdge({ leagueId: input.leagueId, userId: input.userId }).catch(() => ({
    available: false as const,
    reason: 'Competitive Edge could not be read right now.',
  }))
}
