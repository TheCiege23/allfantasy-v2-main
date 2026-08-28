/**
 * Resolves deterministic player stats from multiple sources (Prompt 130):
 * - FantasyCalc
 * - Sleeper-linked identity / ADP
 * - ESPN injury feed cache (sports_injuries)
 * - Internal ADP snapshot
 * - Internal player projections
 * - League scoring settings
 */

import { prisma } from '@/lib/prisma';
import { findMultiADP } from '@/lib/multi-platform-adp';
import { normalizePlayerName } from '@/lib/team-abbrev';
import { type FantasyCalcSettings } from '@/lib/fantasycalc';
import { getPlayerValuesForNamesDbFirst } from '@/lib/fantasycalc-db';
import type {
  ResolvedPlayerStats,
  HistoricalSeasonRow,
  ProjectionRow,
  ScoringFormat,
  LeagueScoringSettings,
  InjurySignal,
} from './types';
import { DEFAULT_SPORT, normalizeToSupportedSport } from '@/lib/sport-scope';
import {
  disambiguate,
  IDENTITY_MAP_SELECT,
} from '@/lib/shared-services/player-identity/PlayerIdentityResolver';

const HISTORICAL_SEASONS_LIMIT = 5;

type HistoricalResolved = {
  rows: HistoricalSeasonRow[];
  rollingInsightsPlayerId: string | null;
  team: string | null;
  position: string | null;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function scoringToFantasyCalc(
  scoringFormat?: ScoringFormat,
  leagueScoringSettings?: LeagueScoringSettings | null
): FantasyCalcSettings {
  const toFantasyCalcPpr = (value: number): 0 | 0.5 | 1 => {
    if (value >= 0.75) return 1;
    if (value >= 0.25) return 0.5;
    return 0;
  };
  const pprFromFormat =
    scoringFormat === 'non_ppr' ? 0 : scoringFormat === 'half_ppr' ? 0.5 : 1;
  const pprRaw =
    typeof leagueScoringSettings?.ppr === 'number'
      ? leagueScoringSettings.ppr
      : pprFromFormat;
  const ppr = toFantasyCalcPpr(pprRaw);
  return {
    isDynasty: true,
    numQbs: leagueScoringSettings?.superflex ? 2 : 1,
    numTeams: 12,
    ppr,
  };
}

function inferTrendFromHistorical(historical: HistoricalSeasonRow[]): number {
  if (historical.length < 2) return 0;
  const points = [...historical]
    .reverse()
    .map((row) =>
      row.fantasyPointsPerGame ??
      (row.gamesPlayed && row.fantasyPoints ? row.fantasyPoints / row.gamesPlayed : null)
    )
    .filter((v): v is number => v != null && Number.isFinite(v));
  if (points.length < 2) return 0;
  const delta = points[points.length - 1] - points[0];
  return Math.round(delta * 10) / 10;
}

function scoreInjuryRisk(status: string | null, note: string | null): number | null {
  const raw = `${status ?? ''} ${note ?? ''}`.toLowerCase();
  if (!raw.trim()) return null;
  if (raw.includes('out') || raw.includes('ir') || raw.includes('pup')) return 90;
  if (raw.includes('doubtful')) return 75;
  if (raw.includes('questionable')) return 55;
  if (raw.includes('limited') || raw.includes('probable') || raw.includes('day-to-day')) return 35;
  if (raw.includes('healthy') || raw.includes('active')) return 15;
  return 45;
}

function applyScoringAdjustment(
  basePoints: number | null,
  position: string | null,
  historical: HistoricalSeasonRow[],
  leagueScoringSettings?: LeagueScoringSettings | null
): number | null {
  if (basePoints == null || !Number.isFinite(basePoints)) return null;
  if (!leagueScoringSettings) return basePoints;

  const ppr = typeof leagueScoringSettings.ppr === 'number' ? leagueScoringSettings.ppr : null;
  const tePremium =
    typeof leagueScoringSettings.tePremium === 'number'
      ? leagueScoringSettings.tePremium
      : null;
  const passTdPoints =
    typeof leagueScoringSettings.passTdPoints === 'number'
      ? leagueScoringSettings.passTdPoints
      : null;

  const latest = historical[0];
  const receptions = latest?.receptions ?? 0;
  let adjusted = basePoints;

  if (ppr != null) {
    // Baseline projections are approximately PPR=1 in this flow.
    adjusted += (ppr - 1) * receptions;
  }
  if (position === 'TE' && tePremium != null && tePremium > 0) {
    adjusted += tePremium * receptions;
  }
  if (position === 'QB' && passTdPoints != null) {
    const passTdsFromYards =
      latest?.passingYards != null ? Math.max(0, latest.passingYards / 150) : 0;
    adjusted += (passTdPoints - 4) * passTdsFromYards;
  }
  return Math.round(adjusted * 10) / 10;
}

export async function resolvePlayerStats(
  playerName: string,
  options?: {
    sport?: string | null;
    scoringFormat?: ScoringFormat;
    leagueScoringSettings?: LeagueScoringSettings | null;
  }
): Promise<ResolvedPlayerStats | null> {
  const name = playerName.trim();
  if (!name) return null;

  const sport = normalizeToSupportedSport(options?.sport ?? DEFAULT_SPORT);
  const settings = scoringToFantasyCalc(
    options?.scoringFormat,
    options?.leagueScoringSettings
  );

  const historicalResolved = await resolveHistorical(name, sport);
  const [projection, internalAdp, internalProjectionPoints, injury, sleeperSignal, scheduleDifficultyScore] =
    await Promise.all([
      resolveProjection(name, settings, historicalResolved.rows, sport),
      resolveInternalAdp(name, sport, options?.scoringFormat),
      resolveInternalProjectionPoints(name, sport, historicalResolved.rollingInsightsPlayerId),
      resolveInjurySignal(name, sport),
      resolveSleeperSignal(name, sport, historicalResolved.team),
      resolveScheduleDifficultyScore(
        sport,
        historicalResolved.team ??
          (findMultiADP(name, historicalResolved.position ?? undefined)?.team ?? null)
      ),
    ]);

  const fallbackPosition =
    historicalResolved.position ??
    projection?.position ??
    (findMultiADP(name)?.position ?? null);
  const fallbackTeam =
    historicalResolved.team ??
    projection?.team ??
    (findMultiADP(name)?.team ?? null);

  const adjustedProjection = applyScoringAdjustment(
    projection?.redraftValue ?? internalProjectionPoints,
    fallbackPosition,
    historicalResolved.rows,
    options?.leagueScoringSettings
  );

  const mergedProjection: ProjectionRow | null = projection
    ? {
        ...projection,
        redraftValue: adjustedProjection ?? projection.redraftValue,
      }
    : internalProjectionPoints != null
      ? {
          value: Math.round(internalProjectionPoints * 25),
          rank: 999,
          positionRank: 999,
          trend30Day: inferTrendFromHistorical(historicalResolved.rows),
          redraftValue: adjustedProjection ?? internalProjectionPoints,
          source: 'internal_projection',
          position: fallbackPosition,
          team: fallbackTeam,
          volatility: null,
        }
      : null;

  return {
    name,
    position: fallbackPosition,
    team: fallbackTeam,
    historical: historicalResolved.rows,
    projection: mergedProjection,
    internalAdp,
    sleeperAdp: sleeperSignal.sleeperAdp,
    internalProjectionPoints:
      adjustedProjection ?? internalProjectionPoints ?? mergedProjection?.redraftValue ?? null,
    injury,
    scheduleDifficultyScore,
    sourceFlags: {
      fantasyCalc: projection != null,
      sleeper: sleeperSignal.available,
      espnInjuryFeed: injury.source === 'espn',
      internalAdp: internalAdp != null,
      internalProjections: internalProjectionPoints != null,
      leagueScoringSettings:
        options?.leagueScoringSettings != null &&
        Object.keys(options.leagueScoringSettings).length > 0,
    },
  };
}

async function resolveHistorical(
  playerName: string,
  sport: string
): Promise<HistoricalResolved> {
  const normalized = playerName.trim();
  if (!normalized) {
    return {
      rows: [],
      rollingInsightsPlayerId: null,
      team: null,
      position: null,
    };
  }

  const rows = await prisma.playerSeasonStats.findMany({
    where: {
      sport,
      playerName: { equals: normalized, mode: 'insensitive' },
      source: 'rolling_insights',
    },
    orderBy: { season: 'desc' },
    take: HISTORICAL_SEASONS_LIMIT,
    select: {
      playerId: true,
      season: true,
      gamesPlayed: true,
      fantasyPoints: true,
      fantasyPointsPerGame: true,
      position: true,
      team: true,
      stats: true,
    },
  });

  return {
    rows: rows.map((row) => {
      const stats = (row.stats as Record<string, number | null>) ?? {};
      return {
        season: row.season,
        gamesPlayed: row.gamesPlayed ?? null,
        fantasyPoints: row.fantasyPoints ?? null,
        fantasyPointsPerGame:
          row.fantasyPointsPerGame ??
          (row.fantasyPoints && row.gamesPlayed
            ? row.fantasyPoints / row.gamesPlayed
            : null),
        passingYards: stats.passing_yards ?? stats.passingYards ?? null,
        rushingYards: stats.rushing_yards ?? stats.rushingYards ?? null,
        receivingYards: stats.receiving_yards ?? stats.receivingYards ?? null,
        receptions: stats.receptions ?? null,
      };
    }),
    rollingInsightsPlayerId: rows[0]?.playerId ?? null,
    team: rows[0]?.team ?? null,
    position: rows[0]?.position ?? null,
  };
}

async function resolveProjection(
  playerName: string,
  settings: FantasyCalcSettings,
  historical: HistoricalSeasonRow[],
  sport: string
): Promise<ProjectionRow | null> {
  const normalized = playerName.trim();
  if (!normalized) return null;

  const map = await getPlayerValuesForNamesDbFirst([normalized], settings);
  const key = normalized.toLowerCase();
  const lookup = map.get(key) ?? map.get(playerName) ?? null;
  if (!lookup) return null;

  const trendFallback = inferTrendFromHistorical(historical);
  const normalizedSport = normalizeToSupportedSport(sport);
  const adp = normalizedSport === 'NFL'
    ? findMultiADP(normalized, lookup.position ?? undefined, lookup.team ?? undefined)
    : null;

  return {
    value: lookup.value,
    rank: lookup.rank,
    positionRank: lookup.positionRank,
    trend30Day: lookup.trend30Day ?? trendFallback,
    redraftValue: lookup.redraftValue ?? null,
    source: 'fantasycalc',
    position: lookup.position ?? null,
    team: lookup.team ?? adp?.team ?? null,
    volatility: lookup.volatility ?? null,
  };
}

async function resolveInternalProjectionPoints(
  playerName: string,
  sport: string,
  rollingInsightsPlayerId: string | null
): Promise<number | null> {
  let playerId = rollingInsightsPlayerId;
  if (!playerId) {
    const latest = await prisma.playerSeasonStats.findFirst({
      where: {
        sport,
        source: 'rolling_insights',
        playerName: { equals: playerName, mode: 'insensitive' },
      },
      orderBy: { season: 'desc' },
      select: { playerId: true },
    });
    playerId = latest?.playerId ?? null;
  }
  if (!playerId) return null;

  const projection = await prisma.playerCareerProjection.findFirst({
    where: { sport, playerId },
    orderBy: { season: 'desc' },
    select: { projectedPointsYear1: true },
  });
  return projection?.projectedPointsYear1 ?? null;
}

async function resolveInternalAdp(
  playerName: string,
  sport: string,
  scoringFormat?: ScoringFormat
): Promise<number | null> {
  const formatCandidates = new Set<string>(['default', scoringFormat ?? 'ppr', 'ppr']);
  const snapshots = await prisma.aiAdpSnapshot.findMany({
    where: {
      sport,
      leagueType: 'redraft',
      formatKey: { in: Array.from(formatCandidates) },
    },
    orderBy: { computedAt: 'desc' },
    take: 4,
    select: { snapshotData: true },
  });
  const normalized = normalizePlayerName(playerName);
  for (const row of snapshots) {
    const data = Array.isArray(row.snapshotData)
      ? (row.snapshotData as Array<Record<string, unknown>>)
      : [];
    for (const item of data) {
      const candidateName = typeof item.playerName === 'string' ? item.playerName : '';
      if (!candidateName) continue;
      if (normalizePlayerName(candidateName) !== normalized) continue;
      const adp = typeof item.adp === 'number' ? item.adp : Number(item.adp);
      if (Number.isFinite(adp)) return adp;
    }
  }
  return null;
}

async function resolveInjurySignal(
  playerName: string,
  sport: string
): Promise<InjurySignal> {
  const injuries = await prisma.sportsInjury.findMany({
    where: {
      sport,
      source: 'espn',
      playerName: { contains: playerName, mode: 'insensitive' },
    },
    orderBy: [{ date: 'desc' }, { updatedAt: 'desc' }],
    take: 12,
    select: {
      playerName: true,
      status: true,
      description: true,
      type: true,
    },
  });

  const normalized = normalizePlayerName(playerName);
  const match =
    injuries.find((item) => normalizePlayerName(item.playerName) === normalized) ??
    injuries[0] ??
    null;

  if (!match) {
    return { status: null, source: 'none', riskScore: null, note: null };
  }

  const note = match.description ?? match.type ?? null;
  return {
    status: match.status ?? null,
    source: 'espn',
    riskScore: scoreInjuryRisk(match.status ?? null, note),
    note,
  };
}

/**
 * ⚠ `PlayerIdentityMap` HOLDS MORE THAN ONE ROW PER NAME, so this cannot use
 * `findFirst`. Measured on production 2026-08-28: NFL has 178 duplicate
 * `normalizedName` groups covering 373 rows, and the twins routinely split the
 * provider ids — one row carries the `sleeperId` while the other carries none.
 * `findFirst` with no `orderBy` lets Postgres return either, so this reported a
 * player as unavailable roughly half the time for those names, purely on which
 * row the planner happened to hand back.
 *
 * The duplicates are NOT safely mergeable (some are real homonyms — two Kyle
 * Williamses, both WR, both NE, distinguishable only by birthday, and `dob` is
 * unpopulated on every row in every sport), so the fix is at the read: take all
 * candidates and let the shared scorer choose.
 *
 * `teamHint` is passed but a position hint deliberately is NOT — see the warning
 * on `disambiguate`, whose -3 mismatch penalty would fire on a third of correct
 * rows given this caller's fine-grained RI position vocabulary.
 */
async function resolveSleeperSignal(
  playerName: string,
  sport: string,
  teamHint: string | null
): Promise<{ available: boolean; sleeperAdp: number | null }> {
  const normalized = normalizePlayerName(playerName);
  const candidates = await prisma.playerIdentityMap.findMany({
    where: {
      normalizedName: normalized,
      sport,
    },
    select: IDENTITY_MAP_SELECT,
    // Stable input order so a scoring tie resolves the same way on every call.
    orderBy: { id: 'asc' },
  });
  const identity = candidates.length
    ? disambiguate(candidates, null, teamHint).best
    : null;

  const adp = sport === 'NFL' ? findMultiADP(playerName)?.redraft?.sleeper ?? null : null;
  if (identity?.sleeperId || adp != null) {
    return { available: true, sleeperAdp: adp };
  }

  const sleeperRow = await prisma.sportsPlayer.findFirst({
    where: {
      sport,
      source: 'sleeper',
      name: { equals: playerName, mode: 'insensitive' },
    },
    select: { id: true },
  });
  return {
    available: Boolean(sleeperRow),
    sleeperAdp: adp,
  };
}

async function resolveScheduleDifficultyScore(
  sport: string,
  team: string | null
): Promise<number | null> {
  if (!team) return null;

  const upcomingGames = await prisma.sportsGame.findMany({
    where: {
      sport,
      OR: [{ homeTeam: team }, { awayTeam: team }],
      startTime: { gte: new Date() },
    },
    orderBy: { startTime: 'asc' },
    take: 6,
    select: {
      homeTeam: true,
      awayTeam: true,
    },
  });

  if (upcomingGames.length === 0) return null;
  const opponents = upcomingGames
    .map((g) => (g.homeTeam === team ? g.awayTeam : g.homeTeam))
    .filter((o): o is string => Boolean(o));
  if (opponents.length === 0) return null;

  const teamStats = await prisma.teamSeasonStats.findMany({
    where: {
      sport,
      team: { in: opponents },
      gamesPlayed: { gt: 0 },
    },
    orderBy: { season: 'desc' },
    select: {
      team: true,
      pointsAgainst: true,
      gamesPlayed: true,
    },
  });

  if (teamStats.length === 0) return null;
  const latestByTeam = new Map<string, { pointsAgainst: number; gamesPlayed: number }>();
  for (const row of teamStats) {
    if (latestByTeam.has(row.team)) continue;
    if (row.pointsAgainst == null || row.gamesPlayed == null || row.gamesPlayed <= 0) continue;
    latestByTeam.set(row.team, {
      pointsAgainst: row.pointsAgainst,
      gamesPlayed: row.gamesPlayed,
    });
  }

  const values = opponents
    .map((opp) => latestByTeam.get(opp))
    .filter((v): v is { pointsAgainst: number; gamesPlayed: number } => Boolean(v))
    .map((v) => v.pointsAgainst / v.gamesPlayed);

  if (values.length === 0) return null;
  const avgPointsAllowed = values.reduce((sum, value) => sum + value, 0) / values.length;
  // Lower opponent points allowed means tougher schedule (higher difficulty score).
  const score = clamp(50 + (22 - avgPointsAllowed) * 4, 5, 95);
  return Math.round(score * 10) / 10;
}
