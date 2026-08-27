import 'server-only'

import { prisma } from '@/lib/prisma'
import { riFetchRows } from '@/lib/workers/providers/rollingInsightsRest'
import { riSupports } from '@/lib/sports-data/rollingInsightsSupport'
import type { RollingInsightsSoccerLeagueCode } from '@/lib/providers/rollingInsightsSoccerLeague'

/**
 * Teams and player profiles from Rolling Insights REST, for every supported sport.
 *
 * WHAT THIS FIXES, measured on production 2026-08-27:
 *
 *   - SOCCER team logos sat at 40 of 968 (4%). The 900 `clearsports` rows and 28 `rolling_insights`
 *     rows carried NO badge at all, and the only 20 with one came from TheSportsDB — whose ingest
 *     is hard-wired to league 4328, the English Premier League, because that is the ONE soccer
 *     league id committed in `contracts/thesportsdb/`. La Liga and Serie A ids are not in that
 *     contract, and CLAUDE.md forbids probing to discover them.
 *   - SOCCER was therefore a one-league product wearing a three-league label.
 *
 * Rolling Insights is the way out: `contracts/rolling-insights/ENDPOINTS.yaml` names EPL, LALIGA
 * and SERIEA explicitly as `soccer_leagues`, addressed by CODE rather than by a numeric id we
 * would have to guess. So soccer expands to all three leagues here without inventing a single
 * identifier, and `team-info` carries the badge.
 *
 * ⚠ SOCCER RESPONSES ARE KEYED BY LEAGUE, NOT BY SPORT. Requesting `/team-info/SOCCER?league=EPL`
 * returns `data.EPL`. `resolveRiEnvelope` (inside `riFetchRows`) handles it; nothing here should
 * key off the path segment.
 */

const SOURCE = 'rolling_insights'
const TTL_DAYS = 7

/** Every soccer league the vendor documents. Not MLS — `not_covered` in the contract. */
export const RI_SOCCER_LEAGUES: readonly RollingInsightsSoccerLeagueCode[] = ['EPL', 'LALIGA', 'SERIEA']

function ttl(now: Date): Date {
  return new Date(now.getTime() + TTL_DAYS * 24 * 60 * 60 * 1000)
}

const str = (v: unknown): string | null => {
  if (v == null) return null
  const t = String(v).trim()
  return t.length > 0 && t.toLowerCase() !== 'null' ? t : null
}

