/**
 * ESPN as the college basketball headshot source — the WRITER. The fetch lives in the adapter
 * `lib/espn/espnNcaabFetch.ts`; the matching rules in `lib/espn/ncaabEspnMatch.ts`.
 *
 * WHY. NCAAB had no roster source carrying images: Rolling Insights sends none, TheSportsDB has
 * no NCAAB rosters. Current-player coverage was 33 of ~6,000 rows. ESPN rosters carry a
 * headshot for 94% of the returning players we can match (contracts/espn GAPS M-04).
 *
 * TWO PASSES, both called from the `?intel=1` tick of `/api/cron/import-players`:
 *
 *   1. `syncEspnNcaabTeamMapIfDue` — weekly. One request for ESPN's 362 D1 teams, matched to
 *      our 369 RI schools, stored as `TeamProviderIdentity(provider 'espn', NCAAB)` pointing at
 *      the SAME canonical team as the RI identity. Fills a missing RI school logo on the way.
 *   2. `syncEspnNcaabRosters` — every tick, a bounded rotation of schools (oldest `fetchedAt`
 *      first). Each roster is matched to that school's RI rows on name AND jersey; a match
 *      writes an ESPN player identity, `PlayerIdentityMap.espnId`, and — only when the CDN
 *      actually serves it — the headshot onto the RI row and the canonical player.
 *
 * SCOPE, BY OWNER DECISION (contracts/espn GAPS E-06): photos only for players RI already has.
 * No ESPN-sourced player rows are created; newcomers RI has not loaded stay photo-less.
 *
 * 🛑 A 403 FROM ESPN STOPS THE PASS. It is reported, never worked around (see the adapter).
 */

import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import {
  EspnBlockedError,
  fetchEspnNcaabRoster,
  fetchEspnNcaabTeams,
  type EspnNcaabAthlete,
} from '@/lib/espn/espnNcaabFetch'
import { matchRoster, matchSchools, type SchoolMatch } from '@/lib/espn/ncaabEspnMatch'
import { writeCanonicalHeadshot } from '@/lib/player-assets/canonicalHeadshotWrite'
import { isApiSportsImageUrl } from '@/lib/player-assets/imageUrlHygiene'
import { isServedImage } from '@/lib/player-assets/servedImage'

const PROVIDER = 'espn'
const RI = 'rolling_insights'
const SPORT = 'NCAAB'
const TEAM_MAP_SOURCE = 'espn-ncaab-teams'
const ROSTER_SOURCE = 'espn-ncaab-roster'
const TEAM_MAP_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const ESPN_NCAAB_HEADSHOT_PREFIX = 'https://a.espncdn.com/i/headshots/mens-college-basketball/'

/** Stop starting new schools this long before the deadline, so the last one can finish its writes. */
const ROSTER_TAIL_MS = 8_000

/**
 * Oct–Apr. Rosters are set by October and the season ends in April; out of season there is
 * nothing to refresh and every request is spent on an undocumented API for no gain.
 */
export function isNcaabRosterSeason(now: Date = new Date()): boolean {
  const m = now.getUTCMonth() // 0 = Jan
  return m >= 9 || m <= 3
}

/** How much a school link is trusted, by the rule that made it. `alias` is human-reviewed. */
function schoolConfidence(rule: SchoolMatch['rule']): number {
  return rule === 'alias' || rule === 'exact' ? 1 : rule === 'subset+abbreviation' ? 0.9 : 0.8
}

// ---------------------------------------------------------------------------
// Pass 1 — school map
// ---------------------------------------------------------------------------

export type EspnNcaabTeamMapResult = {
  skipped?: 'fresh' | 'blocked'
  espnTeams: number
  riSchools: number
  matched: number
  created: number
  refreshed: number
  /** An existing ESPN identity already points at a DIFFERENT canonical team. Never overwritten. */
  conflicts: number
  unmatched: string[]
  logosFilled: number
}

