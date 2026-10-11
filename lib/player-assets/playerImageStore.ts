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
 *
 *      A non-null id is NOT on its own evidence of identity. `resolvePlayerHeadshot` derives
 *      a canonical id from (name, sport, position, team, sleeperId) when the caller has no
 *      `Player.id` to hand, and `deriveCanonicalPlayerIdentity` switches its whole match key
 *      depending on whether a sleeperId is present — so the id it produces for a live request
 *      routinely differs from the one the canonical backfill stored for the same human. That
 *      produced 215 orphan rows against 443 total in production before this check existed:
 *      well-formed ids pointing at no `Player`, invisible because `Player.id` carries no FK.
 *      So the write below verifies the row exists rather than trusting the id's shape.
 */

import type { Prisma } from '@prisma/client'
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

/*
 * ── Retiring rows written by the name-search resolver before 2026-10-11 ─────────────────────
 *
 * 🛑 THOSE ROWS CANNOT BE TRUSTED, AND THEY ARE NOT DELETED — THEY ARE NOT SERVED.
 * Until 2026-10-11 `resolvePlayerHeadshot` could bind a namesake's photo: its NFL canonical tier
 * took the first TheSportsDB search hit across every sport, and its `SportsPlayer` tier took a row
 * agreeing on team OR position, then any row at all. Each result was persisted here as the
 * player's primary image, so the wrong face outlived the bug by up to the 14-day TTL — and past it,
 * since a stale row is served when re-resolution comes back empty.
 *
 * The broken resolver is the ONLY writer of the provider values below; the other writer
 * (`writeCanonicalHeadshot`, identity-verified, `provider: 'espn'` today) is untouched. Rows from
 * the fixed resolver carry `rawPayload.headshotResolver = HEADSHOT_RESOLVER_VERSION`, which
 * nothing wrote before. So a row from one of these providers WITHOUT that stamp came from the
 * broken resolver: readers treat it as absent, the resolver re-resolves through the fixed path,
 * and the rewrite stamps it. Measured 2026-10-11: 5,293 primary rows (6,035 in all) retire;
 * every `espn` row (6,539) is unaffected.
 *
 * ⚠ A version stamp, not a write-time cutoff, on purpose: rows the OLD code writes between this
 * commit and its deploy would carry a post-cutoff `fetchedAt` and be trusted. Nothing but the new
 * code writes the stamp. No schema change: `raw_payload` is an existing nullable JSON column that
 * was NULL on every row when measured.
 */
export const HEADSHOT_RESOLVER_VERSION = 'v2'

/** Provider values written only by `resolvePlayerHeadshot` (its `HeadshotProvider` tiers). */
export const NAME_SEARCH_RESOLVER_PROVIDERS = [
  'sportsdb',
  'sportsplayer',
  'apisports',
  'sleeper',
  'clearsports',
  'none',
] as const

/** The `rawPayload` the fixed resolver stamps onto every row it writes. */
export function headshotResolverStamp(): { headshotResolver: string } {
  return { headshotResolver: HEADSHOT_RESOLVER_VERSION }
}

/**
 * Prisma `where` fragment for rows a reader may serve. Spread it into any `playerImage` query
 * that reads a URL; a reader without it re-opens the poisoned cache.
 */
export const TRUSTED_PLAYER_IMAGE_WHERE: Prisma.PlayerImageWhereInput = {
  OR: [
    { provider: null },
    { provider: { notIn: [...NAME_SEARCH_RESOLVER_PROVIDERS] } },
    { rawPayload: { path: ['headshotResolver'], equals: HEADSHOT_RESOLVER_VERSION } },
  ],
}

/** In-memory twin of `TRUSTED_PLAYER_IMAGE_WHERE`, for rows already loaded. */
export function isTrustedPlayerImageRow(row: { provider?: string | null; rawPayload?: unknown }): boolean {
  if (!row.provider) return true
  if (!(NAME_SEARCH_RESOLVER_PROVIDERS as readonly string[]).includes(row.provider)) return true
  const payload = row.rawPayload
  return Boolean(
    payload &&
      typeof payload === 'object' &&
      !Array.isArray(payload) &&
      (payload as Record<string, unknown>).headshotResolver === HEADSHOT_RESOLVER_VERSION,
  )
}

/**
 * The image URL a batch reader should serve for one player, given his primary `PlayerImage` row
 * (if any) and the denormalised `Player.imageUrl`.
 *
 * ⚠ FILTERING `PlayerImage` ALONE DOES NOT RETIRE A ROW. The image cron copies every resolution
 * into `Player.imageUrl` too — measured 2026-10-11, all 5,293 retired primaries had an identical
 * `Player.imageUrl` — and the batch readers fall back to that column. So a retired row also
 * suppresses `Player.imageUrl` when it is the same URL; a different URL came from elsewhere.
 */
export function servedPlayerImageUrl(
  primary: { url: string; provider?: string | null; rawPayload?: unknown } | null | undefined,
  playerImageUrl: string | null | undefined,
): string | null {
  if (primary) {
    if (isTrustedPlayerImageRow(primary)) return primary.url
    return playerImageUrl && playerImageUrl !== primary.url ? playerImageUrl : null
  }
  return playerImageUrl ?? null
}

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
  /**
   * Stored in `raw_payload`. `resolvePlayerHeadshot` passes `headshotResolverStamp()`, which is
   * what marks its rows as trusted; omitted, the column is left as it was.
   */
  rawPayload?: Record<string, unknown> | null
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
      // Rows the pre-2026-10-11 resolver wrote are not served; see TRUSTED_PLAYER_IMAGE_WHERE.
      where: { playerId, imageType, ...TRUSTED_PLAYER_IMAGE_WHERE },
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
      // The id must name a real canonical player. Checked inside the transaction so a
      // concurrent `Player` delete cannot slip a row in behind us.
      const player = await tx.player.findUnique({ where: { id: playerId }, select: { id: true } })
      if (!player) return { written: false, demoted: 0, skippedReason: 'unknown_player_id' }

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
        ...(args.rawPayload ? { rawPayload: args.rawPayload as Prisma.InputJsonObject } : {}),
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
