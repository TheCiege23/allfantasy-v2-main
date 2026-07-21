/**
 * Phase 1 — write-through store for canonical team images (`sports_core_team_images`).
 *
 * Mirrors `lib/player-assets/playerImageStore.ts`. See that file for the rationale behind
 * the read/demote/write contract; the constraints on `TeamImage` are identical
 * (`uniq_team_image_url` spans a nullable `teamId`, `url` is part of the unique key).
 *
 * ── Why teams are populated by the sync cron, not by a per-request write-through ──
 *
 * The headshot path is a live multi-provider network resolution, so caching it into the DB
 * is a straight win. Team logos are *not*: both live call sites —
 * `lib/players/getTeamLogo.ts` and `lib/player-media-urls.ts` — are synchronous, offline,
 * prisma-free pure functions that build an ESPN CDN URL from the static
 * `SportTeamMetadataRegistry`. `lib/player-media-urls.ts` documents the constraint
 * explicitly ("Keeps client bundles from importing lib/prisma ... do not import
 * TeamLogoResolver"). Making either of them write through would pull Prisma into client
 * bundles and turn a sync call into an async one across every transitive caller, in
 * exchange for caching a computation that costs microseconds.
 *
 * So this store exists to give Phase 2's `getCanonicalTeam()` a real read surface, and it
 * is filled server-side by `/api/cron/sync-player-images`. The client-safe sync helpers are
 * deliberately left alone.
 */

import { prisma } from '@/lib/prisma'

/** `image_type` discriminator for a team's primary logo. */
export const TEAM_IMAGE_TYPE_LOGO = 'logo'

/** Team logos are near-static (rebrands only); refresh far less often than headshots. */
export const TEAM_IMAGE_TTL_MS = 90 * 24 * 60 * 60 * 1000

export interface StoredTeamImage {
  url: string
  provider: string | null
  confidence: number | null
  fetchedAt: Date | null
  expiresAt: Date | null
  stale: boolean
}

export interface WriteTeamImageArgs {
  teamId: string | null | undefined
  sportKey: string
  leagueKey?: string | null
  imageType?: string
  url: string
  provider?: string | null
  confidence?: number | null
  ttlMs?: number
  now?: Date
}

export interface WriteTeamImageResult {
  written: boolean
  demoted: number
  skippedReason: string | null
}

function normalizeSportKey(sport: string | null | undefined): string {
  return String(sport ?? '').trim().toUpperCase()
}

/** Read the current primary image for a team. Never throws. */
export async function readPrimaryTeamImage(args: {
  teamId: string | null | undefined
  imageType?: string
  now?: Date
}): Promise<StoredTeamImage | null> {
  const teamId = args.teamId?.trim()
  if (!teamId) return null

  const imageType = args.imageType ?? TEAM_IMAGE_TYPE_LOGO
  const now = args.now ?? new Date()

  try {
    const row = await prisma.teamImage.findFirst({
      where: { teamId, imageType },
      orderBy: [{ isPrimary: 'desc' }, { fetchedAt: 'desc' }],
      select: { url: true, provider: true, confidence: true, fetchedAt: true, expiresAt: true },
    })
    if (!row?.url) return null

    return {
      url: row.url,
      provider: row.provider,
      confidence: row.confidence,
      fetchedAt: row.fetchedAt,
      expiresAt: row.expiresAt,
      stale: row.expiresAt ? row.expiresAt.getTime() <= now.getTime() : false,
    }
  } catch (err) {
    console.warn('[teamImageStore] read failed:', err instanceof Error ? err.message : String(err))
    return null
  }
}

/** Persist a team image as primary, demoting any previous primary. Never throws. */
export async function writePrimaryTeamImage(
  args: WriteTeamImageArgs,
): Promise<WriteTeamImageResult> {
  const teamId = args.teamId?.trim()
  const url = args.url?.trim()
  const sportKey = normalizeSportKey(args.sportKey)
  const imageType = args.imageType ?? TEAM_IMAGE_TYPE_LOGO

  if (!teamId) return { written: false, demoted: 0, skippedReason: 'missing_team_id' }
  if (!url) return { written: false, demoted: 0, skippedReason: 'missing_url' }
  if (!sportKey) return { written: false, demoted: 0, skippedReason: 'missing_sport_key' }

  const now = args.now ?? new Date()
  const expiresAt = new Date(now.getTime() + (args.ttlMs ?? TEAM_IMAGE_TTL_MS))

  try {
    return await prisma.$transaction(async (tx) => {
      const demotion = await tx.teamImage.updateMany({
        where: { teamId, imageType, isPrimary: true, NOT: { url } },
        data: { isPrimary: false },
      })

      const existing = await tx.teamImage.findFirst({
        where: { teamId, imageType, url },
        select: { id: true },
      })

      const shared = {
        provider: args.provider ?? null,
        confidence: args.confidence ?? null,
        isPrimary: true,
        fetchedAt: now,
        lastSeenAt: now,
        expiresAt,
      }

      if (existing) {
        await tx.teamImage.update({ where: { id: existing.id }, data: shared })
      } else {
        await tx.teamImage.create({
          data: {
            teamId,
            sportKey,
            leagueKey: args.leagueKey ?? null,
            imageType,
            url,
            ...shared,
          },
        })
      }

      return { written: true, demoted: demotion.count, skippedReason: null }
    })
  } catch (err) {
    const code = (err as { code?: string } | null)?.code
    if (code === 'P2002') return { written: true, demoted: 0, skippedReason: null }

    const message = err instanceof Error ? err.message : String(err)
    console.warn('[teamImageStore] write failed:', message)
    return { written: false, demoted: 0, skippedReason: `error:${message.slice(0, 120)}` }
  }
}
