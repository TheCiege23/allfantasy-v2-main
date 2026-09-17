import { prisma } from "@/lib/prisma";
import {
  getLeagueInfo,
  getLeagueRosters,
  getLeagueUsers,
  getPlayoffBracket,
  type SleeperLeague,
  type SleeperPlayoffBracket,
  type SleeperRoster,
} from "@/lib/sleeper-client";
import type { LeagueSeasonTeamRecord } from "@/lib/league/history-aggregates";
import { resolveBracketPlacements } from "@/lib/league-import/sleeper/bracketPlacements";

const MAX_CHAIN = 10;
const DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function scoringFormatFromSettings(rec: number | undefined): string {
  if (rec === 1) return "ppr";
  if (rec === 0.5) return "half_ppr";
  return "standard";
}

/**
 * Champion and runner-up from the title game.
 *
 * ⚠ THIS USED TO TAKE `finals.find((b) => b.m === 1) ?? finals[0]`. `m` is a
 * bracket-wide match id, so no last-round game is ever `m === 1`, and the fallback
 * took whichever last-round game Sleeper listed first — the third- or fifth-place
 * game as often as the final. The title game is the one with `p === 1`; see
 * `bracketPlacements.ts`.
 *
 * The champion falls back to the league's own `winner_roster_id`, then
 * `metadata.latest_league_winner_roster_id` (the fallback `sleeperLeagueHistoryService`
 * uses) — but the runner-up never does: nothing but the title game says who lost it.
 */
export function parseChampionFromBracket(
  bracket: SleeperPlayoffBracket[],
  /** The league row as Sleeper returned it; only its winner fields are read. */
  league?: { metadata?: unknown; winner_roster_id?: unknown } | null,
): {
  winnerRosterId: number | null;
  loserRosterId: number | null;
} {
  const placements = resolveBracketPlacements(bracket);
  let winnerRosterId = placements.championRosterId;
  const loserRosterId = placements.runnerUpRosterId;
  if (winnerRosterId == null && league) {
    const meta =
      league.metadata && typeof league.metadata === "object"
        ? (league.metadata as Record<string, unknown>)
        : null;
    for (const raw of [league.winner_roster_id, meta?.latest_league_winner_roster_id]) {
      const n = Number(raw);
      if (raw != null && Number.isFinite(n) && n > 0) {
        winnerRosterId = n;
        break;
      }
    }
  }
  return { winnerRosterId, loserRosterId };
}

function pointsAgainst(roster: SleeperRoster): number {
  const s = roster.settings;
  if (!s) return 0;
  const base = (s.fpts_against ?? 0) + (s.fpts_against_decimal ?? 0) / 100;
  if (typeof s.ppts === "number") return s.ppts;
  return base;
}

function pointsFor(roster: SleeperRoster): number {
  const s = roster.settings;
  if (!s) return 0;
  return (s.fpts ?? 0) + (s.fpts_decimal ?? 0) / 100;
}

type SleeperUserRow = {
  user_id?: string;
  display_name?: string;
  avatar?: string | null;
  metadata?: { team_name?: string } | null;
};

export type SyncLeagueHistorySummary = {
  seasons: number;
  yearsFound: number[];
};

/**
 * Walks Sleeper previous_league_id chain and stores LeagueSeason rows for this AF league.
 */
