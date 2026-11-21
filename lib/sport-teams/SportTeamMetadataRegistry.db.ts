/**
 * DB-backed team metadata (SportsTeam). Loaded separately so SportTeamMetadataRegistry.ts
 * stays free of prisma for client-safe static logo resolution.
 */

import { prisma } from '@/lib/prisma'
import type { SportType, TeamMetadata } from './types'
import {
  getTeamMetadataForSport,
  logoUrlForAbbrev,
} from './SportTeamMetadataRegistry'

function toSportType(s: string): SportType {
  const u = s.toUpperCase()
  if (u === 'NFL' || u === 'NBA' || u === 'MLB' || u === 'NHL' || u === 'NCAAF' || u === 'NCAAB' || u === 'SOCCER') {
    return u as SportType
  }
  return 'NFL'
}

export type TeamMetadataRow = {
  externalId: string | null
  shortName: string | null
  name: string
  city: string | null
  conference: string | null
  division: string | null
  logo: string | null
  primaryColor: string | null
  source?: string | null
}

/** One school however its name is punctuated: case, spacing and the dash family (UMKC's two RI rows). */
const schoolKey = (value: string | null | undefined) =>
  String(value ?? '').replace(/[‐-―−]/g, '-').replace(/\s+/g, ' ').trim().toUpperCase()

/**
 * One entry per TEAM, not per code, read from every row.
 *
 * 🛑 THIS READ THE NEWEST 500 ROWS AND KEPT THE FIRST ROW PER CODE. Measured on production 2026-11-20:
 * college basketball has 761 rows (370 Rolling Insights schools, 391 TheSportsDB), so the cap alone dropped
 * 257 of the 370 schools (Auburn, Ball State…), and one-row-per-code then dropped one of every two schools
 * sharing a code (MER is Mercer AND Merrimack, UNH New Hampshire AND New Haven) and kept TheSportsDB's names
 * for NOVA/UALR/UWG. Now:
 *   - where the sport has Rolling Insights rows, those are the team list (one per school, every sport's
 *     RI set is complete: 30/30/32/32 pro, 370 NCAAB, 265 NCAAF, 80 soccer); other providers only lend a
 *     crest to an RI team that lacks one, through a code that names that one team;
 *   - a sport with no RI rows keeps the old per-code read, uncapped;
 *   - two rows for one school (name differing only in dashes) are one entry; two schools on one code are two.
 */
export function teamMetadataFromRows(sport: SportType, rows: readonly TeamMetadataRow[]): TeamMetadata[] {
  const codeOf = (row: TeamMetadataRow) => (row.shortName ?? row.externalId ?? row.name).trim().toUpperCase()
  const ri = rows.filter((row) => row.source === 'rolling_insights')
  const teamRows = ri.length ? ri : rows
  // A crest from another provider, only through a code that names ONE team among the chosen rows.
  const teamsByCode = new Map<string, Set<string>>()
  for (const row of teamRows) teamsByCode.set(codeOf(row), (teamsByCode.get(codeOf(row)) ?? new Set<string>()).add(schoolKey(row.name)))
  const crestByCode = new Map<string, string>()
  for (const row of rows) {
    const code = codeOf(row)
    if (row.logo && !crestByCode.has(code) && teamsByCode.get(code)?.size === 1) crestByCode.set(code, row.logo)
  }
  const out = new Map<string, TeamMetadata>()
  for (const row of teamRows) {
    const abbreviation = codeOf(row)
    if (!abbreviation) continue
    const key = ri.length ? `${abbreviation}|${schoolKey(row.name)}` : abbreviation
    const existing = out.get(key)
    // A duplicate row for the same team: keep the first, but take a crest it lacks.
    if (existing) {
      if (!existing.primary_logo_url && row.logo) existing.primary_logo_url = row.logo
      continue
    }
    out.set(key, {
      team_id: row.externalId || abbreviation,
      sport_type: sport,
      team_name: row.name,
      city: row.city ?? '',
      abbreviation,
      conference: row.conference ?? null,
      division: row.division ?? null,
      primary_logo_url: row.logo ?? crestByCode.get(abbreviation) ?? logoUrlForAbbrev(sport, abbreviation),
      alternate_logo_url: null,
      primary_color: row.primaryColor ?? null,
    })
  }
  return [...out.values()]
}

export async function getTeamMetadataForSportDbAware(
  sportType: SportType | string,
  options?: { limit?: number }
): Promise<TeamMetadata[]> {
  const sport = toSportType(typeof sportType === 'string' ? sportType : sportType)

  let rows: TeamMetadataRow[] = []
  try {
    rows = await prisma.sportsTeam.findMany({
      where: { sport },
      orderBy: { fetchedAt: 'desc' },
      select: { externalId: true, shortName: true, name: true, city: true, conference: true, division: true,
        logo: true, primaryColor: true, source: true },
      // Uncapped by default: the largest sport has ~2,400 rows. `limit` stays for callers that pass one.
      ...(options?.limit ? { take: options.limit } : {}),
    })
  } catch {
    return getTeamMetadataForSport(sport)
  }

  const teams = rows.length ? teamMetadataFromRows(sport, rows) : []
  return teams.length ? teams : getTeamMetadataForSport(sport)
}
