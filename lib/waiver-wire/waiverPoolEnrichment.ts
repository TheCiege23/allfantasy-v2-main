/**
 * Waiver wire — the photo, crest and season stats for each available pool row, from Postgres.
 *
 * The `/players` route used to join `sports_players` (`SportsPlayerRecord`) on the pool row's
 * `player_id`. That is a `SportsPlayer.id` — a UUID — and `sports_players.id` is `SPORT:<rest>`
 * (`NBA:284`, `NBA:jalen-brunson:NEW YORK KNICKS`). Measured 2026-10-20: ZERO NFL or NBA rows share
 * an id across the two tables, so every waiver row in every sport came back with no stats and no
 * projection. The same pool row's photo (`image_url`, already de-duplicated to the best one by
 * `SportPlayerPoolResolver`) was never forwarded either, because `poolPlayerRecordToRawDraftLike`
 * reads images from `metadata` only — so outside the NFL, where no Sleeper id builds a CDN URL,
 * nobody had a headshot.
 *
 * This joins the way the draft room does (`sportsPlayerRecordDraftEnrichment.ts`): one batched read
 * by name, then a strict name + position + team key, and a loose name + position key only when the
 * pool row has no team and the loose bucket names exactly one player. Two adjustments, both
 * measured on production rather than assumed:
 *
 *  - Outside the NFL, `SportsPlayer.team` is a display name ("New York Knicks") and
 *    `sports_players.team` is a code with vendor variants ("NYK", "NO"/"NOP", "UTA"/"UTAH",
 *    "LA"/"LAK"). Both sides go through `proTeamCode`, the pro-sport team registry the Fantrax
 *    identity matcher already uses, before keying.
 *  - Basketball keys on name + team without position, for the reason `proFantraxIdentityPlan.ts`
 *    records: sources disagree on an NBA player's position for most of the league (Jrue Holiday is
 *    PG in one table and SG in the other).
 *
 * Team crests outside the NFL come from the stored `SportsTeam.logo` (`getStoredTeamLogoResolver`),
 * the same source `getPlayerDataForSurface` uses; the NFL keeps its static registry path.
 *
 * Server-only. Reads Postgres only — never a provider.
 */

import { prisma } from '@/lib/prisma'
import type { PoolPlayerRecord } from '@/lib/sport-teams/types'
import type { UnifiedPlayerAugment } from '@/lib/player-data/unifiedPlayerProductView'
import { toImageUrl } from '@/lib/media/imageUrl'
import { getStoredTeamLogoResolver } from '@/lib/sport-teams/storedTeamLogos'
import { proTeamCode, type ProFantraxSport } from '@/lib/player-identity/proFantraxIdentityPlan'
import {
  buildLoosePlayerKey,
  buildStrictPlayerKey,
  isFreeAgentTeam,
} from '@/lib/player-identity/playerIdentityResolution'
import { pickWaiverHeadlineStats } from '@/lib/player-data/adapters/waiverPlayerAdapter'

export type WaiverPoolEnrichment = {
  /** Merged into the pool row's `metadata`, which is where the normalizer reads media from. */
  metadata: { imageUrl?: string; headshotUrl?: string; teamLogoUrl?: string }
  sportsPlayerRecord?: NonNullable<UnifiedPlayerAugment['sportsPlayerRecord']>
}

type RecordRow = {
  id: string
  name: string
  team: string
  position: string
  stats: unknown
  projections: unknown
  adp: number | null
  dataSource: string
  headshotSource: string | null
}

const PRO_SPORTS = new Set<ProFantraxSport>(['MLB', 'NBA', 'NHL'])
const NAME_BATCH_LIMIT = 2800

/** The team string both sides key on: a registry code for the pro sports, the raw value otherwise. */
export function identityTeamFor(sport: string, team: string | null | undefined): string | null {
  const raw = String(team ?? '').trim()
  if (!raw) return null
  const s = sport.toUpperCase() as ProFantraxSport
  return PRO_SPORTS.has(s) ? proTeamCode(s, raw) ?? raw : raw
}

function keyPosition(sport: string, position: string | null | undefined): string {
  return sport.toUpperCase() === 'NBA' ? '' : String(position ?? '')
}

function hasContent(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && Object.keys(value as object).length > 0)
}

/** A row with season stats beats one without; then one with projections. */
function richness(row: RecordRow): number {
  return (hasContent(row.stats) ? 2 : 0) + (hasContent(row.projections) ? 1 : 0)
}

