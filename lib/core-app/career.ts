import 'server-only'

import { prisma } from '@/lib/prisma'
import {
  buildCareerData,
  classifyStatus,
  normalizeCareerSport,
  NO_CAREER_FILTER,
  settingsLabel,
  type CareerData,
  type CareerFilter,
  type CareerIdentity,
  type CareerRow,
  type CareerSource,
} from '@/lib/core-app/careerModel'

/**
 * Career — the trophy room's READ, derived from imported league history.
 *
 * Everything here comes from what the user actually imported. Three sources:
 *
 *   `leagues.import_*`               — the multi-platform import columns
 *     (Sleeper, ESPN, Yahoo, …). Thin — wins/losses/ties/playoffs/champion —
 *     but it is the only source that knows which platform a season came from.
 *   `SeasonStandingFact`             — per (league, season, team) history every
 *     provider's backfill writes, joined through the CLAIMED team.
 *   `legacy_leagues` + `legacy_rosters` — Sleeper career history. The rich
 *     per-season detail (scoring type, team count, points, seed, champion flag),
 *     but Sleeper-only: the table is keyed on `sleeperLeagueId`.
 *
 * ⚠ THE PLATFORM FILTER IS WHY ALL ARE READ. Legacy rows can only ever answer
 * "Sleeper", so a filter built on them alone would silently drop every ESPN and
 * Yahoo season the moment someone picked one.
 *
 * ⚠ THIS FILE NOW ONLY READS. The arithmetic moved to `careerModel.ts` so that
 * one read answers every filter, and so `careerProfile.ts` can store the rows
 * after an import and build any view without touching these tables again.
 */

export * from '@/lib/core-app/careerModel'

/**
 * Identity and ladder position. Read from the SAME denormalised columns
 * /api/user/rank uses, deliberately — two surfaces disagreeing about someone's
 * level is worse than either being slightly stale.
 *
 * ⚠ ALWAYS READ LIVE, NEVER STORED WITH THE PROFILE. A rename or a rank
 * recalculation changes these without touching any league row, so a stored copy
 * would show yesterday's name under today's history.
 */
export async function loadCareerIdentity(userId: string): Promise<CareerIdentity & { legacyUserId: string | null }> {
  try {
    const [appUser, rows] = await Promise.all([
      prisma.appUser.findUnique({
        where: { id: userId },
        select: { username: true, displayName: true, avatarUrl: true, legacyUserId: true },
      }),
      prisma.$queryRaw<Array<{ xp_total: bigint | number | null }>>`
        SELECT xp_total FROM user_profiles WHERE "userId" = ${userId} LIMIT 1
      `,
    ])
    const raw = rows[0]?.xp_total
    return {
      handle: appUser?.displayName?.trim() || appUser?.username?.trim() || null,
      avatarUrl: appUser?.avatarUrl?.trim() || null,
      xpTotal: raw != null ? Number(raw) : null,
      legacyUserId: appUser?.legacyUserId ?? null,
    }
  } catch (err) {
    console.error('[core-app/career] identity/xp read failed:', err)
    return { handle: null, avatarUrl: null, xpTotal: null, legacyUserId: null }
  }
}

/**
 * Every league-season of this account, deduplicated across sources.
 *
 * ⚠ DEDUPE ACROSS THE SOURCES. A Sleeper league imported through the modern path
 * can appear in more than one table for the same season, and counting it twice
 * would inflate leagues played, games and — worst of all — championships. Keyed on
 * platform+season+name, the most specific thing the rows share; first source wins,
 * in the order import → standing → legacy.
 */
