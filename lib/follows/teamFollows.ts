import 'server-only'

import { randomUUID } from 'node:crypto'

import { prisma } from '@/lib/prisma'
import { isMissingDatabaseObjectError } from '@/lib/canonical/getCanonicalPlayer'
import { buildTeamIndex, type CanonicalTeam, type TeamIndex } from '@/lib/follows/teamResolver'

/**
 * Follow a real-world team (owner's call, 2026-10-03): news and injury alerts for that team and the
 * players on it — not the whole league. The one place that reads or writes `team_follows`.
 *
 * Same contract as lib/follows/playerFollows.ts, deliberately:
 *   ⚠ A MISSING TABLE IS "UNAVAILABLE", NEVER "NOT FOLLOWING". Reads return `null` for 42P01, so a
 *     surface hides the feature instead of claiming you follow nobody; writes report `unavailable`.
 *   RAW SQL, so the follow is one `INSERT … ON CONFLICT DO NOTHING`.
 *
 * THE KEY IS THE CANONICAL ABBREVIATION from `sports_core_teams` (DB-first, cached). News carries
 * free-text team names; lib/follows/teamResolver maps those onto this key. A follow is only accepted
 * for an abbreviation that table actually has, so a client cannot store a key nothing will match.
 */

/**
 * Sports with a team list AND news that can be matched to it. ⚠ SOCCER IS DELIBERATELY ABSENT: the
 * canonical soccer teams are Premier League clubs, while soccer news is MLS and national teams
 * (measured 2026-10-03), so a soccer follow would match nothing and quietly never alert.
 */
export const TEAM_FOLLOW_SPORTS = ['NFL', 'NBA', 'MLB', 'NHL', 'NCAAF', 'NCAAB'] as const
export type TeamFollowSport = (typeof TEAM_FOLLOW_SPORTS)[number]

export const MAX_TEAM_FOLLOWS = 30

export function isTeamFollowSport(sport: string): sport is TeamFollowSport {
  return (TEAM_FOLLOW_SPORTS as readonly string[]).includes(String(sport).toUpperCase())
}

/** Rows in `sports_core_teams` that are conferences or exhibition squads, not teams. */
const NOT_A_TEAM = /^(AFC|NFC|AL|NL)$|ALL[- ]?STARS?/i

const TEAM_CACHE_MS = 60 * 60 * 1000
const teamCache = new Map<string, { at: number; teams: CanonicalTeam[]; index: TeamIndex }>()

/** The followable teams for a sport, A–Z. Empty for an unsupported sport or a failed read. */
export async function listTeamsForSport(sport: string): Promise<CanonicalTeam[]> {
  return (await teamsAndIndex(sport))?.teams ?? []
}

/** The resolver index for a sport (cached with the team list). */
export async function getTeamIndex(sport: string): Promise<TeamIndex | null> {
  return (await teamsAndIndex(sport))?.index ?? null
}

async function teamsAndIndex(sport: string): Promise<{ teams: CanonicalTeam[]; index: TeamIndex } | null> {
  const S = String(sport ?? '').toUpperCase()
  if (!isTeamFollowSport(S)) return null
  const hit = teamCache.get(S)
  if (hit && Date.now() - hit.at < TEAM_CACHE_MS) return hit
  try {
    const rows = await prisma.$queryRaw<Array<{ abbr: string; name: string }>>`
      SELECT DISTINCT ON (abbreviation) abbreviation AS abbr, canonical_name AS name
      FROM sports_core_teams
      WHERE sport_key = ${S} AND active IS NOT FALSE AND abbreviation IS NOT NULL
      ORDER BY abbreviation, canonical_name
    `
    const teams = rows
      .filter((r) => r.abbr && r.name && !NOT_A_TEAM.test(r.abbr) && !NOT_A_TEAM.test(r.name))
      .map((r) => ({ abbr: r.abbr, name: r.name }))
      .sort((a, b) => a.name.localeCompare(b.name))
    const entry = { at: Date.now(), teams, index: buildTeamIndex(S, teams) }
    // An empty read is not cached: it is far more likely a transient failure than a sport with no teams.
    if (teams.length > 0) teamCache.set(S, entry)
    return entry
  } catch {
    return null
  }
}

export type TeamFollow = { sport: string; teamAbbr: string; teamName: string; createdAt: Date }

type Row = { sport: string; team_abbr: string; team_name: string; created_at: Date }

