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

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  compactPlayerName,
  headshotPositionRelation,
  headshotTeamRelation,
} from '@/lib/player-assets/headshotCandidateMatch'

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
 * ── Rows written by the name-search resolver before 2026-10-11: served, unless detectably wrong ──
 *
 * Until 2026-10-11 `resolvePlayerHeadshot` could bind a namesake's photo: its NFL canonical tier
 * took the first TheSportsDB search hit across every sport, and its `SportsPlayer` tier took a row
 * agreeing on team OR position, then any row at all. Each result was persisted here as the
 * player's primary image.
 *
 * Those rows are identifiable: the broken resolver is the ONLY writer of the provider values
 * below, and the fixed resolver stamps `rawPayload.headshotResolver = HEADSHOT_RESOLVER_VERSION`,
 * which nothing wrote before (`raw_payload` was NULL on every row, measured 2026-10-11). A version
 * stamp rather than a write-time cutoff, because rows the OLD code writes between commit and
 * deploy would carry a post-cutoff time. No schema change.
 *
 * ⚠ STALE-WHILE-REVALIDATE, NOT RETIREMENT. 5,293 primary rows are unstamped and almost all of
 * them are correct, so hiding them all would trade a few hundred wrong faces for thousands of
 * blank ones. Unstamped rows ARE served, EXCEPT where they are detectably wrong (below); the image
 * cron's refresh pass re-resolves every unstamped row through the fixed path, wrong-first, and
 * the rewrite stamps it.
 *
 * "Detectably wrong" uses only signals that cannot be explained by the row being right:
 *   1. SHARED WITH A DIFFERENT PERSON. The URL is also the primary `PlayerImage`, or the
 *      `Player.imageUrl`, of another canonical player who is demonstrably somebody else — another
 *      sport, another name, a contradicting football position, or (when the other holder's image
 *      is identity-verified) another team. Same-name, same-sport sharers are NOT enough on their
 *      own: measured, most of those are duplicate `Player` rows for one human (Jordan Poyer,
 *      Lavonte David, Harrison Smith…) or a traded player listed twice, and both rows are right.
 *   2. A SLEEPER THUMBNAIL OF SOMEBODY ELSE. `sleepercdn.com/…/thumb/<id>.jpg` names its owner,
 *      so when Sleeper's own row for that id has another name or a contradicting position, the
 *      photo is that person's. This is the DL Chris Jones (KC) case: his row held Sleeper 5815,
 *      which is CB Chris Jones; LB Cole McDonald held 6954 (a QB), S Tre Thomas 6526 (an LB).
 * Either signal failing to compute (DB error) fails OPEN — the row is served, as it was before.
 *
 * Measured 2026-10-11 by feeding production rows through `findDetectablyWrongPlayerImages`: 201 of
 * the 5,293 unstamped primaries are suppressed (NCAAF 57, NFL 48, NBA 37, NCAAB 22, SOCCER 18,
 * NHL 10, MLB 9) — including all four named above and NFL Cam Jackson's NCAAB photo — and 5,092
 * stay served until re-resolved. Duplicate rows for one person (Jordan Poyer) are not touched.
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

/** Prisma `where` fragment selecting unstamped rows from the pre-2026-10-11 resolver. */
export const UNSTAMPED_RESOLVER_IMAGE_WHERE: Prisma.PlayerImageWhereInput = {
  provider: { in: [...NAME_SEARCH_RESOLVER_PROVIDERS] },
  // The stamp is the only thing ever written to raw_payload for these providers, so SQL NULL is
  // exactly "unstamped". (A `NOT path-equals` filter would also drop the NULL rows.)
  rawPayload: { equals: Prisma.DbNull },
}

/** False for a row the pre-2026-10-11 resolver wrote (it may still be served — see above). */
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

type ImageHolder = {
  playerId: string
  /** True when this player's hold on the URL includes a trusted (verified or stamped) row. */
  trusted: boolean
  name: string
  sport: string
  team: string | null
  position: string | null
}

