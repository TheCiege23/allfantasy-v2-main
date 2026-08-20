import type {
  Asset,
  TeamContext,
  TradeEngineRequest,
  TradeEngineResponse,
  TradePlayerAsset,
} from "./trade-types";
import { ENGINE_FLAGS } from "./flags";
import { computeLiquidity } from "./liquidity";
import { computeAcceptanceProbability } from "./acceptance";
import { enrichDevy, devyValueMultiplier } from "./devy";
import { computeChampionshipDelta, type TeamProjection } from "@/lib/monte-carlo";
import {
  normalizeTradeScoring,
  tradeScoringLabel,
  computeScoringAdjustments,
  type ScoringAdjustment,
} from "./scoring";
import { normalizeLeagueContext } from "./normalize";

import { priceAssets } from "@/lib/hybrid-valuation";
import {
  getPlayerAnalyticsBatch,
  computeAthleticGrade,
  computeCollegeProductionGrade,
} from "@/lib/player-analytics";
import { runEnhancedPipeline, type EnhancedTradeAnalysis } from "./enhanced-trade-pipeline";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function normName(s: string) {
  return String(s || "").trim().toLowerCase();
}

function uniq(arr: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of arr) {
    const k = normName(a);
    if (!k) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(String(a).trim());
  }
  return out;
}

function devWarn(message: string, error?: unknown) {
  if (process.env.NODE_ENV !== "production") {
    console.warn(message, error);
  }
}

type RosterCfg = {
  startingQB: number;
  startingRB: number;
  startingWR: number;
  startingTE: number;
  startingFlex: number;
  superflex: boolean;
};

type TradePlayerAnalyticsResult = Record<
  string,
  {
    comparablePlayers: string[];
    athleticGrade: { grade: string; score: number; label: string } | null;
    collegeGrade: { grade: string; score: number; label: string } | null;
    combine: {
      fortyYardDash: number | null;
      speedScore: number | null;
      athleticismScore: number | null;
    } | null;
    breakoutAge: number | null;
    weeklyVolatility: number | null;
  }
>;

function computeBaseStdDev(req: TradeEngineRequest): number {
  let stdDev = 22;

  const scoring = req.leagueContext?.scoring;
  if (!scoring) return stdDev;

  if ((scoring.ppr ?? 0) >= 1.0) stdDev += 2;
  if (scoring.qbFormat === "superflex") stdDev += 3;
  if (scoring.tep?.enabled && (scoring.tep.premiumPprBonus ?? 0) > 0) stdDev += 1;
  if ((scoring.ppCarry ?? 0) > 0) stdDev += 1;

  return clamp(stdDev, 15, 35);
}

function buildLeagueProjections(args: {
  numTeams: number;
  teamAImpactPre: number;
  teamBImpactPre: number;
  teamAImpactPost: number;
  teamBImpactPost: number;
  teamAVol: number;
  teamBVol: number;
  req: TradeEngineRequest;
}): {
  teamA: { oddsBefore: number; oddsAfter: number; delta: number };
  teamB: { oddsBefore: number; oddsAfter: number; delta: number };
} {
  const {
    numTeams,
    teamAImpactPre,
    teamBImpactPre,
    teamAImpactPost,
    teamBImpactPost,
    teamAVol,
    teamBVol,
    req,
  } = args;

  const allKnown = [teamAImpactPre, teamBImpactPre].filter((v: number) => v > 0);
  const avgImpact =
    allKnown.length > 0
      ? allKnown.reduce((a: number, b: number) => a + b, 0) / allKnown.length
      : 15000;

  const impactToMean = (imp: number) => {
    const base = 100;
    const diff = (imp - avgImpact) / Math.max(avgImpact, 1);
    return base + diff * 15;
  };

  const baseStdDev = computeBaseStdDev(req);

  const teams: TeamProjection[] = [];
  for (let i = 0; i < numTeams; i++) {
    const spread = (i - Math.floor(numTeams / 2)) * 1.5;
    teams.push({
      teamId: `team_${i}`,
      mean: 100 + spread,
      stdDev: baseStdDev + ((i % 4) + 1),
    });
  }

  const meanA = impactToMean(teamAImpactPre > 0 ? teamAImpactPre : avgImpact);
  const meanB = impactToMean(teamBImpactPre > 0 ? teamBImpactPre : avgImpact);

  teams[0] = { teamId: "teamA", mean: meanA, stdDev: baseStdDev + teamAVol * 8 };
  if (numTeams > 1) {
    teams[1] = { teamId: "teamB", mean: meanB, stdDev: baseStdDev + teamBVol * 8 };
  }

  const meanDeltaA =
    impactToMean(teamAImpactPost > 0 ? teamAImpactPost : teamAImpactPre) - meanA;
  const meanDeltaB =
    impactToMean(teamBImpactPost > 0 ? teamBImpactPost : teamBImpactPre) - meanB;

  const champA = computeChampionshipDelta(teams, 0, meanDeltaA, 0, 1000);
  const champB =
    numTeams > 1
      ? computeChampionshipDelta(teams, 1, meanDeltaB, 0, 1000)
      : { oddsBefore: 0, oddsAfter: 0, delta: 0 };

  return {
    teamA: champA,
    teamB: champB,
  };
}

function scoreLeagueAdjustments(req: TradeEngineRequest) {
  const ns = normalizeTradeScoring(req.leagueContext);
  const drivers: string[] = [];
  let delta = 0;

  if (ns.qbFormat === "superflex") {
    delta += 6;
    drivers.push("Superflex scarcity boosts QB value");
  }
  const tepBonus = ns.tep.enabled ? ns.tep.premiumPprBonus || 0.5 : 0;
  if (tepBonus > 0) {
    delta += Math.round(tepBonus * 10);
    drivers.push(`TE premium enabled (+${tepBonus} PPR bonus)`);
  }
  if (ns.ppCarry > 0) {
    delta += Math.round(ns.ppCarry * 20);
    drivers.push(`Points-per-carry enabled (+${ns.ppCarry}) boosts RB profiles`);
  }
  if (ns.ppr >= 1) {
    delta += 2;
    drivers.push(`PPR scoring (ppr=${ns.ppr}) increases WR/TE stability`);
  }

  return { delta: clamp(delta, -15, 15), drivers, scoringLabel: tradeScoringLabel(ns) };
}

function inferTeamDirection(team: TeamContext): TeamContext {
  const ages: number[] = [];
  let devyCount = 0;
  let nflCount = 0;

  for (const p of team.roster) {
    if (p.league === "NCAA" && p.devyEligible && !p.graduatedToNFL) devyCount++;
    if (p.league === "NFL") nflCount++;
    if (typeof p.age === "number") ages.push(p.age);
  }

  const avgAge = ages.length ? ages.reduce((a: number, b: number) => a + b, 0) / ages.length : 25;
  const directionConfidence =
    nflCount >= 12 ? ("MODERATE" as const) : ("LEARNING" as const);

  let direction: TeamContext["direction"] = "MIDDLE";

  if (devyCount >= 6) {
    direction = "REBUILD";
  } else if (avgAge <= 24 && devyCount >= 3) {
    direction = "REBUILD";
  } else if (avgAge >= 28 && devyCount <= 1) {
    direction = "FRAGILE_CONTEND";
  } else if (avgAge >= 27 && devyCount <= 1) {
    direction = "CONTEND";
  }

  return { ...team, direction, directionConfidence };
}

