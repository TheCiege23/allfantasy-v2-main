/**
 * Phase 2 — backfill the canonical `Player` / `Team` tables from the working roster data the
 * app has actually been using (`SportsPlayer` / `SportsTeam`), and populate the
 * cross-platform `PlayerProviderIdentity` / `TeamProviderIdentity` maps while doing it.
 *
 * This is a migration, not a live-resolution problem: both source tables are already
 * populated by existing ingestion, so the job is to collapse them onto one canonical row per
 * real player/team and record which provider ids point at that row.
 *
 * ── Why a dedup pass is needed at all ──
 * `SportsPlayer` is uniquely keyed on `(sport, externalId, source)`, so one human can appear
 * several times — once per ingesting source. `deriveCanonicalPlayerIdentity` collapses those
 * (see `canonicalIdentity.ts` for the matching-key decision), and every source row that folded
 * into a canonical player contributes its own `(source, externalId)` provider identity.
 *
 * ── Provider coverage ──
 * Identities come only from ids already captured in this codebase, per the brief's "don't
 * invent new lookups" constraint:
 *   - `SportsPlayer.sleeperId`               -> provider `sleeper`
 *   - `SportsPlayer.(source, externalId)`    -> that source, e.g. `espn`, `cfbd`, `api_sports`
 *   - `PlayerIdentityMap`, joined on sleeperId -> `espn`, `mfl`, `fleaflicker`, `api_sports`,
 *                                                `rolling_insights`, `fantasycalc`, `clearsports`
 * Fantrax is deliberately absent: no Fantrax id exists anywhere in the schema, so there is
 * nothing to map. Inventing a lookup for it was explicitly out of scope.
 */

import { prisma } from '@/lib/prisma'
import {
  deriveCanonicalPlayerIdentity,
  deriveCanonicalTeamIdentity,
  normalizePosition,
  normalizeSport,
  type CanonicalMatchStrategy,
} from '@/lib/canonical/canonicalIdentity'

export interface BackfillOptions {
  sport?: string
  limit?: number
  dryRun?: boolean
  batchSize?: number
}

export interface BackfillSummary {
  sourceRows: number
  canonicalPlayers: number
  canonicalTeams: number
  playerIdentities: number
  teamIdentities: number
  collapsedDuplicates: number
  strategies: Record<CanonicalMatchStrategy, number>
  dryRun: boolean
}

/**
 * Rows per batched write.
 *
 * The original per-row implementation issued ~4 queries per player (a `Player` upsert plus a
 * find-then-write for each provider identity). Measured against the real 95,839-row
 * `SportsPlayer` table that is ~344k sequential round trips to Neon: 4,884 players in ~12
 * minutes, extrapolating to **~3.5 hours** — long enough that a dropped connection mid-run is
 * likely, which is not a migration anyone should run against production. Batched
 * `INSERT ... ON CONFLICT` brings it to a few hundred round trips.
 */
const WRITE_BATCH = 500

/** Chunk a list for batched writes. */
function batches<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** Columns on `PlayerIdentityMap` that are provider ids, mapped to their provider name. */
const IDENTITY_MAP_PROVIDERS: Array<[key: string, provider: string]> = [
  ['espnId', 'espn'],
  ['mflId', 'mfl'],
  ['fleaflickerId', 'fleaflicker'],
  ['apiSportsId', 'api_sports'],
  ['rollingInsightsId', 'rolling_insights'],
  ['fantasyCalcId', 'fantasycalc'],
  ['clearSportsId', 'clearsports'],
]

interface SourcePlayer {
  id: string
  name: string
  sport: string
  position: string | null
  team: string | null
  externalId: string
  source: string
  sleeperId: string | null
  imageUrl: string | null
  height: string | null
  weight: string | null
  status: string | null
  fetchedAt: Date
  expiresAt: Date | null
}