export async function syncLeagueHistory(
  leagueId: string,
  platformLeagueId: string,
  userId: string
): Promise<SyncLeagueHistorySummary> {
  const leagueRow = await prisma.league.findFirst({
    where: { id: leagueId, userId },
    select: { id: true, platform: true },
  });
  if (!leagueRow || leagueRow.platform !== "sleeper") {
    return { seasons: 0, yearsFound: [] };
  }

  let currentId: string | null = platformLeagueId;
  let count = 0;
  const yearsFound: number[] = [];

  for (let step = 0; step < MAX_CHAIN && currentId; step++) {
    const [sleeperLeague, rosters, users, bracket] = (await Promise.all([
      getLeagueInfo(currentId),
      getLeagueRosters(currentId),
      getLeagueUsers(currentId),
      getPlayoffBracket(currentId),
    ])) as [SleeperLeague | null, SleeperRoster[], SleeperUserRow[], SleeperPlayoffBracket[]];

    if (!sleeperLeague) break;

    const seasonYear = parseInt(String(sleeperLeague.season), 10);
    if (!Number.isFinite(seasonYear)) break;

    const userByOwner = new Map<string, SleeperUserRow>();
    for (const u of users as SleeperUserRow[]) {
      if (u.user_id) userByOwner.set(u.user_id, u);
    }

    /*
     * Only a FINISHED season has a champion. Sleeper leaves `w`/`l` null on undecided
     * games, but the metadata fallback is a league-level field that can outlive the
     * season it describes — so an in-season row must not read it.
     */
    const seasonComplete = String(sleeperLeague.status ?? "").toLowerCase() === "complete";
    const { winnerRosterId, loserRosterId } = seasonComplete
      ? parseChampionFromBracket(bracket, sleeperLeague as unknown as { metadata?: unknown; winner_roster_id?: unknown })
      : { winnerRosterId: null, loserRosterId: null };

    let championName: string | null = null;
    let championAvatar: string | null = null;
    let runnerUpName: string | null = null;
    let championTeamId: string | null = null;

    if (winnerRosterId != null) {
      const winRoster = rosters.find((r) => r.roster_id === winnerRosterId);
      const ownerId = winRoster?.owner_id;
      const u = ownerId ? userByOwner.get(ownerId) : undefined;
      championName = u?.display_name ?? null;
      championAvatar = u?.avatar ?? null;
      const ext = String(winnerRosterId);
      const team = await prisma.leagueTeam.findFirst({
        where: { leagueId, externalId: ext },
        select: { id: true },
      });
      championTeamId = team?.id ?? null;
    }

    if (loserRosterId != null) {
      const loseRoster = rosters.find((r) => r.roster_id === loserRosterId);
      const ownerId = loseRoster?.owner_id;
      const u = ownerId ? userByOwner.get(ownerId) : undefined;
      runnerUpName = u?.display_name ?? null;
    }

    const teamRecords: LeagueSeasonTeamRecord[] = rosters.map((r) => {
      const u = r.owner_id ? userByOwner.get(r.owner_id) : undefined;
      const pf = pointsFor(r);
      const pa = pointsAgainst(r);
      const isChampion = winnerRosterId != null && r.roster_id === winnerRosterId;
      const isRunnerUp = loserRosterId != null && r.roster_id === loserRosterId;
      return {
        rosterId: r.roster_id,
        ownerId: r.owner_id,
        managerName: u?.display_name ?? "Unknown",
        managerAvatar: u?.avatar ? `https://sleepercdn.com/avatars/thumbs/${u.avatar}` : null,
        teamName: u?.metadata?.team_name ?? null,
        wins: r.settings?.wins ?? 0,
        losses: r.settings?.losses ?? 0,
        ties: r.settings?.ties ?? 0,
        pointsFor: pf,
        pointsAgainst: pa,
        isChampion,
        isRunnerUp,
      };
    });

    const sortedByRecord = [...teamRecords].sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      return b.pointsFor - a.pointsFor;
    });
    const regularSeasonWinnerName =
      sortedByRecord[0] && sortedByRecord[0].wins + sortedByRecord[0].losses + sortedByRecord[0].ties > 0
        ? sortedByRecord[0].managerName
        : null;

    const recRaw = sleeperLeague.scoring_settings as Record<string, number> | undefined;
    const rec = recRaw?.rec;
    const settings = sleeperLeague.settings as Record<string, unknown> | undefined;
    const typeVal = settings?.type;
    const isDynasty = typeVal === 2 || typeVal === "2";

    await prisma.leagueSeason.upsert({
      where: {
        leagueId_season: {
          leagueId,
          season: seasonYear,
        },
      },
      update: {
        platformLeagueId: currentId,
        championTeamId,
        championName,
        championAvatar,
        runnerUpName,
        regularSeasonWinnerName,
        teamRecords: teamRecords as unknown as object[],
        teamCount: sleeperLeague.total_rosters ?? null,
        scoringFormat: scoringFormatFromSettings(rec),
        isDynasty,
        status: sleeperLeague.status === "complete" ? "complete" : "in_season",
      },
      create: {
        leagueId,
        season: seasonYear,
        platformLeagueId: currentId,
        championTeamId,
        championName,
        championAvatar,
        runnerUpName,
        regularSeasonWinnerName,
        teamRecords: teamRecords as unknown as object[],
        teamCount: sleeperLeague.total_rosters ?? null,
        scoringFormat: scoringFormatFromSettings(rec),
        isDynasty,
        status: sleeperLeague.status === "complete" ? "complete" : "in_season",
      },
    });

    count += 1;
    yearsFound.push(seasonYear);

    const previousLeagueId = sleeperLeague.previous_league_id as string | null | undefined;
    currentId =
      previousLeagueId != null && String(previousLeagueId).length > 0 ? String(previousLeagueId) : null;
    if (currentId) await sleep(DELAY_MS);
  }

  yearsFound.sort((a, b) => a - b);

  return { seasons: count, yearsFound };
}
