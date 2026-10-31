/**
 * Import one Fantrax league from its id, and attach it to a franchise.
 *
 * The same work `scripts/import-fantrax-league.ts` does, callable from a
 * request so the connect-a-league flow can run it.
 *
 * ⚠ THE SECRET ID NEVER REACHES THIS MODULE. Discovery (getFantraxLeagues) hands
 * back league ids and stops; the import works from the league id alone, which is
 * not a credential. Nothing here stores, logs or forwards a Secret ID.
 */

import 'server-only'
import { selectFantraxRoster } from './fantraxTeamSelection'
import { selectFantraxSportMap } from './fantraxSportSelection'

import { getFantraxDraftResults } from '@/lib/league-import/fantrax/fantraxApi'
import { mapFantraxDraftResults } from '@/lib/league-import/fantrax/fantraxDraft'
import type { NormalizedDraftPick } from '@/lib/league-import/types'
import { prisma } from '@/lib/prisma'
import { fantraxScoringMode, fantraxScoringRules, type FantraxScoringRule } from './fantraxScoring'
import {
  fetchFantraxScheduleWithScores,
  getFantraxLeagueInfo,
  getFantraxPlayerIds,
  getFantraxStandings,
  getFantraxTeamRosters,
  type FantraxFailure,
  type FantraxStandingRow,
  type ResolvedRoster,
} from './fantraxApi'

export type FantraxImportOutcome =
  | {
      ok: true
      fantraxLeagueId: string
      leagueName: string
      season: number
      teamName: string
      resolved: number
      total: number
      /**
       * The league's scoring settings, read from the same getLeagueInfo call.
       * Returned rather than stored: the snapshot has no column for settings,
       * and the live path re-reads getLeagueInfo on every import anyway.
       */
      scoringRules: FantraxScoringRule[]
      scoringGaps: string[]
      scoringType: 'points' | 'h2h_points' | 'roto' | 'h2h_category' | null
      /**
       * What the league's draft board actually contained.
       *
       * ⚠ RETURNED RATHER THAN STORED, for the same reason `scoringRules` above
       * is: `FantraxLeague` has no draft column. Adding one is a migration, and a
       * migration is not this import's call — so the capability lands first and
       * the persistence decision stays with the repo owner. A caller that wants
       * the picks has them here; nothing silently half-writes them.
       *
       * `picks` holds only the slots actually used —
       * `NormalizedDraftPick.source_player_id` is required and an unmade slot has
       * no player. `outstanding` says how many remain, so "156 of 192" is
       * reportable rather than the gap being invisible.
       */
      draft: {
        picks: NormalizedDraftPick[]
        slots: number
        made: number
        outstanding: number
        state: string | null
      }
      /**
       * Where the league sits in its own calendar, and how much of it was
       * actually read.
       *
       * ⚠ `scoredPeriodsRead: 0` IS NOT A FAILURE ON A PRESEASON LEAGUE — it is
       * the correct cost of a season that has not started. Separating it from
       * `scoredPeriodsFailed` is what lets a caller tell "nothing to read yet"
       * from "the results endpoint would not answer", which otherwise present
       * identically as a league with no scores.
       */
      seasonState: 'preseason' | 'in_progress' | 'complete' | null
      currentPeriod: number | null
      scoredPeriodsRead: number
      scoredPeriodsFailed: number
    }
  | {
      ok: false
      error: string
      teams?: string[]
      /**
       * The provider-level classification behind this failure, when one exists.
       *
       * ⚠ IT USED TO BE DROPPED HERE, AND THAT IS WHERE A FANTRAX OUTAGE BECAME A MISSING
       * LEAGUE. `FantraxResult` has carried a `kind` all along; this type flattened every
       * one of them to a bare string, so `FantraxLeagueFetchService` had nothing left to
       * decide with and raised `FantraxImportLeagueNotFoundError` for all of them —
       * including a 503. Absent for the failures this module raises itself (an unknown
       * team name, a sport we do not handle), which are genuinely about the league.
       */
      kind?: FantraxFailure['kind']
    }

/**
 * Fetch, resolve and store one Fantrax league.
 *
 * ⚠ REFUSES TO GUESS WHICH TEAM IS THE USER'S. The selected team ID (or a
 * legacy team name) must identify a team the league actually contains.
 * Defaulting to the first roster attributes a stranger's players to them and
 * then grades trades against those players.
 */