/** Prefer the most complete, most recently fetched source row when several collapse together. */
function pickBestSourceRow(rows: SourcePlayer[]): SourcePlayer {
  return [...rows].sort((a, b) => {
    const score = (r: SourcePlayer) =>
      (r.imageUrl ? 4 : 0) + (r.position ? 2 : 0) + (r.team ? 1 : 0)
    const diff = score(b) - score(a)
    return diff !== 0 ? diff : b.fetchedAt.getTime() - a.fetchedAt.getTime()
  })[0]!
}

/**
 * Strip a redundant `<provider><sep>` prefix from a source row's `externalId`.
 *
 * `SportsPlayer.externalId` encodes the provider locally, but `PlayerProviderIdentity` is the
 * cross-platform map, so it must hold the id in the provider's own space — `11252`, the value
 * that actually builds an ESPN headshot URL, not `espn-11252`.
 *
 * Production uses THREE different separators for this, which only became visible when reading
 * real rows back: one NFL player carried `sleeper` identities of `3218` (from the `sleeperId`
 * column), `sleeper:3218` and `sleeper_3218` (both from `externalId`). Handling only `-` left
 * two duplicate identity rows per player and made `getCanonicalPlayer`'s `providerIds` map
 * report whichever landed last.
 *
 * `Player.providerIds` deliberately keeps the RAW externalId — the legacy `SportsPlayer`
 * mirror looks rows up by it.
 */
const PROVIDER_ID_SEPARATORS = ['-', '_', ':']

function normalizeProviderPlayerId(provider: string, rawId: string): string {
  const lower = rawId.toLowerCase()
  const p = provider.toLowerCase()
  for (const sep of PROVIDER_ID_SEPARATORS) {
    const prefix = `${p}${sep}`
    if (lower.startsWith(prefix)) return rawId.slice(prefix.length)
  }
  return rawId
}

/**
 * Split `SportsPlayer.status` into roster state and injury state.
 *
 * That column is mixed. Against the real NFL table it holds roster values (`Active` 10,930,
 * `Inactive` 2,979, `ACT` 1,159, `INACT` 367, `Retired` 136, `Free Agent`, `NA`) AND injury
 * values (`Questionable` 406, `Injured Reserve` 226, `IR`, `Injured`, `PUP`) in the same field.
 *
 * Copying it wholesale into `Player.injuryStatus` — which is what this backfill did until now —
 * gave ~10,930 NFL players an "injury status" of `Active`. Anything reading `injuryStatus` to
 * decide whether a player is hurt would have been wrong for the majority of the league.
 */
const ROSTER_ACTIVE = new Set(['ACTIVE', 'ACT'])
const ROSTER_INACTIVE = new Set(['INACTIVE', 'INACT', 'RETIRED', 'NA', 'FREE AGENT'])

export function classifySourceStatus(raw: string | null | undefined): {
  active: boolean
  injuryStatus: string | null
} {
  const value = String(raw ?? '').trim()
  if (!value) return { active: true, injuryStatus: null }
  const upper = value.toUpperCase()

  if (ROSTER_ACTIVE.has(upper)) return { active: true, injuryStatus: null }
  if (ROSTER_INACTIVE.has(upper)) return { active: false, injuryStatus: null }

  // Anything else is an injury/availability designation (Questionable, IR, PUP, Doubtful, Out,
  // Injured Reserve, ...). Those players are still on a roster, so `active` stays true.
  return { active: true, injuryStatus: value }
}