function computeRisk(req: TradeEngineRequest, assetsA: Asset[], assetsB: Asset[]) {
  const ctx = req.nflContext?.players || {};
  const touchedIds = new Set<string>();
  for (const a of [...assetsA, ...assetsB]) {
    if (a.type === "player") touchedIds.add(String(a.player.id));
  }

  let injury = 25;
  let roleStability = 70;
  let volatility = 35;
  const notes: string[] = [];

  for (const id of touchedIds) {
    const s = ctx[id];
    if (!s) continue;
    if (s.injuryStatus && s.injuryStatus !== "healthy") {
      injury += 10;
      volatility += 8;
      notes.push(`${id}: injuryStatus=${s.injuryStatus}`);
      if ((s.expectedReturnWeeks ?? 0) > 0) {
        notes.push(`${id}: expectedReturnWeeks=${s.expectedReturnWeeks}`);
      }
    }
    if (s.role && (s.role.includes("committee") || s.role.includes("backup"))) {
      roleStability -= 10;
      volatility += 6;
      notes.push(`${id}: role=${s.role}`);
    }
    if (s.depthChartChange) {
      roleStability -= 6;
      volatility += 5;
      notes.push(`${id}: depth chart change flag`);
    }
    if (s.coachingChange) {
      volatility += 4;
      notes.push(`${id}: coaching change flag`);
    }
  }

  return {
    injury: clamp(injury, 0, 100),
    roleStability: clamp(roleStability, 0, 100),
    volatility: clamp(volatility, 0, 100),
    notes: notes.slice(0, 8),
  };
}

function computeFairnessScore(vA: number, vB: number): {
  fairnessDeltaPct: number;
  fairnessScore: number;
} {
  const total = vA + vB;

  if (total === 0) {
    console.warn("[trade-engine] Both sides have $0 value — returning neutral fairness");
    return { fairnessDeltaPct: 0, fairnessScore: 50 };
  }

  const delta = vA - vB;
  const fairnessDeltaPct = (delta / total) * 100;
  const fairnessScore = clamp(Math.round(50 + fairnessDeltaPct * 1.5), 0, 100);

  return { fairnessDeltaPct, fairnessScore };
}

export function explainFairnessScore(
  fairnessScore: number,
  vA: number,
  vB: number,
  leagueAdjDelta: number,
  starterDeltaPts: number
): string[] {
  const explanations: string[] = [];

  const delta = vA - vB;
  if (Math.abs(delta) < 200) {
    explanations.push("Trade values are roughly even in raw market value");
  } else if (delta > 0) {
    explanations.push(`You are receiving ~${Math.abs(Math.round(delta))} more in market value`);
  } else {
    explanations.push(`You are giving up ~${Math.abs(Math.round(delta))} more in market value`);
  }

  if (leagueAdjDelta > 3) {
    explanations.push("Your league scoring format favors the assets you are receiving");
  } else if (leagueAdjDelta < -3) {
    explanations.push("Your league scoring format favors the assets you are giving up");
  }

  if (starterDeltaPts > 3) {
    explanations.push("This trade improves your starting lineup immediately");
  } else if (starterDeltaPts < -3) {
    explanations.push("This trade weakens your starting lineup in the short term");
  }

  return explanations;
}

export function computeTradeMomentum(
  fairnessScore: number,
  acceptanceFinal: number,
  starterDeltaPts: number,
  needsFitScore: number
): { direction: "positive" | "negative" | "neutral"; score: number } {
  const signals = [
    fairnessScore >= 50 ? 1 : -1,
    acceptanceFinal >= 0.5 ? 1 : -1,
    starterDeltaPts > 0 ? 1 : starterDeltaPts < 0 ? -1 : 0,
    needsFitScore >= 50 ? 1 : -1,
  ];

  const score = signals.reduce((a: number, b: number) => a + b, 0);
  const direction = score > 1 ? "positive" : score < -1 ? "negative" : "neutral";

  return { direction, score };
}

function computeVerdict(
  fairnessScore: number,
  acceptanceFinal: number
): { verdict: "accept" | "reject" | "counter"; confidence: "high" | "medium" | "low" } {
  if (fairnessScore >= 58 && acceptanceFinal >= 0.52) {
    return { verdict: "accept", confidence: "high" };
  }

  if (fairnessScore >= 54 && acceptanceFinal >= 0.48) {
    return { verdict: "accept", confidence: "medium" };
  }

  if (fairnessScore <= 40) {
    return { verdict: "reject", confidence: "high" };
  }

  if (fairnessScore <= 44 && acceptanceFinal < 0.4) {
    return { verdict: "reject", confidence: "medium" };
  }

  const counterConfidence = fairnessScore >= 50 ? "medium" : "low";
  return { verdict: "counter", confidence: counterConfidence };
}

function sortHotPositions(ldiByPos: Record<string, number> | undefined) {
  if (!ldiByPos) return [];
  return Object.entries(ldiByPos)
    .map(([pos, v]: [string, number]) => ({ pos: String(pos).toUpperCase(), v: Number(v) }))
    .filter((x: { pos: string; v: number }) => Number.isFinite(x.v))
    .sort((a: { pos: string; v: number }, b: { pos: string; v: number }) => b.v - a.v)
    .map((x: { pos: string; v: number }) => x.pos);
}

function benchFromStarters(roster: TradePlayerAsset[], starters: { name: string }[]) {
  const starterNames = new Set(starters.map((s: { name: string }) => normName(s.name)));
  return roster.filter((p: TradePlayerAsset) => !starterNames.has(normName(p.name)));
}

function pickCandidates(args: {
  roster: TradePlayerAsset[];
  impactMap: Record<string, { impact: number; vorp: number; vol: number }>;
  prefer: "high_vol" | "low_vol" | "low_impact" | "high_impact";
  posFilter?: string[];
  limit?: number;
}) {
  const { roster, impactMap, prefer, posFilter, limit = 3 } = args;

  const volOf = (p: TradePlayerAsset) => impactMap[p.name]?.vol ?? 0;
  const impactOf = (p: TradePlayerAsset) => impactMap[p.name]?.impact ?? 0;
  const posOk = (p: TradePlayerAsset) => {
    if (!posFilter || posFilter.length === 0) return true;
    const pos = String(p.pos || "").toUpperCase();
    return posFilter.includes(pos);
  };

  const filtered = roster.filter(posOk);
  if (filtered.length === 0) return [];

  const sorted = filtered.slice().sort((a: TradePlayerAsset, b: TradePlayerAsset) => {
    if (prefer === "high_vol") return volOf(b) - volOf(a);
    if (prefer === "low_vol") return volOf(a) - volOf(b);
    if (prefer === "high_impact") return impactOf(b) - impactOf(a);
    return impactOf(a) - impactOf(b);
  });

  const out: TradePlayerAsset[] = [];
  const seen = new Set<string>();
  for (const p of sorted) {
    const k = normName(p.name);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(p);
    if (out.length >= limit) break;
  }
  return out;
}