export async function importFantraxLeague(args: {
  leagueId: string
  teamId?: string
  teamName?: string
  appUserId: string
  /**
   * The caller's Fantrax Secret ID confirmed, via `getFantraxLeagues`, that this
   * team in this league is theirs. Only set by a real API check — never by user
   * input. See the ownership gate below for what it unlocks and why.
   */
  ownershipVerified?: boolean
}): Promise<FantraxImportOutcome> {
  const info = await getFantraxLeagueInfo(args.leagueId)
  if (!info.ok) return { ok: false, error: info.failure.message, kind: info.failure.kind }

  /*
   * ⚠ THE SCHEDULE READ IS NOW TWO ENDPOINTS, NOT ONE. `getLeagueInfo` carries
   * the fixtures; the results live on `getMatchupScores?period=N`, which nothing
   * in this repo had ever called. Without it every imported Fantrax league had a
   * full fixture list and no score anywhere on it, so no week could be scored,
   * no current week could be derived, and every record read 0-0.
   *
   * The extra cost is bounded by the league's own calendar — a preseason league
   * spends zero additional requests. See `fetchFantraxScheduleWithScores`.
   */
  /*
   * ⚠ AND THE DRAFT IS A THIRD ENDPOINT NOBODY HAD CALLED. `getDraftResults` was
   * catalogued in `FANTRAX_ENDPOINTS` with no wrapper function, so an imported
   * Fantrax league's draft history reflected traded-pick events only — never the
   * draft itself. Measured on Cream Bowl: a 192-slot board with 156 picks made,
   * none of which reached this import.
   *
   * It fails SOFT, like the sport maps and unlike rosters: a league that has not
   * drafted, or whose draft could not be read, is still worth importing. The
   * coverage note reports which of those happened.
   */
  const [rosters, standings, cfb, nfl, nba, schedule, draft] = await Promise.all([
    getFantraxTeamRosters(args.leagueId),
    getFantraxStandings(args.leagueId),
    getFantraxPlayerIds('CFB'),
    getFantraxPlayerIds('NFL'),
    getFantraxPlayerIds('NBA'),
    fetchFantraxScheduleWithScores(args.leagueId, info.data),
    getFantraxDraftResults(args.leagueId).catch(() => null),
  ])
  if (!rosters.ok) return { ok: false, error: rosters.failure.message, kind: rosters.failure.kind }
  /* Only one map has to load. A league is one sport, so failing the whole
     import because the OTHER sport's map was unavailable would be wrong. */
  if (!cfb.ok && !nfl.ok && !nba.ok) return { ok: false, error: cfb.failure.message, kind: cfb.failure.kind }

  /*
   * ⚠ THE SPORT IS NOT IN THE LEAGUE INFO, SO IT IS MEASURED RATHER THAN
   * ASSUMED. `getLeagueInfo` returns a name, a season and teams — nothing that
   * says college or pro. The id spaces do not overlap at all (measured on a real
   * college league: 0 of 38 ids in the NFL map, 447 of 466 in CFB), so whichever
   * map names more players IS the sport. Hardcoding CFB made every NFL Fantrax
   * league look empty, which is why the tile could only ever claim college.
   */
  const best = selectFantraxSportMap(rosters.data, {
    ...(cfb.ok ? { CFB: cfb.data } : {}),
    ...(nfl.ok ? { NFL: nfl.data } : {}),
    ...(nba.ok ? { NBA: nba.data } : {}),
  })
  if (!best) return { ok: false, error: 'Fantrax roster IDs did not uniquely identify a supported sport.' }
  const resolved = best.resolved
  const total = resolved.reduce((a, r) => a + r.total, 0)
  const named = best.named

  /*
   * ⚠ A LEAGUE WHERE ALMOST NOTHING RESOLVED IS THE WRONG SPORT MAP, NOT AN
   * EMPTY LEAGUE. Storing it would persist rosters of anonymous ids. Now that
   * both maps are tried, reaching here means NEITHER fits — so the message says
   * that rather than blaming one of them.
   */
  if (total > 0 && named / total < 0.5) {
    return {
      ok: false,
      error: `only ${named} of ${total} players could be named against the college football, NFL, or NBA player map, which is the signature of a sport we do not handle rather than a real league. Nothing was imported.`,
    }
  }

  const mine = selectFantraxRoster(resolved, args)
  if (!mine) {
    return {
      ok: false,
      error: args.teamId
        ? `no team with ID "${args.teamId}" in that league`
        : `no team named "${args.teamName}" in that league`,
      teams: resolved.map((r) => r.teamName),
    }
  }

  const season = Number(info.data.seasonYear) || new Date().getFullYear()
  const scoring = fantraxScoringRules(info.data, best.sport)

  const snapshotOwnerKey = `fantrax-team:${args.leagueId}:${mine.teamId}`
  const fantraxUser = await prisma.fantraxUser.upsert({
    where: { fantraxUsername: snapshotOwnerKey },
    create: { fantraxUsername: snapshotOwnerKey, displayName: mine.teamName },
    update: { displayName: mine.teamName },
    select: { id: true },
  })

  const existing = await prisma.fantraxLeague.findUnique({
    where: {
      userId_leagueName_season: {
        userId: fantraxUser.id,
        leagueName: info.data.leagueName,
        season,
      },
    },
    select: { appUserId: true },
  })
  /*
   * ⚠ THIS REFUSED PEOPLE THEIR OWN LEAGUES, AND THE IDENTITY IS WHY.
   *
   * The snapshot owner key combines the real league and team IDs. It stays
   * distinct when two teams share a name or one AllFantasy user owns both.
   *
   * A Fantrax Secret ID IS a real identity, and `getFantraxLeagues` reports which
   * teams it owns. When the caller has proven ownership of this team, that beats
   * stale snapshot bookkeeping and they take the row over.
   *
   * ⚠ THE GUARD STILL STANDS WITHOUT PROOF, which is the half worth keeping: an
   * unverified caller still cannot overwrite somebody else's snapshot, and
   * `ownershipVerified` is never settable from user input — it comes only from a
   * live API check against a credential the caller had to store first.
   */
  if (existing?.appUserId && existing.appUserId !== args.appUserId && !args.ownershipVerified) {
    return { ok: false, error: 'that league snapshot is already owned by a different AllFantasy account' }
  }

  /*
   * ⚠ `draft` IS A `FantraxResult`, NOT THE BOARD — and it is null when the fetch
   * threw. Unwrapping both here keeps the failure in one place: a league with no
   * readable draft yields an empty summary rather than a thrown import.
   */
  const draftSummary = mapFantraxDraftResults(draft && draft.ok ? draft.data : null, { season })

  const payload = {
    appUserId: args.appUserId,
    /*
     * The id this import was handed, kept so the snapshot can be refreshed.
     *
     * `FantraxLeague.id` is a private snapshot UUID; this is Fantrax's league ID.
     * New live League rows use this stable ID so all owners join one league.
     */
    sourceLeagueId: args.leagueId,
    sport: best.sport,
    teamCount: resolved.length,
    userTeam: mine.teamName,
    isDevy: best.isDevy,
    /*
     * ⚠ EVERY TEAM'S ROSTER, NOT JUST THE IMPORTER'S. The CSV export only ever
     * contained your own squad, so the column was shaped for one team and the
     * fetch service gave the other eleven an empty roster. The live API returns
     * all of them in the same call we already make, so throwing eleven away
     * meant importing a league whose opponents had no players — and an opponent
     * with no players cannot be scouted, matched up or traded with.
     *
     * Each row carries `teamName` so the reader can group them. A row without
     * one is a CSV-era roster and still belongs to the uploader's team, which is
     * how the old snapshots keep working.
     */
    roster: resolved.flatMap((r) =>
      r.players.map((pl) => ({ ...pl, teamName: r.teamName, teamId: r.teamId })),
    ) as unknown as object,
    standings: summarise(resolved, standings.ok ? standings.data : null) as unknown as object,
    /*
     * ⚠ THE SCHEDULE WAS ALREADY IN A RESPONSE WE FETCH AND WAS BEING DROPPED.
     * `getLeagueInfo` was read for the league name and the team list; it also
     * carries every period's fixtures and the real playoff boundary, so every
     * imported Fantrax league arrived with no schedule and no playoff structure
     * while the data sat in the same object.
     *
     * ⚠ AND THE FIXTURES CARRY RESULTS NOW. An unplayed period keeps null
     * scores rather than 0-0 — the reader in `FantraxLeagueFetchService` already
     * distinguishes the two (`asNumber(matchup.awayScore, null) ?? undefined`),
     * so a null week arrives as "no score on file" instead of a scoreless tie.
     */
    matchups: schedule.rows as unknown as object,
  }

  const row = await prisma.fantraxLeague.upsert({
    where: {
      userId_leagueName_season: {
        userId: fantraxUser.id,
        leagueName: info.data.leagueName,
        season,
      },
    },
    create: { userId: fantraxUser.id, leagueName: info.data.leagueName, season, ...payload },
    update: payload,
    select: { id: true },
  })

  return {
    ok: true,
    fantraxLeagueId: row.id,
    leagueName: info.data.leagueName,
    season,
    teamName: mine.teamName,
    resolved: mine.resolved,
    total: mine.total,
    scoringRules: scoring.rules,
    scoringType: fantraxScoringMode(info.data),
    draft: {
      picks: draftSummary.picks,
      slots: draftSummary.slotCount,
      made: draftSummary.madeCount,
      outstanding: draftSummary.outstandingCount,
      state: draftSummary.draftState,
    },
    scoringGaps: scoring.gaps,
    seasonState: schedule.position?.state ?? null,
    currentPeriod: schedule.position?.period ?? null,
    scoredPeriodsRead: schedule.periodsRead,
    scoredPeriodsFailed: schedule.periodsFailed,
  }
}