export async function loadCareerRows(
  userId: string,
  legacyUserId: string | null,
): Promise<Omit<CareerSource, 'identity'>> {
  /* ── source 1: multi-platform import columns on `leagues` ──────────────── */
  type ImportRow = {
    id: string
    season: number
    platform: string
    platformLeagueId: string | null
    sport: string | null
    name: string | null
    import_wins: number | null
    import_losses: number | null
    import_ties: number | null
    import_made_playoffs: boolean | null
    import_won_championship: boolean | null
    import_points_for: number | null
    import_points_against: number | null
    leagueSize: number | null
    scoring: string | null
    status: string | null
  }

  let importRows: ImportRow[] = []
  try {
    importRows = await prisma.$queryRaw<ImportRow[]>`
      SELECT id, season, platform, "platformLeagueId", sport::text AS sport, name,
             import_wins, import_losses, import_ties,
             import_made_playoffs, import_won_championship,
             import_points_for, import_points_against,
             "leagueSize", scoring, status
      FROM leagues
      WHERE "userId" = ${userId}
        AND import_wins IS NOT NULL
    `
  } catch (err) {
    // The import_* columns are additive and have been missing on some
    // deployments; a career page is not the place to 500 over it.
    console.error('[core-app/career] leagues import_* read failed:', err)
    importRows = []
  }

  /* ── source 2: imported season history (every provider, per season) ───────
   *
   * ⚠ SOURCE 1 CANNOT ANSWER "LAST SEASON". The `import_*` columns are ONE row
   * per league and written by one route only. `SeasonStandingFact` is per
   * (league, season, team) and every provider's historical backfill writes it.
   *
   * Joined through the CLAIMED team rather than league ownership: source 1
   * filters `leagues."userId"`, the league's owner, so a league you play in but
   * do not run contributes nothing. A claim is what says which team is yours.
   */
  let standingRows: Array<{
    leagueId: string
    platformLeagueId: string | null
    season: number
    name: string
    platform: string
    sport: string | null
    wins: number
    losses: number
    ties: number
    pointsFor: number
    pointsAgainst: number
    leagueSize: number | null
  }> = []
  try {
    const claimed = await prisma.leagueTeam.findMany({
      where: { claimedByUserId: userId },
      select: {
        externalId: true,
        league: {
          select: { id: true, name: true, platform: true, platformLeagueId: true, sport: true, leagueSize: true },
        },
      },
    })
    const byLeagueId = new Map(
      claimed
        .filter((t) => t.league?.id && t.externalId)
        .map((t) => [t.league!.id, { teamId: t.externalId as string, league: t.league! }]),
    )
    if (byLeagueId.size > 0) {
      const facts = await prisma.seasonStandingFact.findMany({
        where: { leagueId: { in: [...byLeagueId.keys()] } },
        select: {
          leagueId: true,
          season: true,
          teamId: true,
          wins: true,
          losses: true,
          ties: true,
          pointsFor: true,
          pointsAgainst: true,
        },
      })
      standingRows = facts
        .filter((f) => byLeagueId.get(f.leagueId)?.teamId === f.teamId)
        /* An unplayed season is not a season. The ESPN backfill writes a fact row
           per team whether or not the season ran, so a league that has not kicked
           off yields a full set of 0-0 rows. */
        .filter((f) => f.wins > 0 || f.losses > 0 || f.ties > 0 || f.pointsFor > 0)
        .map((f) => {
          const league = byLeagueId.get(f.leagueId)!.league
          return {
            leagueId: f.leagueId,
            platformLeagueId: league.platformLeagueId ?? null,
            season: f.season,
            name: league.name ?? 'League',
            platform: String(league.platform ?? 'unknown').toLowerCase(),
            sport: league.sport ? String(league.sport) : null,
            wins: f.wins,
            losses: f.losses,
            ties: f.ties,
            pointsFor: f.pointsFor,
            pointsAgainst: f.pointsAgainst,
            leagueSize: league.leagueSize ?? null,
          }
        })
    }
  } catch (err) {
    console.error('[core-app/career] imported season history read failed:', err)
    standingRows = []
  }

  /* ── source 3: Sleeper legacy history (richer, single-platform) ────────── */
  let legacyLeagues: Array<{
    id: string
    sleeperLeagueId: string
    name: string
    season: number
    sport: string
    leagueType: string | null
    scoringType: string | null
    teamCount: number | null
    playoffTeams: number | null
    status: string | null
    rosters: Array<{
      wins: number
      losses: number
      ties: number
      pointsFor: number
      pointsAgainst: number
      isChampion: boolean
      finalStanding: number | null
      playoffSeed: number | null
    }>
  }> = []

  try {
    if (legacyUserId) {
      legacyLeagues = await prisma.legacyLeague.findMany({
        where: { userId: legacyUserId },
        orderBy: [{ season: 'desc' }],
        select: {
          id: true,
          sleeperLeagueId: true,
          name: true,
          season: true,
          sport: true,
          leagueType: true,
          scoringType: true,
          teamCount: true,
          playoffTeams: true,
          status: true,
          rosters: {
            where: { isOwner: true },
            take: 1,
            select: {
              wins: true,
              losses: true,
              ties: true,
              pointsFor: true,
              pointsAgainst: true,
              isChampion: true,
              finalStanding: true,
              playoffSeed: true,
            },
          },
        },
      })
    }
  } catch (err) {
    console.error('[core-app/career] legacy league read failed:', err)
    legacyLeagues = []
  }

  const seen = new Set<string>()
  const keyOf = (platform: string, season: number, name: string | null) =>
    `${platform}|${season}|${(name ?? '').trim().toLowerCase()}`
  const platforms = new Set<string>()
  const rows: CareerRow[] = []
  let rosterless = 0

  for (const row of importRows) {
    const platform = (row.platform || 'unknown').toLowerCase()
    platforms.add(platform)
    const k = keyOf(platform, row.season, row.name)
    if (seen.has(k)) continue
    seen.add(k)
    const name = row.name?.trim() || 'Unnamed league'
    const w = row.import_wins ?? 0
    const l = row.import_losses ?? 0
    const t = row.import_ties ?? 0
    const games = w + l + t
    rows.push({
      source: 'import',
      key: k,
      leagueKey: name.toLowerCase(),
      leagueName: name,
      platform,
      sport: normalizeCareerSport(row.sport),
      season: row.season,
      status: row.status,
      wins: w,
      losses: l,
      ties: t,
      pointsFor: games > 0 && (row.import_points_for ?? 0) > 0 ? Number(row.import_points_for) : null,
      pointsAgainst: games > 0 && (row.import_points_against ?? 0) > 0 ? Number(row.import_points_against) : null,
      madePlayoffs: row.import_made_playoffs === true,
      playoffKnown: row.import_made_playoffs != null || row.import_won_championship === true,
      isChampion: row.import_won_championship === true,
      teamCount: row.leagueSize ?? null,
      /*
       * ⚠ NOT `leagues."playoffTeams"`. That column DEFAULTS to 4, so on an
       * imported row it says nothing about the league's real cut — reading it
       * would judge berths against a number nobody configured.
       */
      playoffTeams: null,
      leagueType: null,
      scoringType: row.scoring,
      settingsLabel: settingsLabel({ scoringType: row.scoring, sport: row.sport }),
      refId: row.id,
      providerLeagueId: row.platformLeagueId,
      counted: classifyStatus(row.status) === 'completed',
      inRollup: true,
    })
  }

  for (const row of standingRows) {
    platforms.add(row.platform)
    const k = keyOf(row.platform, row.season, row.name)
    if (seen.has(k)) continue
    seen.add(k)
    const name = row.name.trim() || 'League'
    rows.push({
      source: 'standing',
      key: k,
      leagueKey: name.toLowerCase(),
      leagueName: name,
      platform: row.platform,
      sport: normalizeCareerSport(row.sport),
      season: row.season,
      status: null,
      wins: row.wins,
      losses: row.losses,
      ties: row.ties,
      pointsFor: row.pointsFor > 0 ? row.pointsFor : null,
      pointsAgainst: row.pointsAgainst > 0 ? row.pointsAgainst : null,
      /*
       * ⚠ NO CHAMPIONSHIP AND NO PLAYOFF BERTH IS CLAIMED HERE. `SeasonStandingFact`
       * records a finishing RANK, and rank 1 is the regular-season leader — not
       * the title. Crediting it would manufacture championships nobody won.
       */
      madePlayoffs: false,
      playoffKnown: false,
      isChampion: false,
      teamCount: row.leagueSize,
      playoffTeams: null,
      leagueType: null,
      scoringType: null,
      settingsLabel: null,
      refId: row.leagueId,
      providerLeagueId: row.platformLeagueId,
      counted: true,
      inRollup: false,
    })
  }

  for (const league of legacyLeagues) {
    const platform = 'sleeper'
    platforms.add(platform)
    const k = keyOf(platform, league.season, league.name)
    if (seen.has(k)) continue
    seen.add(k)

    const roster = league.rosters[0]
    if (!roster) {
      rosterless += 1
      continue
    }

    /*
     * ⚠ A PLAYOFF BERTH REQUIRES GAMES. Measured on production: the 2026 season
     * came back as 0-0-0 with 25 playoff appearances across 54 leagues, because
     * `finalStanding` and `playoffSeed` are already populated on leagues that
     * have not played a snap — seeding, not a result.
     */
    const games = roster.wins + roster.losses + roster.ties
    const madePlayoffs =
      games > 0 &&
      (roster.isChampion ||
        (league.playoffTeams != null &&
          ((roster.playoffSeed != null && roster.playoffSeed <= league.playoffTeams) ||
            (roster.finalStanding != null && roster.finalStanding <= league.playoffTeams))))

    rows.push({
      source: 'legacy',
      key: k,
      leagueKey: league.name.trim().toLowerCase(),
      leagueName: league.name,
      platform,
      sport: normalizeCareerSport(league.sport),
      season: league.season,
      status: league.status,
      wins: roster.wins,
      losses: roster.losses,
      ties: roster.ties,
      pointsFor: games > 0 && roster.pointsFor > 0 ? roster.pointsFor : null,
      pointsAgainst: games > 0 && roster.pointsAgainst > 0 ? roster.pointsAgainst : null,
      madePlayoffs,
      // A berth is only judgeable when the league recorded its cut, or you won it.
      playoffKnown: league.playoffTeams != null || roster.isChampion,
      isChampion: roster.isChampion,
      teamCount: league.teamCount,
      playoffTeams: league.playoffTeams,
      leagueType: league.leagueType,
      scoringType: league.scoringType,
      settingsLabel: settingsLabel({
        leagueType: league.leagueType,
        scoringType: league.scoringType,
        teamCount: league.teamCount,
        sport: league.sport,
      }),
      refId: league.id,
      providerLeagueId: league.sleeperLeagueId,
      counted: classifyStatus(league.status) === 'completed',
      inRollup: true,
    })
  }

  return { rows, platforms: [...platforms].sort(), rosterless }
}

/** Identity plus every row — what a stored profile holds, minus the identity. */
export async function loadCareerSource(userId: string): Promise<CareerSource> {
  const identity = await loadCareerIdentity(userId)
  const { legacyUserId, ...rest } = identity
  const rows = await loadCareerRows(userId, legacyUserId)
  return { identity: rest, ...rows }
}

/**
 * The trophy room, read live.
 *
 * `filter` may be the old bare platform string (`?platform=`) or a whole
 * `CareerFilter`. The page reads through `careerProfile.ts` instead; this stays
 * for the share card, the dashboards and the kill switch.
 */
export async function getCareerData(
  userId: string,
  filter?: string | null | Partial<CareerFilter>,
): Promise<CareerData> {
  const resolved: CareerFilter =
    typeof filter === 'string' || filter == null
      ? { ...NO_CAREER_FILTER, platform: filter?.trim().toLowerCase() || null }
      : { ...NO_CAREER_FILTER, ...filter }
  return buildCareerData(await loadCareerSource(userId), resolved)
}