function formatCandidateList(players: TradePlayerAsset[]) {
  return players.map((p: TradePlayerAsset) => `${p.name} (${String(p.pos || "").toUpperCase()})`);
}

function buildCountersAdaptiveNamedTop3(args: {
  fairnessScore: number;
  acceptProb: number;
  teamADirection?: TeamContext["direction"];
  teamBDirection?: TeamContext["direction"];
  cfg: RosterCfg;
  ldiByPos?: Record<string, number>;
  preRosterA: TradePlayerAsset[];
  preRosterB: TradePlayerAsset[];
  startersPreA: { starters: { name: string }[] };
  startersPreB: { starters: { name: string }[] };
  impactMapA: Record<string, { impact: number; vorp: number; vol: number }>;
  impactMapB: Record<string, { impact: number; vorp: number; vol: number }>;
}) {
  const {
    fairnessScore,
    acceptProb,
    teamADirection,
    teamBDirection,
    cfg,
    ldiByPos,
    preRosterA,
    preRosterB,
    startersPreA,
    startersPreB,
    impactMapA,
    impactMapB,
  } = args;

  const counters: Array<{
    label: string;
    changes: Array<Record<string, unknown>>;
    acceptProb: number;
    fairnessScore: number;
    whyTheyAccept: string[];
    whyItHelpsYou: string[];
    options?: {
      addCandidates?: Array<{ id: string; name: string; pos?: string; team?: string }>;
      askCandidates?: Array<{ id: string; name: string; pos?: string; team?: string }>;
    };
  }> = [];

  const wantStability = teamADirection === "CONTEND" || teamADirection === "FRAGILE_CONTEND";
  const wantCeiling = teamADirection === "REBUILD";

  const hotPos = sortHotPositions(ldiByPos);
  const hotPosFiltered = hotPos.filter((p: string) => ["QB", "RB", "WR", "TE"].includes(p));
  const topHot = hotPosFiltered[0] || (cfg.superflex ? "QB" : "WR");

  const myBench = benchFromStarters(preRosterA, startersPreA.starters);
  const theirBench = benchFromStarters(preRosterB, startersPreB.starters);

  const myAddOptions = wantStability
    ? pickCandidates({
        roster: myBench,
        impactMap: impactMapA,
        prefer: "high_vol",
        posFilter: [topHot],
        limit: 3,
      }).length
      ? pickCandidates({
          roster: myBench,
          impactMap: impactMapA,
          prefer: "high_vol",
          posFilter: [topHot],
          limit: 3,
        })
      : pickCandidates({
          roster: myBench,
          impactMap: impactMapA,
          prefer: "high_vol",
          limit: 3,
        })
    : wantCeiling
      ? pickCandidates({
          roster: myBench,
          impactMap: impactMapA,
          prefer: "low_impact",
          posFilter: [topHot],
          limit: 3,
        }).length
        ? pickCandidates({
            roster: myBench,
            impactMap: impactMapA,
            prefer: "low_impact",
            posFilter: [topHot],
            limit: 3,
          })
        : pickCandidates({
            roster: myBench,
            impactMap: impactMapA,
            prefer: "low_impact",
            limit: 3,
          })
      : pickCandidates({
          roster: myBench,
          impactMap: impactMapA,
          prefer: "low_impact",
          posFilter: [topHot],
          limit: 3,
        }).length
        ? pickCandidates({
            roster: myBench,
            impactMap: impactMapA,
            prefer: "low_impact",
            posFilter: [topHot],
            limit: 3,
          })
        : pickCandidates({
            roster: myBench,
            impactMap: impactMapA,
            prefer: "low_impact",
            limit: 3,
          });

  const myAskOptions = wantStability
    ? pickCandidates({
        roster: theirBench,
        impactMap: impactMapB,
        prefer: "low_vol",
        posFilter: [topHot],
        limit: 3,
      }).length
      ? pickCandidates({
          roster: theirBench,
          impactMap: impactMapB,
          prefer: "low_vol",
          posFilter: [topHot],
          limit: 3,
        })
      : pickCandidates({
          roster: theirBench,
          impactMap: impactMapB,
          prefer: "low_vol",
          limit: 3,
        })
    : wantCeiling
      ? pickCandidates({
          roster: theirBench,
          impactMap: impactMapB,
          prefer: "high_vol",
          posFilter: [topHot],
          limit: 3,
        }).length
        ? pickCandidates({
            roster: theirBench,
            impactMap: impactMapB,
            prefer: "high_vol",
            posFilter: [topHot],
            limit: 3,
          })
        : pickCandidates({
            roster: theirBench,
            impactMap: impactMapB,
            prefer: "high_vol",
            limit: 3,
          })
      : pickCandidates({
          roster: theirBench,
          impactMap: impactMapB,
          prefer: "high_impact",
          posFilter: [topHot],
          limit: 3,
        }).length
        ? pickCandidates({
            roster: theirBench,
            impactMap: impactMapB,
            prefer: "high_impact",
            posFilter: [topHot],
            limit: 3,
          })
        : pickCandidates({
            roster: theirBench,
            impactMap: impactMapB,
            prefer: "high_impact",
            limit: 3,
          });

  const addList = formatCandidateList(myAddOptions);
  const askList = formatCandidateList(myAskOptions);

  let adjustedAcceptProb = acceptProb;
  let adjustedFairness = fairnessScore;

  if (acceptProb < 0.55) {
    if (addList.length) {
      adjustedAcceptProb = clamp(adjustedAcceptProb + 0.12, 0, 1);
      adjustedFairness = clamp(adjustedFairness - 3, 0, 100);
      counters.push({
        label: wantStability
          ? "Win-Now Accept Boost (Top 3)"
          : wantCeiling
            ? "Rebuild Accept Boost (Top 3)"
            : "Accept Boost (Top 3)",
        changes: [
          { addToB: `Add one of: ${addList.join(" / ")}` },
          ...(ldiByPos
            ? [
                {
                  note: `LDI hot position: ${topHot}. Add-options pulled from your bench to match league demand.`,
                },
              ]
            : []),
        ],
        acceptProb: adjustedAcceptProb,
        fairnessScore: adjustedFairness,
        whyTheyAccept: [
          "Real bench pieces reduce negotiation friction and increase perceived value.",
        ],
        whyItHelpsYou: wantStability
          ? ["You move volatility off your bench without touching core starters."]
          : wantCeiling
            ? ["You keep ceiling assets; pay with surplus/low-impact pieces instead."]
            : ["You increase acceptance without reshaping the core deal."],
        options: {
          addCandidates: myAddOptions.map((p: TradePlayerAsset) => ({
            id: p.id,
            name: p.name,
            pos: p.pos,
            team: p.team,
          })),
        },
      });
    } else {
      adjustedAcceptProb = clamp(adjustedAcceptProb + 0.11, 0, 1);
      adjustedFairness = clamp(adjustedFairness - 2, 0, 100);
      counters.push({
        label: "Accept Boost (Pick-Based)",
        changes: [
          { addToB: "Add a late 2nd (or upgrade 3rd → 2nd) instead of losing a core player." },
          ...(ldiByPos
            ? [
                {
                  note: `LDI suggests ${topHot} is hot — picks substitute when bench options are thin.`,
                },
              ]
            : []),
        ],
        acceptProb: adjustedAcceptProb,
        fairnessScore: adjustedFairness,
        whyTheyAccept: ["Picks feel like guaranteed future value."],
        whyItHelpsYou: ["Keeps your weekly lineup intact while raising acceptance."],
      });
    }
  }

  if (askList.length) {
    adjustedAcceptProb = clamp(adjustedAcceptProb + 0.05, 0, 1);
    adjustedFairness = clamp(adjustedFairness + 1, 0, 100);
    counters.push({
      label: wantStability
        ? "Ask Back Stability (Top 3)"
        : wantCeiling
          ? "Ask Back Ceiling (Top 3)"
          : "Ask Back Value (Top 3)",
      changes: [
        { askFromThem: `Counter by asking for one of: ${askList.join(" / ")}` },
        ...(ldiByPos
          ? [
              {
                note: `Ask-options pulled from their bench in league-demanded position (${topHot}).`,
              },
            ]
          : []),
      ],
      acceptProb: adjustedAcceptProb,
      fairnessScore: adjustedFairness,
      whyTheyAccept: ["Bench concessions are easier than moving starters."],
      whyItHelpsYou: wantStability
        ? ["Adds floor without paying extra picks."]
        : wantCeiling
          ? ["Adds upside insulation to raise long-term EV."]
          : ["Improves deal balance with minimal negotiation pain."],
      options: {
        askCandidates: myAskOptions.map((p: TradePlayerAsset) => ({
          id: p.id,
          name: p.name,
          pos: p.pos,
          team: p.team,
        })),
      },
    });
  }

  const partnerIsRebuild = teamBDirection === "REBUILD";
  adjustedAcceptProb = clamp(adjustedAcceptProb + 0.04, 0, 1);
  adjustedFairness = clamp(adjustedFairness - 1, 0, 100);
  counters.push({
    label: partnerIsRebuild ? "Partner Rebuild Angle" : "Partner Win-Now Angle",
    changes: partnerIsRebuild
      ? [
          {
            addPick:
              "If they hesitate, swap your add-on for a future pick (2nd/3rd) — rebuilders respond better to picks.",
          },
        ]
      : [
          {
            addToB:
              "If they hesitate, swap pick talk for a usable startable depth piece — contenders want points now.",
          },
        ],
    acceptProb: adjustedAcceptProb,
    fairnessScore: adjustedFairness,
    whyTheyAccept: [
      partnerIsRebuild
        ? "Matches rebuild incentives: future value."
        : "Matches contender incentives: points now.",
    ],
    whyItHelpsYou: ["You increase acceptance by speaking their roster language."],
  });

  return counters.slice(0, 3);
}