export async function syncEspnNcaabTeamMapIfDue(
  opts: { now?: Date; force?: boolean; fetchImpl?: typeof fetch } = {},
): Promise<EspnNcaabTeamMapResult> {
  const now = opts.now ?? new Date()
  const result: EspnNcaabTeamMapResult = {
    espnTeams: 0,
    riSchools: 0,
    matched: 0,
    created: 0,
    refreshed: 0,
    conflicts: 0,
    unmatched: [],
    logosFilled: 0,
  }

  if (!opts.force) {
    const newest = await prisma.teamProviderIdentity.findFirst({
      where: { provider: PROVIDER, sportKey: SPORT },
      orderBy: { lastSeenAt: 'desc' },
      select: { lastSeenAt: true },
    })
    if (newest?.lastSeenAt && now.getTime() - newest.lastSeenAt.getTime() < TEAM_MAP_MAX_AGE_MS) {
      return { ...result, skipped: 'fresh' }
    }
  }

  let espn
  try {
    espn = await fetchEspnNcaabTeams({ fetchImpl: opts.fetchImpl })
  } catch (err) {
    if (err instanceof EspnBlockedError) return { ...result, skipped: 'blocked' }
    throw err
  }
  result.espnTeams = espn.length

  const riSchools = await prisma.sportsTeam.findMany({
    where: { sport: SPORT, source: RI },
    select: { id: true, externalId: true, name: true, shortName: true, logo: true },
  })
  result.riSchools = riSchools.length

  const riIdentities = await prisma.teamProviderIdentity.findMany({
    where: { provider: RI, sportKey: SPORT, teamId: { not: null } },
    select: { providerTeamId: true, teamId: true },
  })
  const canonicalByRi = new Map(riIdentities.map((i) => [i.providerTeamId, i.teamId!]))

  const { matches, unmatched, ambiguous } = matchSchools(riSchools, espn)
  result.unmatched = [...unmatched, ...ambiguous].map((r) => r.name)

  const existing = await prisma.teamProviderIdentity.findMany({
    where: { provider: PROVIDER, sportKey: SPORT },
    select: { id: true, providerTeamId: true, teamId: true },
  })
  const existingByEspn = new Map(existing.map((e) => [e.providerTeamId, e]))
  const espnById = new Map(espn.map((e) => [e.id, e]))
  const riByExternal = new Map(riSchools.map((r) => [r.externalId, r]))

  for (const m of matches) {
    const teamId = canonicalByRi.get(m.riExternalId)
    const e = espnById.get(m.espnId)!
    if (!teamId) continue // no canonical team for this RI school: nothing to link to
    result.matched += 1
    const rawPayload = { riExternalId: m.riExternalId, rule: m.rule } as Prisma.InputJsonValue
    const prior = existingByEspn.get(m.espnId)
    try {
      if (prior) {
        if (prior.teamId && prior.teamId !== teamId) {
          result.conflicts += 1
          continue
        }
        await prisma.teamProviderIdentity.update({
          where: { id: prior.id },
          data: { teamId, displayName: e.displayName ?? e.location, rawPayload, lastSeenAt: now },
        })
        result.refreshed += 1
      } else {
        /*
         * ⚠ READ-THEN-INSERT, NOT UPSERT. The unique is (provider, sportKey, leagueKey,
         * providerTeamId) with a nullable leagueKey, and Postgres treats NULLs as distinct — so
         * an upsert keyed on it would insert a duplicate every week. This table has no partial
         * NULL-league unique (the player table does), so the read above is the only guard.
         */
        await prisma.teamProviderIdentity.create({
          data: {
            provider: PROVIDER,
            sportKey: SPORT,
            providerTeamId: m.espnId,
            providerSlug: e.abbreviation,
            displayName: e.displayName ?? e.location,
            teamId,
            confidence: schoolConfidence(m.rule),
            verified: m.rule === 'alias',
            source: TEAM_MAP_SOURCE,
            rawPayload,
            lastSeenAt: now,
          },
        })
        result.created += 1
      }
    } catch {
      /* One school must not end the pass. */
      continue
    }

    // Bonus: ESPN's logo for an RI school that still has none. Never replaces a logo.
    const ri = riByExternal.get(m.riExternalId)
    if (ri && !ri.logo && e.logo) {
      const filled = await prisma.sportsTeam
        .updateMany({ where: { id: ri.id, OR: [{ logo: null }, { logo: '' }] }, data: { logo: e.logo } })
        .catch(() => ({ count: 0 }))
      result.logosFilled += filled.count
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Pass 2 — roster rotation
// ---------------------------------------------------------------------------

export type EspnNcaabRosterResult = {
  skipped?: 'no schools mapped'
  blocked: boolean
  schoolsFetched: number
  schoolsRemaining: number
  athletes: number
  matched: number
  noCandidate: number
  refused: number
  identitiesCreated: number
  /** An ESPN athlete already linked to a DIFFERENT canonical player. Never overwritten. */
  identityConflicts: number
  headshotsWritten: number
  headshotsMissing: number
  /** ESPN had a photo, but the row already holds another source's real one — left alone. */
  headshotsKeptOther: number
  errors: number
}

export async function syncEspnNcaabRosters(opts: {
  deadlineAt: number
  maxSchools?: number
  now?: Date
  fetchImpl?: typeof fetch
}): Promise<EspnNcaabRosterResult> {
  const now = opts.now ?? new Date()
  const result: EspnNcaabRosterResult = {
    blocked: false,
    schoolsFetched: 0,
    schoolsRemaining: 0,
    athletes: 0,
    matched: 0,
    noCandidate: 0,
    refused: 0,
    identitiesCreated: 0,
    identityConflicts: 0,
    headshotsWritten: 0,
    headshotsMissing: 0,
    headshotsKeptOther: 0,
    errors: 0,
  }

  const schools = await prisma.teamProviderIdentity.findMany({
    where: { provider: PROVIDER, sportKey: SPORT, teamId: { not: null } },
    // Rotation: `fetchedAt` is set ONLY by this pass (the weekly map pass sets `lastSeenAt`),
    // so the oldest-fetched school is always next and every school comes round.
    orderBy: [{ fetchedAt: { sort: 'asc', nulls: 'first' } }],
    take: opts.maxSchools ?? 40,
    select: { id: true, providerTeamId: true, teamId: true },
  })
  if (schools.length === 0) return { ...result, skipped: 'no schools mapped' }

  const riIdentities = await prisma.teamProviderIdentity.findMany({
    where: { provider: RI, sportKey: SPORT, teamId: { in: schools.map((s) => s.teamId!) } },
    select: { teamId: true, providerTeamId: true },
  })
  const riSchoolByCanonical = new Map(riIdentities.map((i) => [i.teamId!, i.providerTeamId]))

  for (let i = 0; i < schools.length; i++) {
    const school = schools[i]!
    if (Date.now() > opts.deadlineAt - ROSTER_TAIL_MS) {
      result.schoolsRemaining = schools.length - i
      break
    }
    const riSchoolId = riSchoolByCanonical.get(school.teamId!)

    let athletes: EspnNcaabAthlete[] = []
    try {
      athletes = (await fetchEspnNcaabRoster(school.providerTeamId, { fetchImpl: opts.fetchImpl })).athletes
    } catch (err) {
      if (err instanceof EspnBlockedError) {
        result.blocked = true
        result.schoolsRemaining = schools.length - i
        break
      }
      result.errors += 1
    }
    // Moved to the back of the queue even on failure, so one broken school cannot pin the head.
    await prisma.teamProviderIdentity
      .update({ where: { id: school.id }, data: { fetchedAt: now } })
      .catch(() => undefined)
    result.schoolsFetched += 1
    if (!riSchoolId || athletes.length === 0) continue
    result.athletes += athletes.length

    try {
      await linkSchoolRoster(athletes, riSchoolId, school.teamId!, now, result)
    } catch {
      result.errors += 1
    }
  }
  return result
}

async function linkSchoolRoster(
  athletes: EspnNcaabAthlete[],
  riSchoolId: string,
  canonicalTeamId: string,
  now: Date,
  result: EspnNcaabRosterResult,
): Promise<void> {
  /*
   * ⚠ ACT ONLY, MATCHING THE MEASUREMENT. RI NCAAB `ACT` still includes former players (GAPS
   * M-01) — that is why the match needs name AND jersey — but `INACT` rows are older still and
   * were not in the measured population. Widening this is a re-measure, not an edit.
   */
  const riPlayers = await prisma.sportsPlayer.findMany({
    where: { sport: SPORT, source: RI, teamId: riSchoolId, status: 'ACT' },
    select: { id: true, externalId: true, name: true, number: true, imageUrl: true },
  })
  const { matches, noCandidate, refused } = matchRoster(athletes, riPlayers)
  result.noCandidate += noCandidate
  result.refused += refused
  if (matches.length === 0) return

  const riIdentities = await prisma.playerProviderIdentity.findMany({
    where: {
      provider: RI,
      sportKey: SPORT,
      providerPlayerId: { in: matches.map((m) => m.riExternalId) },
      playerId: { not: null },
    },
    select: { providerPlayerId: true, playerId: true },
  })
  const canonicalByRi = new Map(riIdentities.map((i) => [i.providerPlayerId, i.playerId!]))

  const existing = await prisma.playerProviderIdentity.findMany({
    where: { provider: PROVIDER, sportKey: SPORT, providerPlayerId: { in: matches.map((m) => m.athleteId) } },
    select: { id: true, providerPlayerId: true, playerId: true },
  })
  const existingByAthlete = new Map(existing.map((e) => [e.providerPlayerId, e]))
  const athleteById = new Map(athletes.map((a) => [a.id, a]))
  const riRowByExternal = new Map(riPlayers.map((p) => [p.externalId, p]))

  for (const m of matches) {
    const playerId = canonicalByRi.get(m.riExternalId)
    const athlete = athleteById.get(m.athleteId)!
    const riRow = riRowByExternal.get(m.riExternalId)!
    if (!playerId) continue
    result.matched += 1

    const prior = existingByAthlete.get(m.athleteId)
    if (prior && prior.playerId && prior.playerId !== playerId) {
      // Someone already linked this athlete elsewhere. Two answers to one question means
      // neither is safe to act on; leave it and let the count surface it.
      result.identityConflicts += 1
      continue
    }
    try {
      if (prior) {
        await prisma.playerProviderIdentity.update({
          where: { id: prior.id },
          data: { playerId, teamId: canonicalTeamId, lastSeenAt: now },
        })
      } else {
        // Read-then-insert for the same nullable-leagueKey reason as the school map; the
        // partial unique `uniq_ppi_provider_sport_pid_null_league` makes a race fail loudly.
        await prisma.playerProviderIdentity.create({
          data: {
            provider: PROVIDER,
            sportKey: SPORT,
            providerPlayerId: m.athleteId,
            playerId,
            teamId: canonicalTeamId,
            displayName: athlete.fullName,
            source: ROSTER_SOURCE,
            // Corroborated (school + name + jersey), not verified: in this repo `verified`
            // means a human or a shared id confirmed it.
            confidence: 0.95,
            verified: false,
            rawPayload: { riExternalId: m.riExternalId, jersey: athlete.jersey, position: athlete.position },
            lastSeenAt: now,
          },
        })
        result.identitiesCreated += 1
      }
    } catch {
      result.errors += 1
      continue
    }

    // Never overwrites an espnId already set — it may have come from a stronger source.
    await prisma.playerIdentityMap
      .updateMany({
        where: { sport: SPORT, rollingInsightsId: m.riExternalId, espnId: null },
        data: { espnId: m.athleteId },
      })
      .catch(() => undefined)

    if (!athlete.headshotUrl) {
      result.headshotsMissing += 1
      continue
    }
    if (!(await isServedImage(athlete.headshotUrl))) {
      // A miss leaves the row as it was; the next sweep asks again (ESPN adds freshman photos
      // during the season).
      result.headshotsMissing += 1
      continue
    }
    /*
     * Replace only an empty row, an api-sports URL (usually its stock "no photo" picture) or a
     * previous ESPN URL. A row already holding another source's real photo is left alone — and
     * so is its canonical player: passing that URL as `previousUrl` would let the canonical
     * write overwrite the very image this branch just declined to touch.
     */
    const current = riRow.imageUrl
    const ours = !current || isApiSportsImageUrl(current) || current.startsWith(ESPN_NCAAB_HEADSHOT_PREFIX)
    if (!ours) {
      result.headshotsKeptOther += 1
      continue
    }
    if (current !== athlete.headshotUrl) {
      await prisma.sportsPlayer
        .update({ where: { id: riRow.id }, data: { imageUrl: athlete.headshotUrl } })
        .catch(() => undefined)
    }
    await writeCanonicalHeadshot({
      playerId,
      sportKey: SPORT,
      url: athlete.headshotUrl,
      previousUrl: current,
      provider: PROVIDER,
      logTag: 'ncaabEspnIngest',
    })
    result.headshotsWritten += 1
  }
}