const SHARED_URL_SNAPSHOT_TTL_MS = 10 * 60 * 1000
let sharedUrlSnapshot: { at: number; byUrl: Map<string, ImageHolder[]> } | null = null
let sharedUrlInflight: Promise<Map<string, ImageHolder[]>> | null = null

/** Test hook: forget the cached shared-URL snapshot. */
export function resetPlayerImageSuspicionCache(): void {
  sharedUrlSnapshot = null
  sharedUrlInflight = null
}

/**
 * Every headshot URL held by two or more canonical players, with who holds it. One aggregate
 * query (≈12.5k image rows + 91k `Player` rows, measured) cached in-process for 10 minutes — the
 * set only ever SHRINKS as the cron restamps rows, so a slightly old snapshot errs toward caution.
 */
async function sharedUrlHolders(now: number): Promise<Map<string, ImageHolder[]>> {
  if (sharedUrlSnapshot && now - sharedUrlSnapshot.at < SHARED_URL_SNAPSHOT_TTL_MS) return sharedUrlSnapshot.byUrl
  if (sharedUrlInflight) return sharedUrlInflight
  sharedUrlInflight = (async () => {
    try {
      const providers = [...NAME_SEARCH_RESOLVER_PROVIDERS]
      const rows = await prisma.$queryRaw<Array<{
        url: string
        player_id: string
        trusted: boolean
        name: string
        sport: string
        team: string | null
        position: string | null
      }>>`
        WITH holders AS (
          SELECT i.url, i.player_id,
                 (i.provider IS NULL OR NOT (i.provider = ANY(${providers}::text[]))
                  OR i.raw_payload->>'headshotResolver' = ${HEADSHOT_RESOLVER_VERSION}) AS trusted
            FROM sports_core_player_images i
           WHERE i.is_primary AND i.image_type = ${PLAYER_IMAGE_TYPE_HEADSHOT} AND i.player_id IS NOT NULL
          UNION ALL
          SELECT p.image_url, p.id, false FROM "Player" p WHERE p.image_url IS NOT NULL
        ),
        shared AS (SELECT url FROM holders GROUP BY url HAVING count(DISTINCT player_id) > 1)
        SELECT h.url, h.player_id, bool_or(h.trusted) AS trusted, p.name, p.sport, p.team, p.position
          FROM holders h JOIN shared s ON s.url = h.url JOIN "Player" p ON p.id = h.player_id
         GROUP BY h.url, h.player_id, p.name, p.sport, p.team, p.position`
      const byUrl = new Map<string, ImageHolder[]>()
      for (const row of rows) {
        const list = byUrl.get(row.url) ?? []
        list.push({
          playerId: row.player_id,
          trusted: Boolean(row.trusted),
          name: row.name,
          sport: String(row.sport ?? '').toUpperCase(),
          team: row.team,
          position: row.position,
        })
        byUrl.set(row.url, list)
      }
      sharedUrlSnapshot = { at: now, byUrl }
      return byUrl
    } catch (err) {
      console.warn('[playerImageStore] shared-url snapshot failed:', err instanceof Error ? err.message : String(err))
      return new Map<string, ImageHolder[]>()
    } finally {
      sharedUrlInflight = null
    }
  })()
  return sharedUrlInflight
}

/**
 * Who a headshot is about to be served for. `playerId` is the canonical `Player.id` when the
 * reader holds one; a `SportsPlayer` reader has only the name, sport, position and team.
 */
export type HeadshotSubject = {
  playerId?: string | null
  name: string
  sport: string
  team?: string | null
  position?: string | null
}

/*
 * Accents folded before comparing: `SportsPlayer`'s TheSportsDB rows write "Nikola Vučević" where
 * `Player` writes "Nikola Vucevic" (measured 2026-10-12, dozens of NBA/NHL/MLB pairs), and an
 * accent is never evidence of a different man. Suffixes are already dropped by compactPlayerName.
 */
function comparableName(name: string | null | undefined): string {
  return compactPlayerName(String(name ?? '').normalize('NFD').replace(/\p{M}/gu, ''))
}

