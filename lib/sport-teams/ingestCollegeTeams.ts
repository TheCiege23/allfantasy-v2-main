import { prisma } from '@/lib/prisma'
import { getCFBTeamDirectory } from '@/lib/cfb-player-data'
import type { CollegeTeamRecord } from '@/lib/sport-teams/collegeTeamIdentity'
import { COLLEGE_TEAM_DIRECTORY_CACHE_KEY } from '@/lib/sport-teams/collegeTeamIndexStore'

/**
 * Ingest CFBD's team directory into `SportsTeam`, so college team identity and
 * logos are answerable from Postgres.
 *
 * WHY INGEST RATHER THAN RESOLVE LIVE. The identity index needs school, mascot,
 * abbreviation and alternateNames for ~1,900 teams. Fetching that on a read path
 * would put a provider call behind the scoreboard and trip the DB-first
 * boundary. The directory changes about once a year; it belongs in the database.
 *
 * WHY THE FETCH IS NOT IN THIS FILE. `lib/cfb-player-data.ts` is the allowlisted
 * CFBD adapter — every export there is a live fetch, and its only runtime
 * importers are ingestion modules. A second CFBD client here would take the
 * provider from zero DB-first violations to one.
 *
 * WHAT IT FIXES. `SportsTeam` held 231 TheSportsDB rows with logos and 265
 * Rolling Insights rows without, whose names never matched — RI writes
 * "Vanderbilt University", TSDB writes "Vanderbilt", and across both sources
 * exactly THREE names are identical. Meanwhile the 10-day slate names 1,527
 * distinct team strings, of which only 277 could resolve a logo. Indexed through
 * `collegeTeamIdentity`, CFBD's directory takes that to 1,247 — measured against
 * the real slate, not projected.
 *
 * ⚠ WRITTEN UNDER ITS OWN `source`. Rows land as `source: 'cfbd'`, keeping the
 * natural key `(sport, externalId, source)` intact and leaving the TheSportsDB
 * and Rolling Insights rows untouched. This adds an authority; it overwrites
 * nobody.
 */

export interface CollegeTeamIngestResult {
  fetched: number
  written: number
  withLogo: number
  errors: number
  skipped?: string
}

/** CFBD directory entry -> the shape the identity index consumes. */
export function toCollegeTeamRecord(raw: {
  id: number
  school: string
  mascot?: string | null
  abbreviation?: string | null
  alternateNames?: string[] | null
  classification?: string | null
  logo?: string | null
}): CollegeTeamRecord {
  return {
    id: raw.id,
    school: raw.school,
    mascot: raw.mascot ?? null,
    abbreviation: raw.abbreviation ?? null,
    alternateNames: raw.alternateNames ?? null,
    classification: raw.classification ?? null,
    logo: raw.logo ?? null,
  }
}

export async function ingestCollegeTeams(): Promise<CollegeTeamIngestResult> {
  const result: CollegeTeamIngestResult = { fetched: 0, written: 0, withLogo: 0, errors: 0 }

  /*
   * The adapter throws on a non-2xx rather than returning [], so a provider
   * failure surfaces here instead of being written as an empty directory. An
   * empty directory is indistinguishable from "college football has no teams",
   * and would silently stop every team from resolving.
   */
  const directory = await getCFBTeamDirectory()
  if (directory.length === 0) return { ...result, skipped: 'no CFBD key configured' }

  const teams = directory.map(toCollegeTeamRecord)
  result.fetched = teams.length

  const now = new Date()
  // Teams change once a year; a month is generous and still self-healing.
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

  for (const team of teams) {
    try {
      const data = {
        name: team.school,
        shortName: team.abbreviation ?? null,
        conference: team.classification ?? null,
        logo: team.logo,
        fetchedAt: now,
        expiresAt,
      }
      await prisma.sportsTeam.upsert({
        where: {
          sport_externalId_source: {
            sport: 'NCAAF',
            externalId: String(team.id),
            source: 'cfbd',
          },
        },
        update: data,
        create: {
          sport: 'NCAAF',
          externalId: String(team.id),
          source: 'cfbd',
          ...data,
        },
      })
      result.written += 1
      if (team.logo) result.withLogo += 1
    } catch {
      result.errors += 1
    }
  }

  /*
   * The alias-rich directory, stored whole so read paths can build the identity
   * index without a provider call.
   *
   * `SportsTeam` can only carry two aliases (name, shortName), which resolves
   * 46.1% of the real slate. The full set including mascot and alternateNames
   * resolves 81.7%. Rather than bend the team table into holding alias arrays,
   * the directory lives in one cache row — see collegeTeamIndexStore.
   *
   * Written LAST, after the per-team upserts: if this fails, the team rows are
   * still correct and the index simply stays on its previous version.
   */
  try {
    await prisma.sportsDataCache.upsert({
      where: { cacheKey: COLLEGE_TEAM_DIRECTORY_CACHE_KEY },
      update: { data: teams as unknown as object, expiresAt },
      create: {
        cacheKey: COLLEGE_TEAM_DIRECTORY_CACHE_KEY,
        data: teams as unknown as object,
        expiresAt,
      },
    })
  } catch {
    result.errors += 1
  }

  return result
}
