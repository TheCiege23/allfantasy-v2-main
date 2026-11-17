type FeedScope = "global" | "league";

export type GameFinalContext = {
  tournamentId: string;
  gameId: string;
  round: "R64" | "R32" | "S16" | "E8" | "F4" | "CH";
  seedWinner: number;
  seedLoser: number;
  underdogWon: boolean;
  modelWinProbUnderdog?: number | null;
};

export type LeagueImpactContext = {
  scope: FeedScope;
  leagueId?: string | null;
  totalBrackets: number;
  favoritePickPct: number;
  champPickElimPct?: number | null;
  finalFourPickElimPct?: number | null;
  perfectRemainingPct?: number | null;
  top10RankChanges?: number | null;
};

type BustedEventDraft = {
  type:
    | "MASS_BUST"
    | "UPSET_SHOCK"
    | "PERFECT_BRACKET_ALERT"
    | "LEADERBOARD_EARTHQUAKE"
    | "CHAMPIONSHIP_DEATH_BLOW";
  title: string;
  message: string;
  impactPct?: number | null;
  gameId?: string;
};

export type SpamControl = {
  maxPostsPerGame: number;
  globalMinBrackets: number;
  leagueMinImpactPct: number;
  globalMinImpactPct: number;
};

export const DEFAULT_SPAM: SpamControl = {
  maxPostsPerGame: 1,
  globalMinBrackets: 10000,
  leagueMinImpactPct: 0.15,
  globalMinImpactPct: 0.10,
};

function pct(x: number) {
  return Math.max(0, Math.min(100, x * 100));
}

export function evaluateBracketsBustedEvents(
  game: GameFinalContext,
  impact: LeagueImpactContext,
  spam: SpamControl = DEFAULT_SPAM
): BustedEventDraft[] {
  if (impact.scope === "global") {
    if (impact.totalBrackets < spam.globalMinBrackets) return [];
  }

  const drafts: BustedEventDraft[] = [];

  const seedGap = Math.max(0, game.seedWinner - game.seedLoser);

  const upsetShock =
    game.underdogWon &&
    seedGap >= 5 &&
    (game.modelWinProbUnderdog == null || game.modelWinProbUnderdog < 0.35) &&
    impact.favoritePickPct > 0.2;

  if (upsetShock) {
    const only = Math.round(pct(1 - impact.favoritePickPct));
    drafts.push({
      type: "UPSET_SHOCK",
      title: "🧨 Massive Upset",
      message: `A ${game.seedWinner}-seed just took down a ${game.seedLoser}-seed. Only ~${only}% picked it correctly.`,
      impactPct: pct(impact.favoritePickPct),
      gameId: game.gameId,
    });
  }

  const massBust =
    impact.favoritePickPct >= 0.3 &&
    ((impact.finalFourPickElimPct ?? 0) >= 0.15 || (impact.champPickElimPct ?? 0) >= 0.15);

  if (massBust) {
    const ff = Math.round(pct(impact.finalFourPickElimPct ?? 0));
    const ch = Math.round(pct(impact.champPickElimPct ?? 0));
    drafts.push({
      type: "MASS_BUST",
      title: "🔥 Brackets Busted",
      message: `That result just eliminated key picks across brackets (Final Four hit: ${ff}%, Champion hit: ${ch}%).`,
      impactPct: Math.max(ff, ch),
      gameId: game.gameId,
    });
  }

  const champDeathBlow = (impact.champPickElimPct ?? 0) >= 0.25 && impact.favoritePickPct >= 0.25;
  if (champDeathBlow) {
    drafts.push({
      type: "CHAMPIONSHIP_DEATH_BLOW",
      title: "💀 Champion Pick Down",
      message: `A popular championship pick was eliminated. A big chunk of brackets just took a hit.`,
      impactPct: pct(impact.champPickElimPct ?? 0),
      gameId: game.gameId,
    });
  }

  const perfectAlert = (impact.perfectRemainingPct ?? 1) <= 0.05;
  if (perfectAlert) {
    drafts.push({
      type: "PERFECT_BRACKET_ALERT",
      title: "👀 Perfect Brackets Fading",
      message: `Only ~${Math.round(pct(impact.perfectRemainingPct ?? 0))}% of brackets remain perfect.`,
      impactPct: pct(1 - (impact.perfectRemainingPct ?? 0)),
      gameId: game.gameId,
    });
  }

  const quake = (impact.top10RankChanges ?? 0) >= 3;
  if (quake) {
    drafts.push({
      type: "LEADERBOARD_EARTHQUAKE",
      title: "📈 Leaderboard Earthquake",
      message: `Big movement at the top — ${impact.top10RankChanges} positions changed in the Top 10.`,
      impactPct: null,
      gameId: game.gameId,
    });
  }

  const minImpact = impact.scope === "global" ? spam.globalMinImpactPct : spam.leagueMinImpactPct;
  const filtered = drafts.filter((d) => {
    if (typeof d.impactPct !== "number") return true;
    return d.impactPct / 100 >= minImpact;
  });

  return filtered.slice(0, spam.maxPostsPerGame);
}