/** Two holders of one URL who are demonstrably not the same human. */
function differentPeople(subject: HeadshotSubject, other: ImageHolder): boolean {
  const sport = String(subject.sport ?? '').toUpperCase()
  if (sport !== other.sport) return true
  if (comparableName(subject.name) !== comparableName(other.name)) return true
  if (headshotPositionRelation(sport, subject.position, other.position) === 'different') return true
  return other.trusted && headshotTeamRelation(sport, subject.team, other.team) === 'different'
}

const SLEEPER_THUMB = /sleepercdn\.com\/content\/nfl\/players\/thumb\/(\d+)\.jpg/i

/** The Sleeper id a Sleeper CDN thumbnail URL belongs to, or null. */
export function sleeperIdFromThumbUrl(url: string | null | undefined): string | null {
  const match = SLEEPER_THUMB.exec(String(url ?? ''))
  return match ? match[1]! : null
}

/**
 * Which of these (player, URL) pairs are detectably another person's photo. Pass only rows that
 * are NOT trusted — a verified or stamped row is never second-guessed here. Returns player ids.
 * Never throws; a failed lookup suppresses nothing.
 */
export async function findDetectablyWrongPlayerImages(
  entries: ReadonlyArray<{ playerId: string; url: string }>,
  opts: { now?: number } = {},
): Promise<Set<string>> {
  const wrong = new Set<string>()
  if (entries.length === 0) return wrong
  const byUrl = await sharedUrlHolders(opts.now ?? Date.now())
  const candidates = entries.filter((e) => byUrl.has(e.url) || sleeperIdFromThumbUrl(e.url))
  if (candidates.length === 0) return wrong

  try {
    const players = await prisma.player.findMany({
      where: { id: { in: [...new Set(candidates.map((e) => e.playerId))] } },
      select: { id: true, name: true, sport: true, team: true, position: true },
    })
    const subjectById = new Map(
      players.map((p) => [p.id, { playerId: p.id, name: p.name, sport: String(p.sport ?? '').toUpperCase(), team: p.team, position: p.position }]),
    )
    const withSubject = candidates.flatMap((e) => {
      const subject = subjectById.get(e.playerId)
      return subject ? [{ url: e.url, subject }] : []
    })
    for (const i of await wrongForSubjects(withSubject, byUrl)) wrong.add(withSubject[i]!.subject.playerId)
  } catch (err) {
    console.warn('[playerImageStore] suspicion check failed:', err instanceof Error ? err.message : String(err))
  }
  return wrong
}

/** Indexes of `entries` whose URL is detectably another person's photo. May throw; callers catch. */
async function wrongForSubjects(
  entries: ReadonlyArray<{ url: string; subject: HeadshotSubject }>,
  byUrl: Map<string, ImageHolder[]>,
): Promise<Set<number>> {
  const wrong = new Set<number>()
  const sleeperIds = [...new Set(entries.map((e) => sleeperIdFromThumbUrl(e.url)).filter((id): id is string => Boolean(id)))]
  const sleeperRows = sleeperIds.length
    ? await prisma.sportsPlayer.findMany({
        where: { sport: 'NFL', source: 'sleeper', externalId: { in: sleeperIds.map((id) => `sleeper:${id}`) } },
        select: { externalId: true, name: true, position: true, team: true },
      })
    : []
  const sleeperOwner = new Map((sleeperRows ?? []).map((r) => [String(r.externalId).replace(/^sleeper:/, ''), r]))

  entries.forEach(({ url, subject }, i) => {
    const holders = byUrl.get(url) ?? []
    /*
     * A trusted hold by this same person — his own verified row, or a duplicate `Player` row for
     * him — is the fixed resolver vouching the photo is his; the namesake sharing it is the wrong
     * one. Never true for the rows the pre-fix callers pass (their own hold is the untrusted row).
     */
    if (holders.some((h) => h.trusted && !differentPeople(subject, h))) return
    const others = holders.filter((h) => !subject.playerId || h.playerId !== subject.playerId)
    if (others.some((other) => differentPeople(subject, other))) {
      wrong.add(i)
      return
    }
    const sleeperId = sleeperIdFromThumbUrl(url)
    const owner = sleeperId ? sleeperOwner.get(sleeperId) : undefined
    if (
      owner &&
      differentPeople(subject, {
        playerId: `sleeper:${sleeperId}`,
        trusted: false,
        name: owner.name,
        sport: 'NFL',
        team: owner.team,
        position: owner.position,
      })
    ) {
      wrong.add(i)
    }
  })
  return wrong
}