async function upsertProviderIdentity(args: {
  playerId: string
  sportKey: string
  provider: string
  providerPlayerId: string
  displayName: string
  teamId?: string | null
}): Promise<boolean> {
  const providerPlayerId = normalizeProviderPlayerId(args.provider, args.providerPlayerId?.trim() ?? '')
  if (!providerPlayerId) return false

  try {
    // NOT an upsert: `uniq_player_provider_identity` spans the nullable `leagueKey`, and
    // Prisma's compound-unique where-input demands a non-null String for it, so a
    // league-agnostic identity cannot be addressed that way. Find-then-write instead.
    const existing = await prisma.playerProviderIdentity.findFirst({
      where: {
        provider: args.provider,
        sportKey: args.sportKey,
        leagueKey: null,
        providerPlayerId,
      },
      select: { id: true },
    })

    if (existing) {
      await prisma.playerProviderIdentity.update({
        where: { id: existing.id },
        data: {
          playerId: args.playerId,
          displayName: args.displayName,
          teamId: args.teamId ?? null,
          lastSeenAt: new Date(),
        },
      })
    } else {
      await prisma.playerProviderIdentity.create({
        data: {
          playerId: args.playerId,
          sportKey: args.sportKey,
          leagueKey: null,
          provider: args.provider,
          providerPlayerId,
          displayName: args.displayName,
          teamId: args.teamId ?? null,
          confidence: 1,
          verified: true,
          source: 'phase2-backfill',
          lastSeenAt: new Date(),
        },
      })
    }
    return true
  } catch (err) {
    console.warn(
      `[backfill] identity ${args.provider}:${providerPlayerId} failed:`,
      err instanceof Error ? err.message : String(err),
    )
    return false
  }
}

interface PlayerWriteRow {
  id: string
  name: string
  normalizedName: string
  sport: string
  position: string
  league: string
  team: string | null
  imageUrl: string | null
  height: string | null
  weight: string | null
  injuryStatus: string | null
  active: boolean
  providerIds: Record<string, string>
  confidence: number
  /**
   * When the SOURCE row was actually observed, carried through from `SportsPlayer.fetchedAt`.
   *
   * This deliberately is NOT `now()`. Stamping backfill time here would make every canonical
   * row look freshly observed the moment a backfill runs, which is exactly the trap that makes
   * a freshness guard useless: it would measure "when did we last run the backfill" rather than
   * "when did anyone last actually see this player's team". `lastSeenAt` keeps backfill time.
   */
  sourceFetchedAt: Date | null
  sourceExpiresAt: Date | null
}

interface IdentityWriteRow {
  playerId: string
  sportKey: string
  provider: string
  providerPlayerId: string
  displayName: string
}

/**
 * Batched `INSERT ... ON CONFLICT DO UPDATE` for canonical players.
 *
 * Prisma has no bulk upsert, and `createMany({ skipDuplicates })` cannot update existing rows —
 * which the backfill must do to stay idempotent. Raw parameterized SQL is the only way to get
 * both properties in one round trip per batch. Values are bound, never interpolated.
 */
async function writePlayerBatches(rows: PlayerWriteRow[]): Promise<void> {
  for (const batch of batches(rows, WRITE_BATCH)) {
    const cols = 17
    const values = batch
      .map((_, i) => `(${Array.from({ length: cols }, (_, c) => `$${i * cols + c + 1}`).join(',')})`)
      .join(',')
    const params = batch.flatMap((r) => [
      r.id, r.name, r.normalizedName, r.sport, r.position, r.league, r.team,
      r.imageUrl, r.height, r.weight, r.injuryStatus, JSON.stringify(r.providerIds),
      'phase2-backfill', r.confidence, r.sourceFetchedAt, r.sourceExpiresAt, r.active,
    ])

    await prisma.$executeRawUnsafe(
      `INSERT INTO "Player" (
         id, name, normalized_name, sport, position, league, team, image_url,
         height, weight, "injuryStatus", provider_ids, source, confidence,
         fetched_at, expires_at, last_seen_at, active, "lastSyncedAt", "createdAt"
       )
       SELECT v.id, v.name, v.normalized_name, v.sport, v.position, v.league, v.team, v.image_url,
              v.height, v.weight, v."injuryStatus", v.provider_ids::jsonb, v.source, v.confidence::double precision,
              v.source_fetched_at::timestamp(3), v.source_expires_at::timestamp(3),
              now(), v.active::boolean, now(), now()
       FROM (VALUES ${values}) AS v(
         id, name, normalized_name, sport, position, league, team, image_url,
         height, weight, "injuryStatus", provider_ids, source, confidence,
         source_fetched_at, source_expires_at, active)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         normalized_name = EXCLUDED.normalized_name,
         team = EXCLUDED.team,
         image_url = EXCLUDED.image_url,
         "injuryStatus" = EXCLUDED."injuryStatus",
         active = EXCLUDED.active,
         fetched_at = EXCLUDED.fetched_at,
         expires_at = EXCLUDED.expires_at,
         provider_ids = EXCLUDED.provider_ids,
         last_seen_at = now(),
         "lastSyncedAt" = now()`,
      ...params,
    )
  }
}

