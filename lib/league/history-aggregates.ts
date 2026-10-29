import type { LeagueSeason } from "@prisma/client";

export type LeagueSeasonTeamRecord = {
  rosterId: string | number;
  ownerId?: string;
  managerName: string;
  managerAvatar?: string | null;
  teamName?: string | null;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  playoffFinish?: string;
  isChampion?: boolean;
  isRunnerUp?: boolean;
};

export type ManagerAllTime = {
  managerKey: string;
  managerName: string;
  managerAvatar: string | null;
  seasonsPlayed: number;
  yearRange: string;
  years: number[];
  totalWins: number;
  totalLosses: number;
  totalTies: number;
  winPct: number;
  totalPoints: number;
  avgPointsPerSeason: number;
  championships: number;
  runnerUps: number;
  bestFinish: string;
};

function normalizeManagerKey(name: string): string {
  return name.trim().toLowerCase();
}

export function parseTeamRecords(raw: unknown): LeagueSeasonTeamRecord[] {
  if (!raw || !Array.isArray(raw)) return [];
  return raw.filter((r) => r && typeof r === "object") as LeagueSeasonTeamRecord[];
}

/** Aggregate across stored LeagueSeason rows (any league). */
export function computeAllTimeStandings(seasons: Pick<LeagueSeason, 'season' | 'teamRecords'>[]): ManagerAllTime[] {
  const byKey = new Map<
    string,
    {
      managerName: string;
      managerAvatar: string | null;
      years: Set<number>;
      wins: number;
      losses: number;
      ties: number;
      points: number;
      championships: number;
      runnerUps: number;
      bestRank: number;
    }
  >();

  for (const seasonRow of seasons) {
    const y = seasonRow.season;
    const records = parseTeamRecords(seasonRow.teamRecords);
    for (const r of records) {
      const key = normalizeManagerKey(r.managerName || String(r.rosterId));
      const cur = byKey.get(key) ?? {
        managerName: r.managerName || "Unknown",
        managerAvatar: r.managerAvatar ?? null,
        years: new Set<number>(),
        wins: 0,
        losses: 0,
        ties: 0,
        points: 0,
        championships: 0,
        runnerUps: 0,
        bestRank: 999,
      };
      cur.years.add(y);
      cur.wins += r.wins;
      cur.losses += r.losses;
      cur.ties += r.ties;
      cur.points += r.pointsFor;
      if (r.isChampion) cur.championships += 1;
      if (r.isRunnerUp) cur.runnerUps += 1;
      const totalGames = r.wins + r.losses + r.ties;
      const estRank = totalGames > 0 ? 1 + Math.round((1 - r.wins / totalGames) * 12) : 99;
      cur.bestRank = Math.min(cur.bestRank, estRank);
      byKey.set(key, cur);
    }
  }

  const rows: ManagerAllTime[] = [];
  for (const [, v] of byKey) {
    const yearList = [...v.years].sort((a, b) => a - b);
    const denom = v.wins + v.losses + v.ties;
    const winPct = denom > 0 ? v.wins / denom : 0;
    const seasonsPlayed = yearList.length;
    rows.push({
      managerKey: normalizeManagerKey(v.managerName),
      managerName: v.managerName,
      managerAvatar: v.managerAvatar,
      seasonsPlayed,
      years: yearList,
      yearRange: yearList.length ? `${yearList[0]}–${yearList[yearList.length - 1]}` : "—",
      totalWins: v.wins,
      totalLosses: v.losses,
      totalTies: v.ties,
      winPct,
      totalPoints: v.points,
      avgPointsPerSeason: seasonsPlayed > 0 ? v.points / seasonsPlayed : 0,
      championships: v.championships,
      runnerUps: v.runnerUps,
      bestFinish: v.bestRank < 99 ? `~#${v.bestRank}` : "—",
    });
  }

  rows.sort((a, b) => {
    if (b.championships !== a.championships) return b.championships - a.championships;
    if (b.winPct !== a.winPct) return b.winPct - a.winPct;
    return b.totalWins - a.totalWins;
  });

  return rows;
}