/**
 * Which of these (subject, URL) pairs are detectably another person's photo, for a reader that
 * holds a NAME rather than a `PlayerImage` row — `Player.imageUrl` and `SportsPlayer.imageUrl`
 * readers. Same two signals as `findDetectablyWrongPlayerImages`, against the same snapshot.
 * Returns indexes into `entries`. Never throws; a failed lookup suppresses nothing.
 *
 * ⚠ ONLY SHARED URLS AND SLEEPER THUMBNAILS ARE JUDGED. Comparing a `SportsPlayer` name against
 * the one `Player` holding its URL would flag the same man under two spellings: measured
 * 2026-10-12, 189 of 386 `SportsPlayer` rows whose URL a differently-spelled `Player` holds are
 * that alone — "Camryn Bynum"/"Cam Bynum", "Mo Bamba"/"Mohamed Bamba", accents, a college
 * player now in the NBA. A URL two canonical players already contest is the evidence.
 */
export async function findDetectablyWrongHeadshots(
  entries: ReadonlyArray<{ url: string; subject: HeadshotSubject }>,
  opts: { now?: number } = {},
): Promise<Set<number>> {
  const candidates = entries
    .map((e, i) => ({ ...e, i }))
    .filter((e) => Boolean(e.url) && Boolean(e.subject.name))
  if (candidates.length === 0) return new Set()
  try {
    const byUrl = await sharedUrlHolders(opts.now ?? Date.now())
    const judged = candidates.filter((e) => byUrl.has(e.url) || sleeperIdFromThumbUrl(e.url))
    if (judged.length === 0) return new Set()
    const wrong = await wrongForSubjects(judged, byUrl)
    return new Set([...wrong].map((j) => judged[j]!.i))
  } catch (err) {
    console.warn('[playerImageStore] headshot suspicion check failed:', err instanceof Error ? err.message : String(err))
    return new Set()
  }
}

/**
 * `SportsPlayer` rows with `imageUrl` nulled where it is detectably another person's photo —
 * apply right after the read, before `asHeadshotUrl` / composition. Other rows are returned as-is.
 *
 * ⚠ THE IMAGE CRON COPIED EVERY RESOLUTION INTO `SportsPlayer.imageUrl` TOO (`mirrorToLegacy`),
 * so suppressing the `PlayerImage` row left the same photo one column away: NFL DL Cam Jackson's
 * Rolling Insights row (8966) carried NCAAB forward Cameron Jackson's cutout on the player card.
 */
export async function withoutDetectablyWrongHeadshots<
  T extends { name?: string | null; sport?: string | null; team?: string | null; position?: string | null; imageUrl?: string | null },
>(rows: readonly T[]): Promise<T[]> {
  const wrong = await findDetectablyWrongHeadshots(
    rows.map((r) => ({
      url: String(r.imageUrl ?? '').trim(),
      subject: { name: String(r.name ?? ''), sport: String(r.sport ?? ''), team: r.team ?? null, position: r.position ?? null },
    })),
  )
  return wrong.size === 0 ? [...rows] : rows.map((r, i) => (wrong.has(i) ? { ...r, imageUrl: null } : r))
}

/**
 * Player ids in one sport whose primary image is an unstamped pre-fix row that is detectably
 * wrong — the image cron re-resolves these before any other refresh.
 */