/** Every team this user follows, by sport then name. `null` = follows unavailable (no table). */
export async function listTeamFollows(userId: string): Promise<TeamFollow[] | null> {
  if (!userId) return []
  try {
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT sport, team_abbr, team_name, created_at FROM team_follows
      WHERE user_id = ${userId}
      ORDER BY sport, team_name
    `
    return rows.map((r) => ({ sport: r.sport, teamAbbr: r.team_abbr, teamName: r.team_name, createdAt: r.created_at }))
  } catch (err) {
    if (isMissingDatabaseObjectError(err)) return null
    throw err
  }
}

export type TeamFollowResult = 'followed' | 'unfollowed' | 'limit' | 'unavailable' | 'invalid'

export async function followTeam(userId: string, sport: string, teamAbbr: string): Promise<TeamFollowResult> {
  const S = String(sport ?? '').toUpperCase()
  if (!userId || !isTeamFollowSport(S)) return 'invalid'
  const team = (await listTeamsForSport(S)).find((t) => t.abbr === teamAbbr)
  if (!team) return 'invalid'
  try {
    const [{ n }] = await prisma.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM team_follows WHERE user_id = ${userId}
    `
    if (n >= MAX_TEAM_FOLLOWS) return 'limit'
    await prisma.$executeRaw`
      INSERT INTO team_follows (id, user_id, sport, team_abbr, team_name)
      VALUES (${randomUUID()}, ${userId}, ${S}, ${team.abbr}, ${team.name})
      ON CONFLICT (user_id, sport, team_abbr) DO NOTHING
    `
    return 'followed'
  } catch (err) {
    if (isMissingDatabaseObjectError(err)) return 'unavailable'
    throw err
  }
}

export async function unfollowTeam(userId: string, sport: string, teamAbbr: string): Promise<TeamFollowResult> {
  const S = String(sport ?? '').toUpperCase()
  if (!userId || !S || !teamAbbr) return 'invalid'
  try {
    await prisma.$executeRaw`
      DELETE FROM team_follows WHERE user_id = ${userId} AND sport = ${S} AND team_abbr = ${teamAbbr}
    `
    return 'unfollowed'
  } catch (err) {
    if (isMissingDatabaseObjectError(err)) return 'unavailable'
    throw err
  }
}

/** Who follows this team. `null` = follows unavailable. */
export async function listFollowerIdsForTeam(sport: string, teamAbbr: string): Promise<string[] | null> {
  const S = String(sport ?? '').toUpperCase()
  if (!S || !teamAbbr) return []
  try {
    const rows = await prisma.$queryRaw<Array<{ user_id: string }>>`
      SELECT user_id FROM team_follows WHERE sport = ${S} AND team_abbr = ${teamAbbr}
    `
    return rows.map((r) => r.user_id)
  } catch (err) {
    if (isMissingDatabaseObjectError(err)) return null
    throw err
  }
}

/*
 * ── The "follow your teams" prompt ────────────────────────────────────────────────────────────
 * Owner's call: shown once to every existing user on their next visit to My Team, then to each new
 * user after sign-up. "Seen" lives in `UserProfile.corePreferences.teamFollowPromptAt`, merged
 * atomically (the leaguePreferencesStore pattern) so it cannot clobber the other Core keys.
 */

const PROMPT_KEY = 'teamFollowPromptAt'

/**
 * Should this user see the prompt? Only when they have neither seen it nor followed a team, and
 * only when follows are AVAILABLE — a prompt whose saves cannot land is worse than none. Any read
 * failure answers false: never nag on a guess.
 */
export async function shouldShowTeamFollowPrompt(userId: string): Promise<boolean> {
  if (!userId) return false
  try {
    const [row] = await prisma.$queryRaw<Array<{ seen: string | null; n: number }>>`
      SELECT
        (SELECT core_preferences->>${PROMPT_KEY} FROM user_profiles WHERE "userId" = ${userId}) AS seen,
        (SELECT count(*)::int FROM team_follows WHERE user_id = ${userId}) AS n
    `
    return !row?.seen && (row?.n ?? 0) === 0
  } catch {
    return false
  }
}

export async function markTeamFollowPromptSeen(userId: string, now: Date = new Date()): Promise<void> {
  const json = JSON.stringify(now.toISOString())
  await prisma.$executeRaw`
    INSERT INTO user_profiles ("userId", "updatedAt", core_preferences)
    VALUES (${userId}, NOW(), jsonb_build_object(${PROMPT_KEY}::text, ${json}::jsonb))
    ON CONFLICT ("userId") DO UPDATE SET
      core_preferences = COALESCE(user_profiles.core_preferences, '{}'::jsonb) ||
        jsonb_build_object(${PROMPT_KEY}::text, ${json}::jsonb),
      "updatedAt" = NOW()
  `
}

export function __resetTeamCacheForTests(): void {
  teamCache.clear()
}
