import { prisma } from '@/lib/prisma'
import { describeCfbdFailure } from '@/lib/cfbd-fetch'
import { getCFBFbsRosterResult, getCFBTeamDirectory } from '@/lib/cfb-player-data'
import { indexRiTeams, matchSchoolToRi, type CfbdSchool } from '@/lib/ncaaf/cfbdSchoolMatch'

/**
 * Keeps the NCAAF skill-player pool (`SportsPlayer`, `source = 'cfbd'`) on the CURRENT season's
 * FBS rosters. Ingestion: it is the scheduled form of `scripts/refresh-ncaaf-pool-cfbd.ts`.
 *
 * WHY IT EXISTS. That script was the only writer of these rows and was run once, by hand, on
 * 2026-06-26, against the 2025 rosters. Measured 2026-10-01: 593 of the 1,769 players on the
 * 2026 devy rosters — 461 of them freshmen — were absent from the pool entirely, so they had no
 * card, no search hit and no headshot. Skill positions at FBS schools come ONLY from these rows
 * (the script's `--replace-skill` retired the Rolling Insights copies), so a stale run is a hole,
 * not a fallback.
 *
 * WHAT IT WRITES, AND WHAT IT LEAVES ALONE:
 *   - upserts on `(sport, externalId, source)`, where `externalId` is the CFBD athlete id — which
 *     is the ESPN athlete id, see `lib/devy/devyHeadshotRefresh.ts`. A transfer therefore updates
 *     the same row's team rather than creating a second player.
 *   - never writes `imageUrl`. New rows arrive NULL and `refreshCollegeSportsPlayerHeadshots`,
 *     which runs later in the same tick, fills them from ESPN only after a verified image.
 *   - never deletes. Pool rows not on this season's rosters (graduated, left the program) are
 *     COUNTED as `notOnCurrentRoster` and left in place: rows here are referenced from leagues
 *     and drafts, and removing people is a decision for a human, not a weekly job.
 *
 * Two CFBD calls per cycle at most (the 30-day-cached team directory, one FBS roster call; a
 * second roster call only when the current season is not published yet), against a 75,000-call
 * monthly quota.
 */

const FANTASY_POSITIONS = new Set(['QB', 'RB', 'FB', 'WR', 'TE', 'K', 'PK', 'ATH'])
const POSITION_MAP: Record<string, string> = { FB: 'RB', PK: 'K' }

export const COLLEGE_ROSTER_POOL_STATE_KEY = 'cfbd-roster-pool:v1'
/** Rosters move in summer and at the portal windows, not daily. */
export const COLLEGE_ROSTER_POOL_REFRESH_MS = 7 * 24 * 60 * 60 * 1000
/** A partial cycle older than this restarts rather than resuming against an old roster read. */
const CYCLE_MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000
const ROW_TTL_MS = 30 * 24 * 60 * 60 * 1000
const STATE_TTL_MS = 365 * 24 * 60 * 60 * 1000
const BATCH = 100

type PoolState = { season: number | null; cycleStartedAt: string; completedAt: string | null }

export interface CollegeRosterPoolResult {
  season: number | null
  rosterPlayers: number
  seeds: number
  mappedToRiTeam: number
  unmatchedSchools: string[]
  written: number
  alreadyCurrent: number
  deferredRows: number
  notOnCurrentRoster: number
  completed: boolean
  skipped?: string
  error?: string
}

function emptyResult(): CollegeRosterPoolResult {
  return {
    season: null,
    rosterPlayers: 0,
    seeds: 0,
    mappedToRiTeam: 0,
    unmatchedSchools: [],
    written: 0,
    alreadyCurrent: 0,
    deferredRows: 0,
    notOnCurrentRoster: 0,
    completed: false,
  }
}

async function readState(): Promise<PoolState | null> {
  const row = await prisma.sportsDataCache.findUnique({
    where: { cacheKey: COLLEGE_ROSTER_POOL_STATE_KEY },
    select: { data: true },
  })
  const data = row?.data as Partial<PoolState> | null | undefined
  if (!data || typeof data.cycleStartedAt !== 'string') return null
  return {
    season: typeof data.season === 'number' ? data.season : null,
    cycleStartedAt: data.cycleStartedAt,
    completedAt: typeof data.completedAt === 'string' ? data.completedAt : null,
  }
}

async function writeState(state: PoolState): Promise<void> {
  const expiresAt = new Date(Date.now() + STATE_TTL_MS)
  await prisma.sportsDataCache.upsert({
    where: { cacheKey: COLLEGE_ROSTER_POOL_STATE_KEY },
    create: { cacheKey: COLLEGE_ROSTER_POOL_STATE_KEY, data: state, expiresAt },
    update: { data: state, expiresAt },
  })
}

/**
 * Called from the `?intel=1` tick of `/api/cron/import-players`. Runs when the last COMPLETED
 * cycle is over a week old (or never happened). `skipped` means the gate declined.
 */
export async function refreshCollegeRosterPoolIfDue(
  opts: { now?: number; deadlineAt?: number } = {},
): Promise<CollegeRosterPoolResult> {
  const now = opts.now ?? Date.now()
  const state = await readState()
  if (state?.completedAt && now - Date.parse(state.completedAt) < COLLEGE_ROSTER_POOL_REFRESH_MS) {
    return { ...emptyResult(), season: state.season, skipped: 'pool refreshed within 7 days' }
  }
  return refreshCollegeRosterPool({ now, deadlineAt: opts.deadlineAt, state })
}