export async function listDetectablyWrongPlayerImageIds(sportKey: string): Promise<string[]> {
  try {
    const byUrl = await sharedUrlHolders(Date.now())
    const rows = await prisma.playerImage.findMany({
      where: {
        sportKey,
        imageType: PLAYER_IMAGE_TYPE_HEADSHOT,
        isPrimary: true,
        ...UNSTAMPED_RESOLVER_IMAGE_WHERE,
        OR: [{ url: { in: [...byUrl.keys()] } }, { url: { contains: 'sleepercdn.com/content/nfl/players/thumb/' } }],
      },
      select: { playerId: true, url: true },
    })
    const entries = rows
      .filter((r): r is { playerId: string; url: string } => Boolean(r.playerId))
    return [...(await findDetectablyWrongPlayerImages(entries))]
  } catch (err) {
    console.warn('[playerImageStore] wrong-image listing failed:', err instanceof Error ? err.message : String(err))
    return []
  }
}

/**
 * The image URL a batch reader should serve for one player, given his primary `PlayerImage` row
 * (if any), the denormalised `Player.imageUrl`, and whether that row is detectably wrong.
 *
 * ⚠ SUPPRESSING THE ROW ALONE DOES NOT SUPPRESS THE IMAGE. The image cron copies every
 * resolution into `Player.imageUrl` too — measured 2026-10-11, all 5,293 unstamped primaries had
 * an identical `Player.imageUrl` — and the batch readers fall back to that column. So a
 * suppressed row also suppresses `Player.imageUrl` when it is the same URL.
 *
 * With NO primary row, `detectablyWrong` is about `Player.imageUrl` itself — callers judge that
 * column with `findDetectablyWrongPlayerImages` too. Measured 2026-10-12: 196 of the 566 `Player`
 * rows whose URL another player shares have no primary `PlayerImage` row, so before this they were
 * served raw by every batch reader.
 */
export function servedPlayerImageUrl(
  primary: { url: string; provider?: string | null; rawPayload?: unknown } | null | undefined,
  playerImageUrl: string | null | undefined,
  detectablyWrong = false,
): string | null {
  if (primary) {
    if (!detectablyWrong || isTrustedPlayerImageRow(primary)) return primary.url
    return playerImageUrl && playerImageUrl !== primary.url ? playerImageUrl : null
  }
  return detectablyWrong ? null : (playerImageUrl ?? null)
}

/**
 * The (player, URL) pairs a batch reader should judge: the untrusted primary rows, and the bare
 * `Player.imageUrl` of every player who has no primary row. A trusted primary is never judged;
 * `Player.imageUrl` beside a primary row is handled by `servedPlayerImageUrl`.
 */
export function playerImageEntriesToJudge(
  players: ReadonlyArray<{ id: string; imageUrl?: string | null }>,
  primaryById: ReadonlyMap<string, { url: string; provider?: string | null; rawPayload?: unknown }>,
): Array<{ playerId: string; url: string }> {
  const out: Array<{ playerId: string; url: string }> = []
  for (const p of players) {
    const primary = primaryById.get(p.id)
    if (primary) {
      if (!isTrustedPlayerImageRow(primary)) out.push({ playerId: p.id, url: primary.url })
    } else if (p.imageUrl) {
      out.push({ playerId: p.id, url: p.imageUrl })
    }
  }
  return out
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
      where: { playerId, imageType },
      orderBy: [{ isPrimary: 'desc' }, { fetchedAt: 'desc' }],
      select: { url: true, provider: true, confidence: true, fetchedAt: true, expiresAt: true, rawPayload: true },
    })
    if (!row?.url) return null

    // A pre-2026-10-11 resolver row is served unless it is detectably somebody else's photo
    // (see the note on HEADSHOT_RESOLVER_VERSION). Returning null here also keeps the resolver
    // from serving it as a stale fallback.
    if (!isTrustedPlayerImageRow(row)) {
      const wrong = await findDetectablyWrongPlayerImages([{ playerId, url: row.url }], { now: now.getTime() })
      if (wrong.has(playerId)) return null
    }

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
