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
 * Strip a redundant `<provider>-` prefix from a source row's `externalId`.
 *
 * `SportsPlayer.externalId` encodes the provider locally (ESPN rows are stored as
 * `espn-11252`), but `PlayerProviderIdentity` is the cross-platform map, so it must hold the
 * id in the provider's own space (`11252` — the value that actually builds an ESPN headshot
 * URL). Without this, one player ends up with both `espn=espn-11252` and `espn=11252`, and
 * `getCanonicalPlayer`'s `providerIds` map silently keeps whichever landed last.
 *
 * `Player.providerIds` deliberately keeps the RAW externalId — the legacy `SportsPlayer`
 * mirror looks rows up by it.
 */
function normalizeProviderPlayerId(provider: string, rawId: string): string {
  const prefix = `${provider.toLowerCase()}-`
  return rawId.toLowerCase().startsWith(prefix) ? rawId.slice(prefix.length) : rawId
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

  let teams = 0
  let identities = 0

  for (const row of rows) {
    const identity = deriveCanonicalTeamIdentity({ name: row.name, sport: row.sport })
    if (!identity.normalizedName || !identity.sportKey) continue
    if (opts.dryRun) { teams++; continue }

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
      teams++

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

  return { teams, identities }
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
      height: true, weight: true, status: true, fetchedAt: true,
    },
  })) as SourcePlayer[]

  // Collapse source rows onto canonical identities.
  const grouped = new Map<string, SourcePlayer[]>()
  const strategies: Record<CanonicalMatchStrategy, number> = {
    sleeper_id: 0,
    name_sport_position: 0,
  }

  for (const row of sourceRows) {
    const identity = deriveCanonicalPlayerIdentity({
      name: row.name, sport: row.sport, position: row.position, sleeperId: row.sleeperId,
    })
    const list = grouped.get(identity.id) ?? []
    list.push(row)
    grouped.set(identity.id, list)
  }

  const teamCounts = await backfillCanonicalTeams(opts)

  let canonicalPlayers = 0
  // Count DISTINCT identities, not write operations: a Sleeper-sourced player writes the same
  // `(sleeper, sleeperId)` row twice — once explicitly, once via its `(source, externalId)`
  // pair — so counting operations overstated the result by ~55%.
  const identityKeys = new Set<string>()

  for (const [canonicalId, rows] of grouped) {
    const best = pickBestSourceRow(rows)
    const identity = deriveCanonicalPlayerIdentity({
      name: best.name, sport: best.sport, position: best.position, sleeperId: best.sleeperId,
    })
    strategies[identity.strategy]++

    if (opts.dryRun) { canonicalPlayers++; continue }

    const sportKey = normalizeSport(best.sport)

    try {
      await prisma.player.upsert({
        where: { id: canonicalId },
        create: {
          id: canonicalId,
          name: best.name,
          normalizedName: identity.normalizedName,
          sport: sportKey,
          // `position` and `league` are non-null on Player; SportsPlayer.position is nullable.
          position: best.position ?? 'UNK',
          league: sportKey,
          team: best.team,
          imageUrl: best.imageUrl,
          height: best.height,
          weight: best.weight,
          injuryStatus: best.status,
          providerIds: Object.fromEntries(
            rows.filter((r) => r.source && r.externalId).map((r) => [r.source, r.externalId]),
          ),
          source: 'phase2-backfill',
          confidence: identity.strategy === 'sleeper_id' ? 1 : 0.8,
          fetchedAt: new Date(),
          lastSeenAt: new Date(),
          active: true,
        },
        update: {
          name: best.name,
          normalizedName: identity.normalizedName,
          team: best.team,
          imageUrl: best.imageUrl,
          injuryStatus: best.status,
          lastSeenAt: new Date(),
        },
      })
      canonicalPlayers++

      // ── Provider identities ──
      // 1. Sleeper, the strongest cross-platform key.
      if (best.sleeperId) {
        if (await upsertProviderIdentity({
          playerId: canonicalId, sportKey, provider: 'sleeper',
          providerPlayerId: best.sleeperId, displayName: best.name,
        })) identityKeys.add(`sleeper|${best.sleeperId}`)
      }

      // 2. One identity per source row that collapsed into this player.
      for (const row of rows) {
        if (!row.source || !row.externalId) continue
        if (await upsertProviderIdentity({
          playerId: canonicalId, sportKey, provider: row.source,
          providerPlayerId: row.externalId, displayName: row.name,
        })) identityKeys.add(`${row.source}|${normalizeProviderPlayerId(row.source, row.externalId)}`)
      }

      // 3. Everything already crosswalked in PlayerIdentityMap, joined on sleeperId.
      if (best.sleeperId) {
        const map = await prisma.playerIdentityMap.findUnique({
          where: { sleeperId: best.sleeperId },
        })
        if (map) {
          for (const [key, provider] of IDENTITY_MAP_PROVIDERS) {
            const value = (map as unknown as Record<string, string | null>)[key]
            if (!value) continue
            if (await upsertProviderIdentity({
              playerId: canonicalId, sportKey, provider,
              providerPlayerId: value, displayName: best.name,
            })) identityKeys.add(`${provider}|${value}`)
          }
        }
      }
    } catch (err) {
      console.warn(
        `[backfill] player ${best.name}:`,
        err instanceof Error ? err.message : String(err),
      )
    }
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