function toHybridAssetsInput(marketAssets: Asset[]) {
  const players: string[] = [];
  const picks: Array<{
    year: number;
    round: number;
    projected_range?: string;
    pickNumber?: number;
  }> = [];

  for (const a of marketAssets) {
    if (a.type === "player") {
      const nm = (a.player.name || "").trim();
      if (nm) players.push(nm);
    } else if (a.type === "pick") {
      const y = a.pick.year;
      const r = a.pick.round;
      if (Number.isFinite(y) && Number.isFinite(r)) {
        picks.push({
          year: y,
          round: r,
          projected_range: a.pick.projected_range,
          pickNumber: a.pick.pickNumber,
        });
      }
    }
  }

  return { players, picks };
}

function applyScoringNormalization(
  pricedItems: Array<any>,
  scoringAdj: ScoringAdjustment | null
): { items: Array<any>; total: number } {
  if (!scoringAdj) {
    const total = pricedItems.reduce(
      (s: number, it: any) => s + (Number(it.assetValue?.total ?? it.value ?? 0) || 0),
      0
    );
    return { items: pricedItems, total };
  }

  let total = 0;
  const items = pricedItems.map((it: any) => {
    const rawVal = Number(it.assetValue?.total ?? it.value ?? 0) || 0;
    if (it.type !== "player") {
      total += rawVal;
      return it;
    }
    const pos = String(it.position || it.pos || "").toUpperCase();
    const mult = scoringAdj.positionMultiplier[pos] ?? 1.0;
    const adjusted = Math.round(rawVal * mult);
    total += adjusted;
    return {
      ...it,
      value: adjusted,
      assetValue: { ...it.assetValue, total: adjusted, scoringMultiplier: mult },
    };
  });

  return { items, total };
}

function pricedItemsToSources(items: Array<{ name: string; type: "player" | "pick"; source: string }>) {
  const sources: Record<string, string> = {};
  for (const it of items) {
    if (it.type === "player") sources[`player:${it.name}`] = it.source;
    else sources[`pick:${it.name}`] = it.source;
  }
  return sources;
}

function pricedItemsToImpactMap(items: Array<any>) {
  const map: Record<string, { impact: number; vorp: number; vol: number }> = {};
  for (const it of items || []) {
    if (it?.type !== "player") continue;
    const nm = String(it.name || "").trim();
    if (!nm) continue;
    map[nm] = {
      impact: Number(it.assetValue?.impactValue ?? 0) || 0,
      vorp: Number(it.assetValue?.vorpValue ?? 0) || 0,
      vol: Number(it.assetValue?.volatility ?? 0) || 0,
    };
  }
  return map;
}

function splitDevyAssets(assets: Asset[]) {
  const devyPlayers: TradePlayerAsset[] = [];
  const marketAssets: Asset[] = [];

  for (const a of assets) {
    if (a.type === "player") {
      const p = enrichDevy(a.player);
      if (p.league === "NCAA" && p.devyEligible && !p.graduatedToNFL) {
        devyPlayers.push(p);
        continue;
      }
      marketAssets.push({ type: "player", player: p });
      continue;
    }
    marketAssets.push(a);
  }

  return { devyPlayers, marketAssets };
}

function devySideValue(devyPlayers: TradePlayerAsset[], teamDirection?: string) {
  const mult = devyValueMultiplier(teamDirection);
  let total = 0;
  let unpriced = 0;
  for (const p of devyPlayers) {
    // A devy player with nothing behind him used to contribute 50 * mult to a
    // real trade valuation. Counting him is a claim we cannot support; he is
    // excluded and reported, so the caller can say the side is under-counted
    // instead of silently pricing a stranger as average.
    if (typeof p.draftProjectionScore !== "number") {
      unpriced += 1;
      continue;
    }
    total += p.draftProjectionScore * mult;
  }
  return { total, mult, unpriced };
}