/**
 * The standings row per team, as the snapshot column stores it.
 *
 * ⚠ RANK USED TO BE ARRAY POSITION. This function returned only roster counts,
 * so the reader numbered teams 1..N in whatever order `getTeamRosters` happened
 * to return them and reported 0-0 records — a table that looks authoritative,
 * disagrees with the league, and is indistinguishable from a correct preseason
 * one until week one. Fantrax publishes the real thing on `getStandings`.
 *
 * ⚠ AND WHEN STANDINGS COULD NOT BE READ, RANK IS NULL RATHER THAN A GUESS. A
 * missing table should read as missing; inventing an order is what this is
 * fixing.
 */
function summarise(resolved: ResolvedRoster[], standings: FantraxStandingRow[] | null) {
  const byId = new Map((standings ?? []).map((row) => [row.teamId, row]))
  return resolved.map((r) => {
    const row = byId.get(r.teamId) ?? null
    return {
      team: r.teamName,
      rosterCount: r.total,
      namedCount: r.resolved,
      rank: row?.rank ?? null,
      wins: row?.wins ?? null,
      losses: row?.losses ?? null,
      ties: row?.ties ?? null,
      pointsFor: row?.pointsFor ?? null,
      /* Fantrax reports no points-against, and a zero would read as a real one. */
      pointsAgainst: null,
      /* The durable id, so a team rename does not create a new team. */
      fantraxTeamId: r.teamId,
    }
  })
}

