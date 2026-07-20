/**
 * Phase 1 — write-through cache for canonical player images (`sports_core_player_images`).
 *
 * Before this module the `PlayerImage` table had exactly one writer in the entire
 * codebase — `scripts/sync-player-images.ts` — and that write was dead: it passed a
 * `source` field the model does not have and omitted the required `sportKey` /
 * `imageType`, so every call threw `Argument 'sportKey' is missing` straight into a
 * bare `catch {}`. The table has therefore never held a row.
 *
 * The contract here is deliberately narrow:
 *   - `readPrimaryPlayerImage()`  — cheap indexed read of the current primary image.
 *   - `writePrimaryPlayerImage()` — persist a freshly-resolved image as the new primary,
 *                                   demoting whatever used to be primary for that player.
 *
 * Two properties every caller depends on:
 *   1. **Never throws.** These are cache operations layered under a resolver that must
 *      keep working when the DB is unavailable. Failures are logged and reported via the
 *      return value, never raised.
 *   2. **Never invents identity.** A write without a real `playerId` is refused rather
 *      than stored against NULL — the `uniq_player_image_url` constraint spans a nullable
 *      `playerId`, and Postgres does not dedupe NULLs, so NULL-keyed rows would accumulate
 *      one duplicate per resolution forever.
 */

import { prisma } from '@/lib/prisma'

/** `image_type` discriminator for a player headshot. */
export const PLAYER_IMAGE_TYPE_HEADSHOT = 'headshot'

/**
 * How long a persisted headshot is trusted before the resolver re-checks providers.
 * Headshots change on team moves and new-season photo days — rarely, but they do change,
 * so this is a refresh cadence rather than a correctness boundary. A stale row is still
 * served if re-resolution fails (see `resolvePlayerHeadshot`).
 */
export const PLAYER_IMAGE_TTL_MS = 14 * 24 * 60 * 60 * 1000

export interface StoredPlayerImage {
  url: string
  provider: string | null
  confidence: number | null
  fetchedAt: Date | null
  expiresAt: Date | null
  /** True when `expiresAt` has passed — caller may re-resolve but can still use `url`. */
  stale: boolean
}

export interface WritePlayerImageArgs {
  /** Player identity this image belongs to. Required — writes without it are refused. */
  playerId: string | null | undefined
  sportKey: string
  leagueKey?: string | null
  imageType?: string
  url: string
  /** Resolver tier that produced the URL (`clearsports`, `sportsdb`, …). */
  provider?: string | null
  /** 0–1 confidence. The resolver's categorical confidence is mapped by the caller. */
  confidence?: number | null
  ttlMs?: number
  /** Injectable for tests. */
  now?: Date
}

export interface WritePlayerImageResult {
  written: boolean
  /** Number of previously-primary rows demoted to make room for this one. */
  demoted: number
  /** Set when the write was skipped or failed — `null` on success. */
  skippedReason: string | null
}

function normalizeSportKey(sport: string | null | undefined): string {
  return String(sport ?? '').trim().toUpperCase()
}

/**
 * Read the current primary image for a player.
 *
 * Ordered `isPrimary desc, fetchedAt desc` so that a row demoted mid-write is never
 * preferred over the live primary, and so the newest row wins if a previous crash left
 * two primaries behind.
 */
export async function readPrimaryPlayerImage(args: {
  playerId: string | null | undefined
  imageType?: string
  now?: Date
}): Promise<StoredPlayerImage | null> {
  const playerId = args.playerId?.trim()
  if (!playerId) return null

  const imageType = args.imageType ?? PLAYER_IMAGE_TYPE_HEADSHOT
  const now = args.now ?? new Date()

  try {
    const row = await prisma.playerImage.findFirst({
      where: { playerId, imageType },
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
    console.warn('[playerImageStore] read failed:', err instanceof Error ? err.message : String(err))
    return null
  }
}

/**
 * Persist a resolved image as the player's primary, demoting any other primary rows.
 *
 * Note on the upsert shape: `uniq_player_image_url` spans `(playerId, imageType, url)`,
 * and `playerId` is nullable, so we deliberately do NOT use Prisma's compound-unique
 * upsert input here. We read-then-write inside a transaction and treat a unique-violation
 * (P2002) from a concurrent writer as success — the row we wanted exists either way.
 *
 * Because `url` is part of the unique key, a player whose headshot URL changes produces a
 * *new* row rather than an update. That is intentional: it preserves image history. The
 * demote step is what keeps exactly one row primary.
 */
export async function writePrimaryPlayerImage(
  args: WritePlayerImageArgs,
): Promise<WritePlayerImageResult> {
  const playerId = args.playerId?.trim()
  const url = args.url?.trim()
  const sportKey = normalizeSportKey(args.sportKey)
  const imageType = args.imageType ?? PLAYER_IMAGE_TYPE_HEADSHOT

  // Refuse rather than write a row we could never dedupe or attribute.
  if (!playerId) return { written: false, demoted: 0, skippedReason: 'missing_player_id' }
  if (!url) return { written: false, demoted: 0, skippedReason: 'missing_url' }
  if (!sportKey) return { written: false, demoted: 0, skippedReason: 'missing_sport_key' }

  const now = args.now ?? new Date()
  const expiresAt = new Date(now.getTime() + (args.ttlMs ?? PLAYER_IMAGE_TTL_MS))

  try {
    return await prisma.$transaction(async (tx) => {
      // Demote first: a brief window with zero primaries is safe, two primaries is not.
      const demotion = await tx.playerImage.updateMany({
        where: { playerId, imageType, isPrimary: true, NOT: { url } },
        data: { isPrimary: false },
      })

      const existing = await tx.playerImage.findFirst({
        where: { playerId, imageType, url },
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
        await tx.playerImage.update({ where: { id: existing.id }, data: shared })
      } else {
        await tx.playerImage.create({
          data: {
            playerId,
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
    // A concurrent writer landing the same (playerId, imageType, url) is a success for us.
    const code = (err as { code?: string } | null)?.code
    if (code === 'P2002') return { written: true, demoted: 0, skippedReason: null }

    const message = err instanceof Error ? err.message : String(err)
    console.warn('[playerImageStore] write failed:', message)
    return { written: false, demoted: 0, skippedReason: `error:${message.slice(0, 120)}` }
  }
}
