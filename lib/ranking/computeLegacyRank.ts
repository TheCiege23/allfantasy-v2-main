import { XP_SOURCES } from "./config";
import { difficultyFromLegacyLeague } from "./difficulty";
import { RANK_LEVELS, getLevelFromXp } from "@/lib/rank/levels";

export type LegacyLeagueHistoryRow = {
  season: number;
  sport?: string | null;
  type?: string | null;
  scoring?: string | null;
  team_count?: number | null;

  wins: number;
  losses: number;
  ties: number;

  made_playoffs: boolean;
  is_champion: boolean;
};

export type LegacyTotals = {
  seasons_imported: number;
  leagues_played: number;
  wins: number;
  playoffs: number;
  championships: number;
};

export type RankPreview = {
  career: {
    xp: number;
    level: number;
    tier: number;
    tier_name: string;
  };
  yearly_projection: {
    /** Real: an honest per-year average from actual league history. */
    baseline_year_xp: number;
    baseline_year_levels: number;
    /**
     * Removed (audit finding #12) — these used to be a fabricated "AI-boosted" projection
     * built from hardcoded lift percentages with no real model behind them. Always 0 now;
     * confirmed unused by any rendered UI. A real projection is a future feature.
     */
    ai_low_year_xp: number;
    ai_mid_year_xp: number;
    ai_high_year_xp: number;
    assumptions: {
      avgLeaguesPerYear: number;
      avgWinsPerYear: number;
      avgPlayoffsPerYear: number;
      avgChampsPerYear: number;
      avgMultiplier: number;
      xp_per_level: number;
      tier_xp_thresholds: { tier: number; name: string; minLevel: number; minXp: number }[];
    };
  };
  breakdown: {
    xp_from_wins: number;
    xp_from_playoffs: number;
    xp_from_championships: number;
    xp_from_participation: number;
    xp_from_formats: number;
    avg_multiplier: number;
  };
};

function safe(n: unknown, fallback = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? x : fallback;
}

function round(n: number) {
  return Math.round(n);
}

export function computeLegacyRankPreview(input: {
  totals: LegacyTotals;
  leagueHistory: LegacyLeagueHistoryRow[];
}): RankPreview {
  const leagues = input.leagueHistory || [];

  const multipliers = leagues.map((lg) => {
    const d = difficultyFromLegacyLeague({
      teamCount: lg.team_count ?? null,
      scoringType: lg.scoring ?? null,
      leagueType: lg.type ?? null,
    });
    return { mult: d.multiplier, d };
  });

  const avgMultiplier =
    multipliers.length > 0
      ? multipliers.reduce((s, x) => s + x.mult, 0) / multipliers.length
      : 1.0;

  const seenFormatKeys = new Set<string>();
  let xpFormats = 0;

  let xpWins = 0;
  let xpPlayoffs = 0;
  let xpChamps = 0;
  let xpParticipation = 0;

  for (let i = 0; i < leagues.length; i++) {
    const lg = leagues[i];
    const mult = multipliers[i]?.mult ?? 1.0;

    xpWins += safe(lg.wins, 0) * XP_SOURCES.regularWin * mult;
    xpParticipation += XP_SOURCES.leagueParticipation * mult;

    if (lg.made_playoffs) xpPlayoffs += XP_SOURCES.playoffAppearance * mult;
    if (lg.is_champion) xpChamps += XP_SOURCES.championshipWin * mult;

    const formatKey = [
      (lg.sport || "").toLowerCase(),
      (lg.type || "").toLowerCase(),
      (lg.scoring || "").toLowerCase(),
    ].join("|").trim();

    if (formatKey && !seenFormatKeys.has(formatKey)) {
      seenFormatKeys.add(formatKey);
      xpFormats += XP_SOURCES.uniqueFormatPlayed * mult;
    }
  }

  const careerXp = round(xpWins + xpPlayoffs + xpChamps + xpParticipation + xpFormats);
  const resolved = getLevelFromXp(careerXp);
  const careerLevel = resolved.level;
  const tier = { tier: resolved.level, name: resolved.name };

  const seasons = Math.max(1, safe(input.totals.seasons_imported, 1));
  const avgLeaguesPerYear = safe(input.totals.leagues_played, leagues.length) / seasons;
  const avgWinsPerYear = safe(input.totals.wins, 0) / seasons;
  const avgPlayoffsPerYear = safe(input.totals.playoffs, 0) / seasons;
  const avgChampsPerYear = safe(input.totals.championships, 0) / seasons;

  const baselineYearXp =
    round(
      (avgWinsPerYear * XP_SOURCES.regularWin +
        avgPlayoffsPerYear * XP_SOURCES.playoffAppearance +
        avgChampsPerYear * XP_SOURCES.championshipWin +
        avgLeaguesPerYear * XP_SOURCES.leagueParticipation) * avgMultiplier
    );

  // Removed (audit finding #12): this block used to project ai_low/mid/high_year_xp by
  // applying hardcoded "AI lift" percentages (5-12% win-rate lift, 0.35 playoff lift, 0.10
  // championship lift) that were never derived from any real model or historical data —
  // invented numbers, not computed ones. Confirmed unused by any rendered UI. baseline_year_xp
  // above stays: it's a real, honestly-computed per-year average from actual league history,
  // not fabricated. A real AI-backed projection can be built later as its own feature.
  const aiLowYearXp = 0;
  const aiMidYearXp = 0;
  const aiHighYearXp = 0;

  return {
    career: {
      xp: careerXp,
      level: careerLevel,
      tier: tier.tier,
      tier_name: tier.name,
    },
    yearly_projection: {
      baseline_year_xp: baselineYearXp,
      baseline_year_levels: 0,
      ai_low_year_xp: aiLowYearXp,
      ai_mid_year_xp: aiMidYearXp,
      ai_high_year_xp: aiHighYearXp,
      assumptions: {
        avgLeaguesPerYear: Number(avgLeaguesPerYear.toFixed(2)),
        avgWinsPerYear: Number(avgWinsPerYear.toFixed(2)),
        avgPlayoffsPerYear: Number(avgPlayoffsPerYear.toFixed(2)),
        avgChampsPerYear: Number(avgChampsPerYear.toFixed(2)),
        avgMultiplier: Number(avgMultiplier.toFixed(2)),
        xp_per_level: 0,
        tier_xp_thresholds: RANK_LEVELS.map((r) => ({
          tier: r.level,
          name: r.name,
          minLevel: r.level,
          minXp: r.minXp,
        })),
      },
    },
    breakdown: {
      xp_from_wins: round(xpWins),
      xp_from_playoffs: round(xpPlayoffs),
      xp_from_championships: round(xpChamps),
      xp_from_participation: round(xpParticipation),
      xp_from_formats: round(xpFormats),
      avg_multiplier: Number(avgMultiplier.toFixed(2)),
    },
  };
}