const intOf = (v: unknown): number | null => {
  const s = str(v)
  if (!s) return null
  const n = Number.parseInt(s.replace(/[^0-9-]/g, ''), 10)
  return Number.isFinite(n) ? n : null
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/**
 * The leagues to iterate for a sport. Every non-soccer sport is a single unlabelled pass;
 * soccer is one pass per league because the `league` param is required on every call.
 */
function leaguesFor(sport: string): Array<RollingInsightsSoccerLeagueCode | undefined> {
  return sport.trim().toUpperCase() === 'SOCCER' ? [...RI_SOCCER_LEAGUES] : [undefined]
}

export interface RiTeamSyncResult {
  sport: string
  fetched: number
  written: number
  withLogo: number
  /** Per-league tallies for soccer; a single `all` entry otherwise. */
  byLeague: Record<string, { fetched: number; written: number }>
  unsupported: boolean
  notModified: boolean
  errors: string[]
}

/**
 * `team-info/{SPORT}` -> `SportsTeam`.
 *
 * Writes `source: 'rolling_insights'`, the same key the existing rows use, so this UPDATES the
 * 28 badge-less soccer teams already there rather than creating a parallel set — and adds the two
 * leagues that were never fetched.
 */
export async function syncRollingInsightsTeamsToDb(opts: {
  sport: string
  fetchImpl?: typeof fetch
  now?: Date
}): Promise<RiTeamSyncResult> {
  const sport = opts.sport.trim().toUpperCase()
  const result: RiTeamSyncResult = {
    sport,
    fetched: 0,
    written: 0,
    withLogo: 0,
    byLeague: {},
    unsupported: false,
    notModified: false,
    errors: [],
  }

  if (!riSupports('team_info', sport)) {
    result.unsupported = true
    result.errors.push(`Rolling Insights documents no team-info feed for ${sport}`)
    return result
  }

  const now = opts.now ?? new Date()
  const expiresAt = ttl(now)

  for (const league of leaguesFor(sport)) {
    const label = league ?? 'all'
    result.byLeague[label] = { fetched: 0, written: 0 }

    const { rows, notModified, error } = await riFetchRows('team_info', {
      sport,
      league,
      fetchImpl: opts.fetchImpl,
    })
    if (notModified) result.notModified = true
    if (error) result.errors.push(`team-info ${label}: ${error}`)

    for (const raw of rows) {
      const t = asRecord(raw)
      if (!t) continue

      const externalId = str(t.team_id ?? t.teamId ?? t.team_ID ?? t.id)
      const name = str(t.team ?? t.name ?? t.team_name)
      if (!externalId || !name) continue

      result.fetched += 1
      result.byLeague[label]!.fetched += 1

      // The vendor's own badge. This is the field that was never read, which is the whole reason
      // soccer logo coverage was 4%.
      const logo = str(t.img ?? t.logo ?? t.logo_url ?? t.image)
      if (logo) result.withLogo += 1

      const data = {
        name,
        shortName: str(t.abbrv ?? t.abbreviation ?? t.short_name),
        city: str(t.city),
        conference: str(t.conf ?? t.conference),
        division: str(t.division ?? t.division_name),
        logo,
        primaryColor: str(t.primary_color ?? t.color),
        fetchedAt: now,
        expiresAt,
      }

      try {
        await prisma.sportsTeam.upsert({
          where: { sport_externalId_source: { sport, externalId, source: SOURCE } },
          update: data,
          create: { sport, externalId, source: SOURCE, ...data },
        })
        result.written += 1
        result.byLeague[label]!.written += 1
      } catch (e) {
        if (result.errors.length < 10) {
          result.errors.push(`upsert team ${externalId}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
    }
  }

  return result
}

export interface RiPlayerSyncResult {
  sport: string
  fetched: number
  written: number
  withImage: number
  byLeague: Record<string, { fetched: number; written: number }>
  unsupported: boolean
  notModified: boolean
  errors: string[]
}

/**
 * `player-info/{SPORT}` -> `SportsPlayer`.
 *
 * Two things downstream depend on this writing `source: 'rolling_insights'`:
 *   1. `multiSportIdentityMap` reads exactly those rows to copy `externalId` into
 *      `PlayerIdentityMap.rollingInsightsId` — the join key the whole stat/projection chain needs;
 *   2. the headshot sweep reads `SportsPlayer.imageUrl`, so a profile image that arrives here is
 *      one fewer provider call for `sync-player-images` to make.
 */
export async function syncRollingInsightsPlayersToDb(opts: {
  sport: string
  fetchImpl?: typeof fetch
  now?: Date
}): Promise<RiPlayerSyncResult> {
  const sport = opts.sport.trim().toUpperCase()
  const result: RiPlayerSyncResult = {
    sport,
    fetched: 0,
    written: 0,
    withImage: 0,
    byLeague: {},
    unsupported: false,
    notModified: false,
    errors: [],
  }

  if (!riSupports('player_info', sport)) {
    result.unsupported = true
    result.errors.push(`Rolling Insights documents no player-info feed for ${sport}`)
    return result
  }

  const now = opts.now ?? new Date()
  const expiresAt = ttl(now)

  for (const league of leaguesFor(sport)) {
    const label = league ?? 'all'
    result.byLeague[label] = { fetched: 0, written: 0 }

    const { rows, notModified, error } = await riFetchRows('player_info', {
      sport,
      league,
      fetchImpl: opts.fetchImpl,
      timeoutMs: 45_000,
    })
    if (notModified) result.notModified = true
    if (error) result.errors.push(`player-info ${label}: ${error}`)

    for (const raw of rows) {
      const p = asRecord(raw)
      if (!p) continue

      const externalId = str(p.player_id ?? p.playerId ?? p.player_ID ?? p.id)
      const name = str(p.player ?? p.name ?? p.full_name)
      if (!externalId || !name) continue

      result.fetched += 1
      result.byLeague[label]!.fetched += 1

      const teamObj = asRecord(p.team)
      const imageUrl = str(p.img ?? p.image ?? p.headshot ?? p.photo)
      if (imageUrl) result.withImage += 1

      const data = {
        name,
        position: str(p.position ?? p.pos),
        team: str(p.team_name ?? teamObj?.team ?? teamObj?.name) ?? (teamObj ? null : str(p.team)),
        teamId: str(p.team_id ?? p.teamId) ?? str(teamObj?.id ?? teamObj?.team_id),
        number: intOf(p.number ?? p.jersey ?? p.jersey_number),
        age: intOf(p.age),
        height: str(p.height),
        weight: str(p.weight),
        college: str(p.college ?? p.school),
        ...(imageUrl ? { imageUrl } : {}),
        dob: str(p.dob ?? p.birth_date ?? p.date_of_birth),
        status: str(p.status),
        fetchedAt: now,
        expiresAt,
      }

      try {
        await prisma.sportsPlayer.upsert({
          where: { sport_externalId_source: { sport, externalId, source: SOURCE } },
          update: data,
          create: { sport, externalId, source: SOURCE, ...data },
        })
        result.written += 1
        result.byLeague[label]!.written += 1
      } catch (e) {
        if (result.errors.length < 10) {
          result.errors.push(`upsert player ${externalId}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
    }
  }

  return result
}