/**
 * Pure matcher, exported for tests: pool rows → the `sports_players` row that is the same person.
 */
export function matchPoolRowsToRecords(
  sport: string,
  pool: Array<Pick<PoolPlayerRecord, 'player_id' | 'full_name' | 'position' | 'team' | 'team_abbreviation'>>,
  records: RecordRow[],
): Map<string, RecordRow> {
  const sportU = sport.toUpperCase()
  const strict = new Map<string, RecordRow>()
  const looseBuckets = new Map<string, Map<string, RecordRow>>()
  for (const rec of records) {
    const pos = keyPosition(sportU, rec.position)
    const strictKey = buildStrictPlayerKey({ name: rec.name, position: pos, team: identityTeamFor(sportU, rec.team), sport: sportU })
    const current = strict.get(strictKey)
    if (!current || richness(rec) > richness(current)) strict.set(strictKey, rec)
    const looseKey = buildLoosePlayerKey({ name: rec.name, position: pos, sport: sportU })
    const bucket = looseBuckets.get(looseKey) ?? new Map<string, RecordRow>()
    const inBucket = bucket.get(strictKey)
    if (!inBucket || richness(rec) > richness(inBucket)) bucket.set(strictKey, rec)
    looseBuckets.set(looseKey, bucket)
  }

  const out = new Map<string, RecordRow>()
  for (const row of pool) {
    const pid = String(row.player_id ?? '')
    if (!pid) continue
    const pos = keyPosition(sportU, row.position)
    const team = row.team_abbreviation ?? row.team ?? null
    const hit = strict.get(
      buildStrictPlayerKey({ name: row.full_name, position: pos, team: identityTeamFor(sportU, team), sport: sportU }),
    )
    if (hit) {
      out.set(pid, hit)
      continue
    }
    // Loose only for a teamless row, and only when the name names one player — never a guess.
    if (!team?.trim() || isFreeAgentTeam(team, sportU)) {
      const bucket = looseBuckets.get(buildLoosePlayerKey({ name: row.full_name, position: pos, sport: sportU }))
      if (bucket?.size === 1) out.set(pid, [...bucket.values()][0]!)
    }
  }
  return out
}

/** Batch-load photo, crest and season stats for the rows the route is about to return. */
export async function loadWaiverPoolEnrichment(
  sport: string,
  pool: PoolPlayerRecord[],
): Promise<Map<string, WaiverPoolEnrichment>> {
  const sportU = String(sport).toUpperCase()
  const out = new Map<string, WaiverPoolEnrichment>()
  if (pool.length === 0) return out

  const names = [...new Set(pool.map((p) => String(p.full_name ?? '').trim()).filter(Boolean))].slice(0, NAME_BATCH_LIMIT)
  const [records, resolveLogo] = await Promise.all([
    names.length
      ? prisma.sportsPlayerRecord
          .findMany({
            where: { sport: sportU, name: { in: names } },
            select: {
              id: true,
              name: true,
              team: true,
              position: true,
              stats: true,
              projections: true,
              adp: true,
              dataSource: true,
              headshotSource: true,
            },
          })
          .catch((): RecordRow[] => [])
      : Promise.resolve([] as RecordRow[]),
    sportU === 'NFL' ? Promise.resolve(null) : getStoredTeamLogoResolver(sportU),
  ])
  const matched = matchPoolRowsToRecords(sportU, pool, records as RecordRow[])

  for (const row of pool) {
    const pid = String(row.player_id ?? '')
    if (!pid) continue
    const metadata: WaiverPoolEnrichment['metadata'] = {}
    const image = toImageUrl((row as { image_url?: unknown }).image_url)
    if (image && /^https?:\/\//i.test(image)) {
      metadata.imageUrl = image
      metadata.headshotUrl = image
    }
    const logo = resolveLogo ? resolveLogo(row.team ?? row.team_abbreviation) : null
    if (logo) metadata.teamLogoUrl = logo
    const rec = matched.get(pid)
    out.set(pid, {
      metadata,
      ...(rec
        ? {
            sportsPlayerRecord: {
              // Only the headline keys: the full blob is ~1 KB a player across an 800-row pool.
              stats: pickWaiverHeadlineStats(rec.stats),
              projections: rec.projections,
              dataSource: rec.dataSource,
              headshotSource: rec.headshotSource,
              adp: rec.adp,
            },
          }
        : {}),
    })
  }
  return out
}