export async function refreshCollegeRosterPool(
  opts: { now?: number; deadlineAt?: number; state?: PoolState | null } = {},
): Promise<CollegeRosterPoolResult> {
  const result = emptyResult()
  const now = opts.now ?? Date.now()

  /*
   * Resume a partial cycle instead of restarting it. Rows written since `cycleStartedAt` are
   * skipped below, so a tick with little budget does LESS work rather than redoing the same
   * first slice forever. A completed or stale cycle starts fresh.
   */
  const prior = opts.state === undefined ? await readState() : opts.state
  const resumable =
    prior && !prior.completedAt && now - Date.parse(prior.cycleStartedAt) < CYCLE_MAX_AGE_MS
  const cycleStartedAt = resumable ? prior.cycleStartedAt : new Date(now).toISOString()

  // Throws on a CFBD failure rather than returning [] (see the adapter); [] means no key.
  const directory = await getCFBTeamDirectory()
  if (directory.length === 0) return { ...result, skipped: 'no CFBD key configured' }

  /*
   * Current season first; the previous one only when the current is not published yet (an
   * empty but SUCCESSFUL answer). A refused request is an error, never a season signal —
   * reading a quota wall as "no 2026 rosters" would quietly reload 2025.
   */
  const currentYear = new Date(now).getUTCFullYear()
  let season = currentYear
  let roster = await getCFBFbsRosterResult(season)
  if (roster.ok && roster.data.length === 0) {
    season = currentYear - 1
    roster = await getCFBFbsRosterResult(season)
  }
  if (!roster.ok) return { ...result, error: describeCfbdFailure(roster.failure) }
  if (roster.data.length === 0) return { ...result, skipped: `no FBS rosters published for ${currentYear} or ${season}` }
  result.season = season
  result.rosterPlayers = roster.data.length

  // Rolling Insights rows ONLY — see the warning in lib/ncaaf/cfbdSchoolMatch.ts.
  const riTeams = await prisma.sportsTeam.findMany({
    where: { sport: 'NCAAF', source: 'rolling_insights' },
    select: { externalId: true, name: true, shortName: true },
  })
  const riIndex = indexRiTeams(riTeams)
  const schoolByName = new Map<string, CfbdSchool>(
    directory.map((t) => [t.school, { school: t.school, abbreviation: t.abbreviation, alternateNames: t.alternateNames }]),
  )

  type Seed = { externalId: string; name: string; team: string; teamId: string | null; position: string; college: string }
  const seedById = new Map<string, Seed>()
  const riBySchool = new Map<string, ReturnType<typeof matchSchoolToRi>>()
  const unmatched = new Set<string>()
  for (const p of roster.data) {
    const position = String(p.position ?? '').trim().toUpperCase()
    const externalId = p.id != null ? String(p.id).trim() : ''
    const school = p.team.trim()
    if (!externalId || !school || !FANTASY_POSITIONS.has(position)) continue
    if (!riBySchool.has(school)) {
      const cfbdSchool = schoolByName.get(school) ?? { school, abbreviation: null, alternateNames: null }
      riBySchool.set(school, matchSchoolToRi(cfbdSchool, riIndex))
    }
    const ri = riBySchool.get(school) ?? null
    if (!ri) unmatched.add(school)
    seedById.set(externalId, {
      externalId,
      name: p.fullName.trim().slice(0, 128),
      team: (ri?.name ?? school).slice(0, 64),
      teamId: ri?.externalId ?? null,
      position: POSITION_MAP[position] ?? position,
      college: school.slice(0, 64),
    })
  }
  const seeds = [...seedById.values()]
  result.seeds = seeds.length
  result.mappedToRiTeam = seeds.filter((s) => s.teamId).length
  result.unmatchedSchools = [...unmatched].sort().slice(0, 20)

  const existing = await prisma.sportsPlayer.findMany({
    where: { sport: 'NCAAF', source: 'cfbd' },
    select: { externalId: true, fetchedAt: true },
  })
  const fetchedAtById = new Map(existing.map((r) => [r.externalId, r.fetchedAt.getTime()]))
  result.notOnCurrentRoster = existing.filter((r) => !seedById.has(r.externalId)).length

  const cycleStartMs = Date.parse(cycleStartedAt)
  const pending = seeds.filter((s) => {
    const fetched = fetchedAtById.get(s.externalId)
    return fetched == null || fetched < cycleStartMs
  })
  result.alreadyCurrent = seeds.length - pending.length

  await writeState({ season, cycleStartedAt, completedAt: null })

  const fetchedAt = new Date(now)
  const expiresAt = new Date(now + ROW_TTL_MS)
  for (let i = 0; i < pending.length; i += BATCH) {
    if (opts.deadlineAt != null && Date.now() > opts.deadlineAt) {
      result.deferredRows = pending.length - i
      return result
    }
    const batch = pending.slice(i, i + BATCH)
    await prisma.$transaction(
      batch.map((s) =>
        prisma.sportsPlayer.upsert({
          where: { sport_externalId_source: { sport: 'NCAAF', externalId: s.externalId, source: 'cfbd' } },
          update: {
            name: s.name,
            position: s.position,
            team: s.team,
            teamId: s.teamId,
            college: s.college,
            status: 'active',
            fetchedAt,
            expiresAt,
          },
          create: {
            sport: 'NCAAF',
            externalId: s.externalId,
            source: 'cfbd',
            name: s.name,
            position: s.position,
            team: s.team,
            teamId: s.teamId,
            college: s.college,
            status: 'active',
            fetchedAt,
            expiresAt,
          },
        }),
      ),
    )
    result.written += batch.length
  }

  await writeState({ season, cycleStartedAt, completedAt: new Date().toISOString() })
  result.completed = true
  return result
}