function faabValue(assets: Asset[], leagueFaabBudget: number = 100) {
  const budget = leagueFaabBudget > 0 ? leagueFaabBudget : 100;
  let total = 0;
  for (const a of assets) {
    if (a.type === "faab" && a.faab.amount > 0) {
      const pctOfBudget = clamp(a.faab.amount / budget, 0, 1);
      total += Math.round(pctOfBudget * 25);
    }
  }
  return total;
}

function rosterCfgFromLeague(req: TradeEngineRequest): RosterCfg {
  const isSF = req.leagueContext?.scoring?.qbFormat === "superflex";
  const base: RosterCfg = {
    startingQB: 1,
    startingRB: 2,
    startingWR: 2,
    startingTE: 1,
    startingFlex: isSF ? 3 : 2,
    superflex: isSF,
  };
  const override = (req.leagueContext?.roster as any) || {};
  return {
    ...base,
    startingQB: Number.isFinite(override.startingQB) ? override.startingQB : base.startingQB,
    startingRB: Number.isFinite(override.startingRB) ? override.startingRB : base.startingRB,
    startingWR: Number.isFinite(override.startingWR) ? override.startingWR : base.startingWR,
    startingTE: Number.isFinite(override.startingTE) ? override.startingTE : base.startingTE,
    startingFlex: Number.isFinite(override.startingFlex)
      ? override.startingFlex
      : base.startingFlex,
    superflex: typeof override.superflex === "boolean" ? override.superflex : base.superflex,
  };
}

function volatilityPreference(direction?: TeamContext["direction"]) {
  switch (direction) {
    case "FRAGILE_CONTEND":
      return { volWeight: 0.3, label: "stability_strong" };
    case "CONTEND":
      return { volWeight: 0.18, label: "stability" };
    case "REBUILD":
      return { volWeight: -0.1, label: "ceiling" };
    default:
      return { volWeight: 0.0, label: "neutral" };
  }
}

