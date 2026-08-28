import { prisma } from '@/lib/prisma'
import {
  buildCollegeTeamIndex,
  type CollegeTeamIndex,
  type CollegeTeamRecord,
} from '@/lib/sport-teams/collegeTeamIdentity'

/**
 * DB-first access to the college team identity index.
 *
 * WHY A CACHE ROW AND NOT `SportsTeam`. The index is only as good as its
 * aliases, and `SportsTeam` can hold two of them — `name` and `shortName`.
 * Measured against the real 10-day slate: school + abbreviation alone resolves
 * 704 of 1,527 names to a logo (46.1%), while the full alias set including
 * mascot and CFBD's `alternateNames` resolves 1,247 (81.7%). The difference is
 * every "Air Force Falcons" and "Abilene Chrstn" string the feeds actually emit.
 * Rather than bend `SportsTeam` into holding alias arrays, the directory is
 * stored whole in one row.
 *
 * 🛑 THIS NEVER FETCHES. It reads our own store and nothing else. A read path
 * that could reach a provider is the DB-first violation this repo enforces, and
 * a scoreboard is exactly where you least want provider latency. If the row is
 * missing or stale, `loadCollegeTeamIndex` returns NULL and callers leave the
 * logo empty — an unstyled crest is a cosmetic loss, a blocking fetch is not.
 */

export const COLLEGE_TEAM_DIRECTORY_CACHE_KEY = 'college-team-directory:v1'

/** How long the built index is reused in-process. The row itself lives ~30d. */
const MEMO_TTL_MS = 15 * 60 * 1000

let memo: { index: CollegeTeamIndex; at: number } | null = null

/** Testing seam — drops the in-process memo. */
export function resetCollegeTeamIndexMemo(): void {
  memo = null
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Parse the stored payload defensively: a malformed row must not throw on a read path. */
export function parseDirectoryPayload(data: unknown): CollegeTeamRecord[] {
  const rows = Array.isArray(data) ? data : isRecord(data) && Array.isArray(data.teams) ? data.teams : []
  const out: CollegeTeamRecord[] = []
  for (const raw of rows) {
    if (!isRecord(raw)) continue
    const id = typeof raw.id === 'number' ? raw.id : Number(raw.id)
    const school = typeof raw.school === 'string' ? raw.school : ''
    if (!Number.isFinite(id) || !school) continue
    out.push({
      id,
      school,
      mascot: typeof raw.mascot === 'string' ? raw.mascot : null,
      abbreviation: typeof raw.abbreviation === 'string' ? raw.abbreviation : null,
      alternateNames: Array.isArray(raw.alternateNames)
        ? raw.alternateNames.filter((n): n is string => typeof n === 'string')
        : null,
      classification: typeof raw.classification === 'string' ? raw.classification : null,
      logo: typeof raw.logo === 'string' ? raw.logo : null,
    })
  }
  return out
}

/**
 * The index, or null when the directory has never been ingested.
 *
 * Null is a real answer and callers must handle it. It means "we cannot say what
 * team this string is", which is different from "this team has no logo", and the
 * two must not collapse into the same empty string upstream.
 */
export async function loadCollegeTeamIndex(now = Date.now()): Promise<CollegeTeamIndex | null> {
  if (memo && now - memo.at < MEMO_TTL_MS) return memo.index

  let row: { data: unknown; expiresAt: Date } | null = null
  try {
    row = await prisma.sportsDataCache.findUnique({
      where: { cacheKey: COLLEGE_TEAM_DIRECTORY_CACHE_KEY },
      select: { data: true, expiresAt: true },
    })
  } catch {
    // A store failure must not take the scoreboard down with it.
    return null
  }

  if (!row) return null

  /*
   * An EXPIRED directory is still used, deliberately. Teams change once a year;
   * a month-old row is materially correct and refusing it would blank every
   * crest until the next ingest. Expiry drives refresh, not validity.
   */
  const teams = parseDirectoryPayload(row.data)
  if (teams.length === 0) return null

  const index = buildCollegeTeamIndex(teams)
  memo = { index, at: now }
  return index
}