/** Batched `INSERT ... ON CONFLICT` for provider identities. */
async function writeIdentityBatches(rows: IdentityWriteRow[]): Promise<void> {
  for (const batch of batches(rows, WRITE_BATCH)) {
    const cols = 5
    const values = batch
      .map((_, i) => `(${Array.from({ length: cols }, (_, c) => `$${i * cols + c + 1}`).join(',')})`)
      .join(',')
    const params = batch.flatMap((r) => [
      r.playerId, r.sportKey, r.provider, r.providerPlayerId, r.displayName,
    ])

    // `uniq_player_provider_identity` spans the nullable league_key. Postgres does not treat
    // NULLs as conflicting, so a plain ON CONFLICT on that index never fires for league-agnostic
    // rows; the partial unique index below is what makes this idempotent.
    await prisma.$executeRawUnsafe(
      `INSERT INTO sports_core_player_provider_identities (
         id, player_id, sport_key, league_key, provider, provider_player_id,
         display_name, confidence, verified, source, last_seen_at, created_at, updated_at
       )
       SELECT gen_random_uuid()::text, v.player_id, v.sport_key, NULL, v.provider, v.provider_player_id,
              v.display_name, 1, true, 'phase2-backfill', now(), now(), now()
       FROM (VALUES ${values}) AS v(player_id, sport_key, provider, provider_player_id, display_name)
       ON CONFLICT (provider, sport_key, provider_player_id)
         WHERE league_key IS NULL
       DO UPDATE SET
         player_id = EXCLUDED.player_id,
         display_name = EXCLUDED.display_name,
         last_seen_at = now()`,
      ...params,
    )
  }
}

/** Backfill canonical `Team` rows and their provider identities. Returns counts. */
export async function backfillCanonicalTeams(
  opts: BackfillOptions = {},
): Promise<{ teams: number; identities: number }> {
  const sport = opts.sport ? normalizeSport(opts.sport) : undefined
  const rows = await prisma.sportsTeam.findMany({
    where: sport ? { sport } : undefined,
    take: opts.limit,
    select: {
      id: true, sport: true, name: true, shortName: true, city: true,
      conference: true, division: true, logo: true, externalId: true, source: true,
    },
  })

  // Count DISTINCT canonical teams, not write operations: 1,738 `SportsTeam` rows collapse to
  // ~893 canonical teams (same team across sources/seasons), and counting operations reported
  // the source-row count instead, which read as "no collapse happened".
  const teamIds = new Set<string>()
  let identities = 0

  for (const row of rows) {
    const identity = deriveCanonicalTeamIdentity({ name: row.name, sport: row.sport })
    if (!identity.normalizedName || !identity.sportKey) continue
    if (opts.dryRun) { teamIds.add(identity.normalizedName); continue }

    try {
      // Find-then-write rather than upsert: both unique constraints below span a nullable
      // `leagueKey`, which Prisma's compound-unique where-input cannot express as null.
      const found = await prisma.team.findFirst({
        where: {
          sportKey: identity.sportKey,
          leagueKey: identity.leagueKey,
          normalizedName: identity.normalizedName,
        },
        select: { id: true },
      })

      const team = found
        ? await prisma.team.update({
            where: { id: found.id },
            data: { canonicalName: row.name, shortName: row.shortName, lastSeenAt: new Date() },
            select: { id: true },
          })
        : await prisma.team.create({
            data: {
              sportKey: identity.sportKey,
              leagueKey: identity.leagueKey,
              canonicalName: row.name,
              normalizedName: identity.normalizedName,
              shortName: row.shortName,
              abbreviation: row.shortName,
              city: row.city,
              conference: row.conference,
              division: row.division,
              source: 'phase2-backfill',
              confidence: 1,
              lastSeenAt: new Date(),
            },
            select: { id: true },
          })
      teamIds.add(team.id)

      if (row.externalId && row.source) {
        const existingIdentity = await prisma.teamProviderIdentity.findFirst({
          where: {
            provider: row.source,
            sportKey: identity.sportKey,
            leagueKey: null,
            providerTeamId: row.externalId,
          },
          select: { id: true },
        })

        if (existingIdentity) {
          await prisma.teamProviderIdentity.update({
            where: { id: existingIdentity.id },
            data: { teamId: team.id, displayName: row.name, lastSeenAt: new Date() },
          })
        } else {
          await prisma.teamProviderIdentity.create({
            data: {
              teamId: team.id,
              sportKey: identity.sportKey,
              leagueKey: null,
              provider: row.source,
              providerTeamId: row.externalId,
              displayName: row.name,
              confidence: 1,
              verified: true,
              source: 'phase2-backfill',
              lastSeenAt: new Date(),
            },
          })
        }
        identities++
      }
    } catch (err) {
      console.warn(`[backfill] team ${row.name}:`, err instanceof Error ? err.message : String(err))
    }
  }

  return { teams: teamIds.size, identities }
}