function buildPostRosterPlayers(args: {
  preRoster: TradePlayerAsset[];
  receivedAssets: Asset[];
  sentAssets: Asset[];
}) {
  const { preRoster, receivedAssets, sentAssets } = args;

  const sentNames = new Set(
    sentAssets
      .filter((a: Asset) => a.type === "player")
      .map((a: Asset) => (a.type === "player" ? normName(a.player.name) : ""))
      .filter(Boolean)
  );

  const kept = preRoster.filter((p: TradePlayerAsset) => !sentNames.has(normName(p.name)));

  const receivedPlayers: TradePlayerAsset[] = receivedAssets
    .filter((a: Asset) => a.type === "player")
    .map((a: Asset) => enrichDevy(a.type === "player" ? a.player : ({} as TradePlayerAsset)));

  const merged = [...kept, ...receivedPlayers];
  const seen = new Set<string>();
  const out: TradePlayerAsset[] = [];
  for (const p of merged) {
    const k = normName(p.name);
    if (!k) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

function startersFromRoster(args: {
  roster: TradePlayerAsset[];
  cfg: RosterCfg;
  impactMap: Record<string, { impact: number; vorp: number; vol: number }>;
  direction?: TeamContext["direction"];
}) {
  const { roster, cfg, impactMap, direction } = args;
  const pref = volatilityPreference(direction);

  const impactOf = (p: TradePlayerAsset) => impactMap[p.name]?.impact ?? 0;
  const volOf = (p: TradePlayerAsset) => impactMap[p.name]?.vol ?? 0;
  const scoreOf = (p: TradePlayerAsset) => Math.max(0, impactOf(p) - pref.volWeight * volOf(p));

  const byPos = (pos: string) =>
    roster
      .filter((p: TradePlayerAsset) => String(p.pos || "").toUpperCase() === pos)
      .slice()
      .sort((a: TradePlayerAsset, b: TradePlayerAsset) => scoreOf(b) - scoreOf(a));

  const starters: {
    slot: string;
    name: string;
    pos: string;
    impact: number;
    vol: number;
    score: number;
  }[] = [];
  const used = new Set<string>();

  const takeN = (arr: TradePlayerAsset[], n: number, slot: string) => {
    for (const p of arr) {
      if (n <= 0) break;
      const k = normName(p.name);
      if (!k || used.has(k)) continue;
      const imp = impactOf(p);
      const vol = volOf(p);
      const sc = scoreOf(p);
      starters.push({ slot, name: p.name, pos: String(p.pos || ""), impact: imp, vol, score: sc });
      used.add(k);
      n--;
      if (n <= 0) break;
    }
  };

  takeN(byPos("QB"), cfg.startingQB, "QB");
  takeN(byPos("RB"), cfg.startingRB, "RB");
  takeN(byPos("WR"), cfg.startingWR, "WR");
  takeN(byPos("TE"), cfg.startingTE, "TE");

  const flexEligible = roster
    .filter((p: TradePlayerAsset) => {
      const pos = String(p.pos || "").toUpperCase();
      if (cfg.superflex) return pos === "RB" || pos === "WR" || pos === "TE" || pos === "QB";
      return pos === "RB" || pos === "WR" || pos === "TE";
    })
    .slice()
    .sort((a: TradePlayerAsset, b: TradePlayerAsset) => scoreOf(b) - scoreOf(a));

  takeN(flexEligible, cfg.startingFlex, cfg.superflex ? "FLEX/SF" : "FLEX");

  const totalImpact = starters.reduce((acc: number, s) => acc + (s.impact || 0), 0);
  const avgVol =
    starters.length > 0
      ? starters.reduce((acc: number, s) => acc + (s.vol || 0), 0) / starters.length
      : 0;

  return { starters, totalImpact, prefLabel: pref.label, avgVol };
}

function computeNeedsFitFromRosterConfig(args: {
  cfg: RosterCfg;
  partnerRoster: TradePlayerAsset[];
  assetsPartnerReceives: Asset[];
}) {
  const { cfg, partnerRoster, assetsPartnerReceives } = args;

  const counts: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
  for (const p of partnerRoster || []) {
    const pos = String(p.pos || "").toUpperCase();
    if (pos in counts) counts[pos]++;
  }

  const need: Record<string, number> = {
    QB: Math.max(0, cfg.startingQB - counts.QB),
    RB: Math.max(0, cfg.startingRB - counts.RB),
    WR: Math.max(0, cfg.startingWR - counts.WR),
    TE: Math.max(0, cfg.startingTE - counts.TE),
  };
  if (cfg.superflex) need.QB += 0.5;

  const totalNeeds = Object.values(need).reduce((a: number, b: number) => a + b, 0);
  if (totalNeeds === 0) return 50;

  let score = 0;
  let suppliedCount = 0;
  for (const a of assetsPartnerReceives) {
    if (a.type !== "player") continue;
    const pos = String(a.player.pos || "").toUpperCase();
    if (!(pos in need)) continue;
    suppliedCount++;
    if (need[pos] > 0) {
      score += 30;
    } else {
      score += 10;
    }
  }

  if (suppliedCount === 0) return clamp(50 - 8, 0, 100);

  return clamp(Math.round((score / 100) * 100), 0, 100);
}

export async function runTradeAnalysis(req: TradeEngineRequest): Promise<TradeEngineResponse> {
  const leagueId = req.leagueId || req.league_id || req.leagueContext?.leagueId || "";
  const leagueContextUsed = !!req.leagueContext;
  const nflContextUsed = !!req.nflContext;

  const teamA: TeamContext = inferTeamDirection({
    rosterId: "A",
    managerName: req.sleeperUserA?.username || req.sleeper_username_a || "Team A",
    roster: req.rosterA ?? [],
  });

  const teamB: TeamContext = inferTeamDirection({
    rosterId: "B",
    managerName: req.sleeperUserB?.username || req.sleeper_username_b || "Team B",
    roster: req.rosterB ?? [],
  });

  const splitA = splitDevyAssets(req.assetsA);
  const splitB = splitDevyAssets(req.assetsB);

  const hvAssetsA = toHybridAssetsInput(splitA.marketAssets);
  const hvAssetsB = toHybridAssetsInput(splitB.marketAssets);

  const asOfDate = req.leagueContext?.season ? `${req.leagueContext.season}-12-31` : todayISO();
  const isSuperFlex = req.leagueContext?.scoring?.qbFormat === "superflex";
  const numTeams = req.numTeams ?? req.leagueContext?.numTeams ?? 12;

  const hvCtx: any = {
    asOfDate,
    isSuperFlex,
    numTeams,
    rosterConfig: req.leagueContext?.roster || undefined,
  };

  const rawPricedA = await priceAssets(hvAssetsA as any, hvCtx);
  const rawPricedB = await priceAssets(hvAssetsB as any, hvCtx);

  let scoringAdj: ScoringAdjustment | null = null;
  if (req.leagueContext?.scoring) {
    try {
      const s = req.leagueContext.scoring;
      const r = req.leagueContext.roster;
      const engineLeague = normalizeLeagueContext({
        scoring_settings: {
          rec: s.ppr ?? 1,
          bonus_rec_te: s.tep?.premiumPprBonus ?? 0,
          pass_td: s.sixPtPassTd ? 6 : 4,
          pts_carry: s.ppCarry ?? 0,
        },
        roster_positions: r?.slots
          ? Object.entries(r.slots).flatMap(([pos, count]: [string, number]) =>
              Array(count as number).fill(pos)
            )
          : [],
        numTeams,
        settings: { num_teams: numTeams },
      });
      scoringAdj = computeScoringAdjustments(engineLeague);
    } catch (error) {
      devWarn("[trade-engine] Failed to compute scoring adjustments", error);
    }
  }

  const scoredA = applyScoringNormalization(rawPricedA.items as any, scoringAdj);
  const scoredB = applyScoringNormalization(rawPricedB.items as any, scoringAdj);

  const applyNewsToItems = (
    items: Array<any>,
    newsAdj: Record<string, { multiplier: number; sentiment: string; reason: string }>
  ) => {
    let total = 0;
    const adjusted = items.map((it: any) => {
      const rawVal = Number(it.assetValue?.total ?? it.value ?? 0) || 0;
      if (it.type !== "player") {
        total += rawVal;
        return it;
      }
      const nm = String(it.name || "").trim().toLowerCase();
      const adj = newsAdj[nm];
      if (!adj || adj.multiplier === 1.0) {
        total += rawVal;
        return it;
      }
      const newVal = Math.round(rawVal * adj.multiplier);
      total += newVal;
      return {
        ...it,
        value: newVal,
        assetValue: {
          ...it.assetValue,
          total: newVal,
          newsMultiplier: adj.multiplier,
          newsReason: adj.reason,
        },
      };
    });
    return { items: adjusted, total };
  };

  let pricedA = { ...rawPricedA, ...scoredA };
  let pricedB = { ...rawPricedB, ...scoredB };

  if (req.newsAdjustments && Object.keys(req.newsAdjustments).length > 0) {
    const newsA = applyNewsToItems(pricedA.items as any, req.newsAdjustments);
    const newsB = applyNewsToItems(pricedB.items as any, req.newsAdjustments);
    pricedA = { ...pricedA, items: newsA.items, total: newsA.total };
    pricedB = { ...pricedB, items: newsB.items, total: newsB.total };
  }

  const pricingSources: Record<string, string> = {
    ...pricedItemsToSources(pricedA.items as any),
    ...pricedItemsToSources(pricedB.items as any),
  };

  const devyA = devySideValue(splitA.devyPlayers, teamA.direction);
  const devyB = devySideValue(splitB.devyPlayers, teamB.direction);

  const leagueFaabBudget = req.leagueContext?.trade?.faabBudget ?? 100;
  const faabA = faabValue(req.assetsA, leagueFaabBudget);
  const faabB = faabValue(req.assetsB, leagueFaabBudget);

  const vA = pricedA.total + devyA.total + faabA;
  const vB = pricedB.total + devyB.total + faabB;

  const { fairnessDeltaPct, fairnessScore } = computeFairnessScore(vA, vB);
  const delta = vA - vB;

  const fairnessConfidence =
    leagueContextUsed && (req.marketContext?.partnerTendencies || req.marketContext?.ldiByPos)
      ? ("MODERATE" as const)
      : ("LEARNING" as const);

  const fairnessDrivers = [
    {
      key: "hybrid_total",
      delta: clamp(delta / 25, -20, 20),
      note: `Hybrid total (market assets) + Devy + FAAB. YouGet(A)=${Math.round(vA)} YouGive(B)=${Math.round(vB)}`,
    },
    ...(splitA.devyPlayers.length || splitB.devyPlayers.length
      ? [
          {
            key: "devy_projection_layer",
            delta: 2,
            // Name the players we could not price. A side missing value is very
            // different from a side that is genuinely worth less, and the reader
            // cannot tell them apart unless we say so.
            note:
              `Devy priced via DraftProjectionScore (multA=${devyA.mult.toFixed(2)} multB=${devyB.mult.toFixed(2)})` +
              (devyA.unpriced || devyB.unpriced
                ? ` — ${devyA.unpriced + devyB.unpriced} devy player(s) had no projection and were excluded, so devy value is under-counted`
                : ""),
          },
        ]
      : []),
    ...(faabA || faabB
      ? [
          {
            key: "faab",
            delta: 1,
            note: "FAAB valued via conservative curve (amount/10, capped at 25).",
          },
        ]
      : []),
  ];

  const leagueAdj = scoreLeagueAdjustments(req);
  const cfg = rosterCfgFromLeague(req);

  const needsFitScore = computeNeedsFitFromRosterConfig({
    cfg,
    partnerRoster: req.rosterB ?? [],
    assetsPartnerReceives: req.assetsB,
  });

  const risk = computeRisk(req, req.assetsA, req.assetsB);
  const volatilityDelta = risk.volatility;

  const preRosterA = req.rosterA ?? [];
  const preRosterB = req.rosterB ?? [];

  const postRosterA = buildPostRosterPlayers({
    preRoster: preRosterA,
    receivedAssets: req.assetsA,
    sentAssets: req.assetsB,
  });

  const postRosterB = buildPostRosterPlayers({
    preRoster: preRosterB,
    receivedAssets: req.assetsB,
    sentAssets: req.assetsA,
  });

  const rosterNamesA = uniq([
    ...preRosterA.map((p: TradePlayerAsset) => p.name),
    ...postRosterA.map((p: TradePlayerAsset) => p.name),
  ]);
  const rosterNamesB = uniq([
    ...preRosterB.map((p: TradePlayerAsset) => p.name),
    ...postRosterB.map((p: TradePlayerAsset) => p.name),
  ]);

  const pricedRosterA = await priceAssets({ players: rosterNamesA, picks: [] } as any, hvCtx);
  const pricedRosterB = await priceAssets({ players: rosterNamesB, picks: [] } as any, hvCtx);

  const impactMapA = pricedItemsToImpactMap(pricedRosterA.items as any);
  const impactMapB = pricedItemsToImpactMap(pricedRosterB.items as any);

  const startersPreA = startersFromRoster({
    roster: preRosterA,
    cfg,
    impactMap: impactMapA,
    direction: teamA.direction,
  });
  const startersPostA = startersFromRoster({
    roster: postRosterA,
    cfg,
    impactMap: impactMapA,
    direction: teamA.direction,
  });

  const startersPreB = startersFromRoster({
    roster: preRosterB,
    cfg,
    impactMap: impactMapB,
    direction: teamB.direction,
  });
  const startersPostB = startersFromRoster({
    roster: postRosterB,
    cfg,
    impactMap: impactMapB,
    direction: teamB.direction,
  });

  const netStarterImpactA = startersPostA.totalImpact - startersPreA.totalImpact;
  const netStarterImpactB = startersPostB.totalImpact - startersPreB.totalImpact;

  const starterDeltaPtsA = clamp(Math.round(netStarterImpactA / 75), -12, 12);
  const starterDeltaPtsB = clamp(Math.round(netStarterImpactB / 75), -12, 12);

  const offeredToPartner: TradePlayerAsset[] = req.assetsB
    .filter((a: Asset) => a.type === "player")
    .map((a: Asset) => (a.type === "player" ? a.player : ({} as TradePlayerAsset)));

  const partnerTendencies = req.marketContext?.partnerTendencies;
  const firstPartnerKey = partnerTendencies ? Object.keys(partnerTendencies)[0] : undefined;
  const partnerProfile =
    partnerTendencies && firstPartnerKey
      ? partnerTendencies[firstPartnerKey]
      : undefined;

  const acceptance = computeAcceptanceProbability({
    fairnessScore,
    needsFitScore,
    volatilityDelta,
    tradeCount: partnerProfile?.sampleSize ?? 0,
    ldi: req.marketContext?.ldiByPos,
    offeredPlayers: offeredToPartner.map((p: TradePlayerAsset) => ({
      position: p.pos ?? "",
      isDevy: p.devyEligible ?? false,
      draftProjectionScore: p.draftProjectionScore,
      breakoutAge: p.breakoutAge,
      injurySeverityScore: p.injurySeverityScore,
    })),
    isSuperFlex,
    managerProfile: partnerProfile
      ? {
          futureFocused: partnerProfile.futureFocused,
          riskAverse: partnerProfile.riskAverse,
          pickHoarder: partnerProfile.pickHoarder,
          studChaser: partnerProfile.studChaser,
          tradeHistory: partnerProfile.tradeHistory,
        }
      : undefined,
  });

  const { verdict, confidence: verdictConfidence } = computeVerdict(fairnessScore, acceptance.final);
  const momentum = computeTradeMomentum(
    fairnessScore,
    acceptance.final,
    starterDeltaPtsA,
    needsFitScore
  );

  const counters = buildCountersAdaptiveNamedTop3({
    fairnessScore,
    acceptProb: acceptance.final,
    teamADirection: teamA.direction,
    teamBDirection: teamB.direction,
    cfg,
    ldiByPos: req.marketContext?.ldiByPos as any,
    preRosterA,
    preRosterB,
    startersPreA: { starters: startersPreA.starters },
    startersPreB: { starters: startersPreB.starters },
    impactMapA,
    impactMapB,
  });

  const liquidity = ENGINE_FLAGS.enableLiquidityModel
    ? computeLiquidity(req.marketContext?.liquidity)
    : null;

  let championshipEquity: TradeEngineResponse["championshipEquity"] = undefined;
  try {
    const rawChamp = buildLeagueProjections({
      numTeams,
      teamAImpactPre: startersPreA.totalImpact,
      teamBImpactPre: startersPreB.totalImpact,
      teamAImpactPost: startersPostA.totalImpact,
      teamBImpactPost: startersPostB.totalImpact,
      teamAVol: startersPostA.avgVol,
      teamBVol: startersPostB.avgVol,
      req,
    });

    const champReasons: string[] = [];
    if (Math.abs(netStarterImpactA) > 500) {
      champReasons.push(`Starter impact ${netStarterImpactA > 0 ? "+" : ""}${Math.round(netStarterImpactA)} pts`);
    }
    if (Math.abs(startersPostA.avgVol - startersPreA.avgVol) > 3) {
      const volChange = startersPostA.avgVol - startersPreA.avgVol;
      champReasons.push(
        `Volatility ${volChange > 0 ? "+" : ""}${volChange.toFixed(1)}% ${volChange > 0 ? "(riskier)" : "(more stable)"}`
      );
    }
    if (risk.injury > 40) {
      champReasons.push(`Injury risk factor: ${risk.injury}/100`);
    }
    if (teamA.direction === "CONTEND" && netStarterImpactA > 0) {
      champReasons.push("Contender gets immediate lineup upgrade");
    }
    if (teamA.direction === "REBUILD" && netStarterImpactA < 0) {
      champReasons.push("Rebuild direction — trading production for future value");
    }
    if (champReasons.length === 0) {
      champReasons.push("Marginal lineup shift — title odds nearly unchanged");
    }

    const champConfidence: "HIGH" | "MODERATE" | "LEARNING" =
      leagueContextUsed && numTeams >= 10 ? "HIGH" : numTeams >= 8 ? "MODERATE" : "LEARNING";

    championshipEquity = {
      ...rawChamp,
      confidence: champConfidence,
      topReasons: champReasons.slice(0, 2),
    };
  } catch (error) {
    devWarn("[trade-engine] Failed to compute championship equity", error);
  }

  return {
    verdict,
    verdictConfidence,
    momentum,
    fairness: {
      score: fairnessScore,
      delta: Math.round(delta),
      confidence: fairnessConfidence,
      drivers: fairnessDrivers
        .slice()
        .sort(
          (a: { key: string; delta: number; note: string }, b: { key: string; delta: number; note: string }) =>
            Math.abs(b.delta) - Math.abs(a.delta)
        )
        .slice(0, 6),
      explanations: explainFairnessScore(fairnessScore, vA, vB, leagueAdj.delta, starterDeltaPtsA),
    },
    leagueAdjusted: {
      delta: leagueAdj.delta,
      drivers: leagueAdj.drivers,
    },
    lineupImpact: {
      starterDeltaPts: starterDeltaPtsA,
      note: `A(${teamA.direction}:${startersPreA.prefLabel}) impact ${Math.round(startersPreA.totalImpact)}→${Math.round(startersPostA.totalImpact)} net ${Math.round(netStarterImpactA)} | avgVol ${startersPostA.avgVol.toFixed(1)}. B(${teamB.direction}:${startersPreB.prefLabel}) impact ${Math.round(startersPreB.totalImpact)}→${Math.round(startersPostB.totalImpact)} net ${Math.round(netStarterImpactB)} | avgVol ${startersPostB.avgVol.toFixed(1)}.`,
    },
    risk,
    acceptanceProbability: acceptance,
    counters,
    championshipEquity,
    evidence: {
      leagueContextUsed,
      nflContextUsed,
      partnerModelUsed: !!req.marketContext?.partnerTendencies,
      liquidityUsed: !!liquidity,
      devyUsed: splitA.devyPlayers.length + splitB.devyPlayers.length > 0,
      scoringNormalized: scoringAdj !== null,
      pricingSources,
    },
    meta: {
      leagueId,
      scoringLabel: leagueAdj.scoringLabel,
      hv: {
        asOfDate,
        isSuperFlex,
        numTeams,
        statsA: pricedA.stats,
        statsB: pricedB.stats,
        rosterStatsA: pricedRosterA.stats,
        rosterStatsB: pricedRosterB.stats,
      },
      rosterConfig: cfg,
      needsFitScore,
      starterImpact: {
        teamA: {
          direction: teamA.direction,
          preference: startersPreA.prefLabel,
          avgVolPre: Number(startersPreA.avgVol.toFixed(2)),
          avgVolPost: Number(startersPostA.avgVol.toFixed(2)),
          pre: Math.round(startersPreA.totalImpact),
          post: Math.round(startersPostA.totalImpact),
          net: Math.round(netStarterImpactA),
          starterDeltaPts: starterDeltaPtsA,
          startersPre: startersPreA.starters,
          startersPost: startersPostA.starters,
        },
        teamB: {
          direction: teamB.direction,
          preference: startersPreB.prefLabel,
          avgVolPre: Number(startersPreB.avgVol.toFixed(2)),
          avgVolPost: Number(startersPostB.avgVol.toFixed(2)),
          pre: Math.round(startersPreB.totalImpact),
          post: Math.round(startersPostB.totalImpact),
          net: Math.round(netStarterImpactB),
          starterDeltaPts: starterDeltaPtsB,
          startersPre: startersPreB.starters,
          startersPost: startersPostB.starters,
        },
      },
      teamA: { direction: teamA.direction, confidence: teamA.directionConfidence },
      teamB: { direction: teamB.direction, confidence: teamB.directionConfidence },
      liquidity,
      devy: {
        sideA: { count: splitA.devyPlayers.length, mult: devyA.mult, unpriced: devyA.unpriced },
        sideB: { count: splitB.devyPlayers.length, mult: devyB.mult, unpriced: devyB.unpriced },
      },
      fairnessDeltaPct,
    },
    playerAnalytics: await buildPlayerAnalyticsForTrade(
      [...(splitA.marketAssets || []), ...(splitB.marketAssets || [])],
      [...(teamA.roster || []), ...(teamB.roster || [])]
    ),

    // ─── ENHANCED PIPELINE (UTV + multi-factor + risk + team context + log fairness) ───
    enhanced: (() => {
      try {
        return runEnhancedPipeline(
          req,
          (pricedA.items as any[]).map((it: any) => ({
            name: String(it.name ?? ''),
            type: String(it.type ?? 'player'),
            value: Number(it.assetValue?.total ?? it.value ?? 0),
            position: it.position,
            age: it.age,
          })),
          (pricedB.items as any[]).map((it: any) => ({
            name: String(it.name ?? ''),
            type: String(it.type ?? 'player'),
            value: Number(it.assetValue?.total ?? it.value ?? 0),
            position: it.position,
            age: it.age,
          })),
          netStarterImpactA,
          netStarterImpactB,
        );
      } catch {
        return null;
      }
    })(),
  };
}

const ANALYTICS_BATCH_LIMIT = 60;

function buildAnalyticsBatch(allPlayerNames: string[]): string[] {
  if (allPlayerNames.length > ANALYTICS_BATCH_LIMIT) {
    console.warn(
      `[trade-engine] Analytics batch truncated: ${allPlayerNames.length} players → ${ANALYTICS_BATCH_LIMIT}. ` +
        `Players excluded: ${allPlayerNames.slice(ANALYTICS_BATCH_LIMIT).join(", ")}`
    );
  }
  return allPlayerNames.slice(0, ANALYTICS_BATCH_LIMIT);
}

async function buildPlayerAnalyticsForTrade(
  tradeAssets: Asset[],
  rosters: TradePlayerAsset[]
): Promise<TradePlayerAnalyticsResult> {
  try {
    const playerNames = new Set<string>();
    for (const a of tradeAssets) {
      if (a.type === "player" && a.player?.name) playerNames.add(a.player.name);
    }
    for (const p of rosters) {
      if (p.name) playerNames.add(p.name);
    }

    if (playerNames.size === 0) return {};

    const namesArr = buildAnalyticsBatch(Array.from(playerNames));
    const analyticsMap = await getPlayerAnalyticsBatch(namesArr);

    const result: TradePlayerAnalyticsResult = {};
    for (const [name, analytics] of analyticsMap as Iterable<[string, any]>) {
      result[name] = {
        comparablePlayers: (analytics.comparablePlayers as string[]).slice(0, 5),
        athleticGrade:
          analytics.combine.athleticismScore != null
            ? computeAthleticGrade(analytics)
            : null,
        collegeGrade:
          analytics.college.dominatorRating != null || analytics.college.breakoutAge != null
            ? computeCollegeProductionGrade(analytics)
            : null,
        combine: {
          fortyYardDash: analytics.combine.fortyYardDash,
          speedScore: analytics.combine.speedScore,
          athleticismScore: analytics.combine.athleticismScore,
        },
        breakoutAge: analytics.college.breakoutAge,
        weeklyVolatility: analytics.weeklyVolatility,
      };
    }
    return result;
  } catch (error) {
    devWarn("[trade-engine] Failed to build player analytics", error);
    return {};
  }
}