/**
 * Attach an imported league to a franchise, creating the franchise if needed.
 *
 * ⚠ `(platform, leagueId)` IS UNIQUE, so a league already attached to another
 * franchise is refused rather than moved. Silently re-parenting someone's league
 * would empty the franchise it came from.
 */
export async function attachToFranchise(args: {
  ownerUserId: string
  franchiseName: string
  linkId?: string | null
  role: 'pro' | 'college' | 'primary' | 'linked'
  platform: string
  leagueId: string
  teamExternalId: string
}): Promise<{ ok: true; linkId: string } | { ok: false; error: string }> {
  const claimed = await prisma.franchiseLeagueMember.findFirst({
    where: { platform: args.platform, leagueId: args.leagueId },
    select: { linkId: true },
  })
  /*
   * ⚠ THIS TOLD PEOPLE THEIR OWN LEAGUE BELONGED TO SOMEBODY ELSE.
   *
   * The check compared link IDs only, so a league already attached to a franchise
   * THIS SAME USER owns was refused exactly like one owned by a stranger. That is
   * precisely what a re-import hits: the first import creates the franchise link,
   * and every attempt afterwards dies on a message that reads as an ownership
   * conflict with another account. Measured on production 2026-08-27 — the single
   * Fantrax row in `franchise_league_members` is the owner's own Cream Bowl link,
   * and it was blocking that owner.
   *
   * The rule is about the OWNER, not the link id. Someone else's franchise is still
   * refused: silently re-parenting it would empty the franchise it came from, which
   * is what the uniqueness note above is protecting.
   */
  let reclaimedLinkId: string | null = null
  if (claimed && claimed.linkId !== args.linkId) {
    const owner = await prisma.franchiseLink.findFirst({
      where: { id: claimed.linkId },
      select: { id: true, ownerUserId: true },
    })
    if (!owner || owner.ownerUserId !== args.ownerUserId) {
      return { ok: false, error: 'that league is already part of another franchise' }
    }
    // Their own franchise — reuse it rather than creating a second one for the
    // same league, which is what the unique (platform, leagueId) would reject.
    reclaimedLinkId = owner.id
  }

  const effectiveLinkId = args.linkId ?? reclaimedLinkId

  const link = effectiveLinkId
    ? await prisma.franchiseLink.findFirst({
        where: { id: effectiveLinkId, ownerUserId: args.ownerUserId },
        select: { id: true },
      })
    : await prisma.franchiseLink.create({
        data: { ownerUserId: args.ownerUserId, name: args.franchiseName },
        select: { id: true },
      })

  if (!link) return { ok: false, error: 'Franchise not found' }

  const existingMember = await prisma.franchiseLeagueMember.findFirst({
    where: { platform: args.platform, leagueId: args.leagueId },
    select: { id: true, linkId: true },
  })

  if (existingMember?.linkId === link.id) {
    await prisma.franchiseLeagueMember.update({
      where: { id: existingMember.id },
      data: { role: args.role, teamExternalId: args.teamExternalId },
    })
  } else {
    await prisma.franchiseLeagueMember.create({
      data: {
        linkId: link.id,
        role: args.role,
        platform: args.platform,
        leagueId: args.leagueId,
        teamExternalId: args.teamExternalId,
      },
    })
  }

  return { ok: true, linkId: link.id }
}