/**
 * Backfill canonical `Player` rows from `SportsPlayer`, collapsing duplicate source rows and
 * recording every provider id that resolves to each canonical player.
 */
export async function backfillCanonicalPlayers(
  opts: BackfillOptions = {},
): Promise<BackfillSummary> {
  const sport = opts.sport ? normalizeSport(opts.sport) : undefined

  const sourceRows = (await prisma.sportsPlayer.findMany({
    where: sport ? { sport } : undefined,
    take: opts.limit,
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true, name: true, sport: true, position: true, team: true,
      externalId: true, source: true, sleeperId: true, imageUrl: true,
      height: true, weight: true, status: true, fetchedAt: true, expiresAt: true,
    },
  })) as SourcePlayer[]

  // Collapse source rows onto canonical identities.
  const grouped = new Map<string, SourcePlayer[]>()
  const strategies: Record<CanonicalMatchStrategy, number> = {
    sleeper_id: 0,
    name_sport_position_team: 0,
  }

  for (const row of sourceRows) {
    const identity = deriveCanonicalPlayerIdentity({
      name: row.name, sport: row.sport, position: row.position,
      team: row.team, sleeperId: row.sleeperId,
    })
    const list = grouped.get(identity.id) ?? []
    list.push(row)
    grouped.set(identity.id, list)
  }

  const teamCounts = await backfillCanonicalTeams(opts)

  let canonicalPlayers = 0
  // Count DISTINCT identities, not write operations: a Sleeper-sourced player writes the same
  // `(sleeper, sleeperId)` row twice — once explicitly, once via its `(source, externalId)`
  // pair — so counting operations overstated the result by ~55%. Deduping here also means the
  // batched writer never sends the same identity twice in one statement.
  const identityKeys = new Set<string>()
  const playerRows: PlayerWriteRow[] = []
  const identityRows: IdentityWriteRow[] = []
  const crosswalkNeeded = new Map<string, { canonicalId: string; sportKey: string; name: string }>()

  for (const [canonicalId, rows] of grouped) {
    const best = pickBestSourceRow(rows)
    const identity = deriveCanonicalPlayerIdentity({
      name: best.name, sport: best.sport, position: best.position,
      team: best.team, sleeperId: best.sleeperId,
    })
    strategies[identity.strategy]++

    if (opts.dryRun) { canonicalPlayers++; continue }

    const sportKey = normalizeSport(best.sport)

    playerRows.push({
      id: canonicalId,
      name: best.name,
      normalizedName: identity.normalizedName,
      sport: sportKey,
      // `position` and `league` are non-null on Player; SportsPlayer.position is nullable.
      // Stored normalized ("Wide Receiver" -> "WR") so migrated call sites render the same
      // short codes the live Sleeper path gave them.
      position: normalizePosition(best.position) || 'UNK',
      league: sportKey,
      team: best.team,
      imageUrl: best.imageUrl,
      height: best.height,
      weight: best.weight,
      injuryStatus: classifySourceStatus(best.status).injuryStatus,
      active: classifySourceStatus(best.status).active,
      providerIds: Object.fromEntries(
        rows.filter((r) => r.source && r.externalId).map((r) => [r.source, r.externalId]),
      ),
      confidence: identity.strategy === 'sleeper_id' ? 1 : 0.8,
      // Real observation time from the source row, NOT now() — see PlayerWriteRow.
      sourceFetchedAt: best.fetchedAt ?? null,
      sourceExpiresAt: best.expiresAt ?? null,
    })

    // ── Provider identities, deduped in memory before any write ──
    // The dedup key MUST include sportKey, because the real uniqueness is
    // `(provider, sport_key, provider_player_id)`. Providers reuse small numeric ids across
    // sports — rolling_insights id "3126" exists for both NCAAB and MLB — so a key of
    // `provider|id` alone lets whichever sport is processed first claim the id and silently
    // drops every later sport's identity. That produced 0% identity coverage for MLB and NBA
    // at full scale while NFL looked fine.
    const addIdentity = (provider: string, rawId: string | null | undefined, display: string) => {
      const providerPlayerId = normalizeProviderPlayerId(provider, (rawId ?? '').trim())
      if (!providerPlayerId) return
      const key = `${provider}|${sportKey}|${providerPlayerId}`
      if (identityKeys.has(key)) return
      identityKeys.add(key)
      identityRows.push({ playerId: canonicalId, sportKey, provider, providerPlayerId, displayName: display })
    }

    // 1. Sleeper, the strongest cross-platform key.
    if (best.sleeperId) addIdentity('sleeper', best.sleeperId, best.name)
    // 2. One identity per source row that collapsed into this player.
    for (const row of rows) {
      if (row.source && row.externalId) addIdentity(row.source, row.externalId, row.name)
    }
    // 3. Everything already crosswalked in PlayerIdentityMap (resolved in bulk below).
    if (best.sleeperId) crosswalkNeeded.set(best.sleeperId, { canonicalId, sportKey, name: best.name })

    canonicalPlayers++
  }

  if (!opts.dryRun) {
    // Resolve every PlayerIdentityMap crosswalk in chunks rather than one findUnique per player.
    for (const keys of batches([...crosswalkNeeded.keys()], WRITE_BATCH)) {
      const maps = await prisma.playerIdentityMap.findMany({ where: { sleeperId: { in: keys } } })
      for (const map of maps) {
        const target = map.sleeperId ? crosswalkNeeded.get(map.sleeperId) : undefined
        if (!target) continue
        for (const [field, provider] of IDENTITY_MAP_PROVIDERS) {
          const value = (map as unknown as Record<string, string | null>)[field]
          if (!value) continue
          const providerPlayerId = normalizeProviderPlayerId(provider, value.trim())
          const key = `${provider}|${target.sportKey}|${providerPlayerId}`
          if (!providerPlayerId || identityKeys.has(key)) continue
          identityKeys.add(key)
          identityRows.push({
            playerId: target.canonicalId, sportKey: target.sportKey,
            provider, providerPlayerId, displayName: target.name,
          })
        }
      }
    }

    await writePlayerBatches(playerRows)
    await writeIdentityBatches(identityRows)
  }

  return {
    sourceRows: sourceRows.length,
    canonicalPlayers,
    canonicalTeams: teamCounts.teams,
    playerIdentities: identityKeys.size,
    teamIdentities: teamCounts.identities,
    collapsedDuplicates: sourceRows.length - grouped.size,
    strategies,
    dryRun: Boolean(opts.dryRun),
  }
}
