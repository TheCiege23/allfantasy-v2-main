// lib/trade-engine/guardrails.ts
import type { Asset, LeagueIntelligence, TradeCandidate } from "./types";

export type GuardrailReasonCode =
  | "GR_DISABLED"
  | "GR_STRONG_TEAM_GAIN_LIMIT"
  | "GR_WEAK_TEAM_ANTI_REBUILD"
  | "GR_NO_RECEIVE_TOTAL";

export type GuardrailsConfig = {
  enabled?: boolean;
  strongTeamDelta1?: number;
  strongTeamDelta2?: number;
  maxPartnerGainAtDelta1?: number;
  maxPartnerGainAtDelta2?: number;
  protectWeakTeams?: boolean;
  weakTeamTpiThreshold?: number;
  agingVetAge?: number;
  youthAge?: number;
  maxWeakTeamOverpayRatio?: number;
  includeReasonCodes?: boolean;
};

export type GuardrailCandidateDebug = {
  tradeId: string;
  codes: GuardrailReasonCode[];
  details?: Record<string, any>;
};

type GuardrailsResult = {
  filtered: TradeCandidate[];
  removedCount: number;
  notes: string[];
  tpiByRosterId: Record<number, number>;
  removed?: GuardrailCandidateDebug[];
  kept?: GuardrailCandidateDebug[];
  summaryByCode?: Record<GuardrailReasonCode, number>;
};

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function safeNum(v: any, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function percentileRank(values: number[], v: number): number {
  if (!values.length) return 0.5;
  const sorted = [...values].sort((a, b) => a - b);
  let i = 0;
  while (i < sorted.length && sorted[i] <= v) i++;
  return i / sorted.length;
}

function getSeasonStatsByRosterId(intel: LeagueIntelligence): Record<number, any> | undefined {
  const anyIntel = intel as any;
  return (
    anyIntel.seasonSummaryByRosterId ||
    anyIntel.standingsByRosterId ||
    anyIntel.lastSeasonByRosterId ||
    anyIntel.statsByRosterId
  );
}

function rosterAssetValue(intel: LeagueIntelligence, rosterId: number): number {
  const anyIntel = intel as any;
  const list: Asset[] | undefined = anyIntel.assetsByRosterId?.[rosterId];
  if (!Array.isArray(list)) return 0;

  let sum = 0;
  for (const a of list) {
    if (!a) continue;
    if (a.type === "FAAB") continue;
    sum += safeNum((a as any).value, 0);
  }
  return sum;
}

function computeTpiByRosterId(intel: LeagueIntelligence): Record<number, number> {
  const anyIntel = intel as any;

  const rosterIds: number[] = Array.isArray(anyIntel.rosterIds)
    ? anyIntel.rosterIds
    : Array.isArray(anyIntel.rosters)
      ? anyIntel.rosters.map((r: any) => r?.rosterId).filter((x: any) => Number.isFinite(x))
      : anyIntel.assetsByRosterId
        ? Object.keys(anyIntel.assetsByRosterId).map((k) => Number(k)).filter(Number.isFinite)
        : [];

  const seasonStatsByRosterId = getSeasonStatsByRosterId(intel) || {};
  const rosterValues = rosterIds.map((rid) => rosterAssetValue(intel, rid));

  const pointsForValues: number[] = rosterIds
    .map((rid) => safeNum(seasonStatsByRosterId?.[rid]?.pointsFor, NaN))
    .filter((n) => Number.isFinite(n));

  const tpi: Record<number, number> = {};

  for (const rid of rosterIds) {
    const s = seasonStatsByRosterId?.[rid];
    const hasSeason = !!s;

    const rv = rosterAssetValue(intel, rid);
    const rvPct = percentileRank(rosterValues, rv);
    const rosterValueScore = rvPct * 100;

    if (!hasSeason) {
      tpi[rid] = clamp(rosterValueScore, 0, 100);
      continue;
    }

    const champion = !!s.champion || s.finalRank === 1;
    const finalRank = safeNum(s.finalRank, 0);
    const madePlayoffs = !!s.madePlayoffs || (!!finalRank && finalRank <= safeNum(s.playoffTeams, 0));
    let finishScore = 50;

    if (champion) finishScore = 100;
    else if (finalRank === 2) finishScore = 90;
    else if (madePlayoffs) finishScore = 70;
    else if (finalRank > 0) {
      const nTeams = safeNum(s.totalTeams, rosterIds.length || 12);
      finishScore = finalRank > Math.ceil(nTeams * 0.6) ? 30 : 50;
    }

    const pf = safeNum(s.pointsFor, NaN);
    const pointsPct = Number.isFinite(pf) && pointsForValues.length
      ? percentileRank(pointsForValues, pf) * 100
      : 50;

    const out = 0.35 * finishScore + 0.35 * pointsPct + 0.30 * rosterValueScore;
    tpi[rid] = clamp(out, 0, 100);
  }

  return tpi;
}

function includesAgingVet(assets: Asset[], agingVetAge: number): boolean {
  return assets.some((a) => a.type === "PLAYER" && safeNum(a.age, 0) >= agingVetAge);
}

function includesYouthOrPremiumPicks(
  giveAssets: Asset[],
  youthAge: number
): { hasYouth: boolean; hasPremiumPick: boolean } {
  let hasYouth = false;
  let hasPremiumPick = false;

  for (const a of giveAssets) {
    if (a.type === "PLAYER" && safeNum(a.age, 99) <= youthAge) hasYouth = true;
    if (a.type === "PICK" && (a.round === 1 || a.round === 2)) hasPremiumPick = true;
  }

  return { hasYouth, hasPremiumPick };
}

function incSummary(map: Record<string, number>, code: GuardrailReasonCode) {
  map[code] = (map[code] ?? 0) + 1;
}

export function applyParityGuardrailsToCandidates(args: {
  userRosterId: number;
  partnerRosterId: number;
  intelligence: LeagueIntelligence;
  candidates: TradeCandidate[];
  config?: GuardrailsConfig;
}): GuardrailsResult {
  const cfg: Required<GuardrailsConfig> = {
    enabled: args.config?.enabled ?? true,
    strongTeamDelta1: args.config?.strongTeamDelta1 ?? 20,
    strongTeamDelta2: args.config?.strongTeamDelta2 ?? 35,
    maxPartnerGainAtDelta1: args.config?.maxPartnerGainAtDelta1 ?? 1.05,
    maxPartnerGainAtDelta2: args.config?.maxPartnerGainAtDelta2 ?? 1.00,
    protectWeakTeams: args.config?.protectWeakTeams ?? true,
    weakTeamTpiThreshold: args.config?.weakTeamTpiThreshold ?? 45,
    agingVetAge: args.config?.agingVetAge ?? 28,
    youthAge: args.config?.youthAge ?? 24,
    maxWeakTeamOverpayRatio: args.config?.maxWeakTeamOverpayRatio ?? 1.00,
    includeReasonCodes: args.config?.includeReasonCodes ?? false,
  };

  const notes: string[] = [];
  const removedDebug: GuardrailCandidateDebug[] = [];
  const keptDebug: GuardrailCandidateDebug[] = [];
  const summaryByCode: Record<string, number> = {};

  if (!cfg.enabled) {
    if (cfg.includeReasonCodes) {
      for (const c of args.candidates) {
        keptDebug.push({ tradeId: c.id, codes: ["GR_DISABLED"] });
        incSummary(summaryByCode, "GR_DISABLED");
      }
    }
    return {
      filtered: args.candidates,
      removedCount: 0,
      notes: ["Guardrails disabled."],
      tpiByRosterId: {},
      removed: cfg.includeReasonCodes ? removedDebug : undefined,
      kept: cfg.includeReasonCodes ? keptDebug : undefined,
      summaryByCode: cfg.includeReasonCodes ? (summaryByCode as any) : undefined,
    };
  }

  const tpiByRosterId = computeTpiByRosterId(args.intelligence);
  const userTpi = safeNum(tpiByRosterId[args.userRosterId], 50);
  const partnerTpi = safeNum(tpiByRosterId[args.partnerRosterId], 50);
  const delta = partnerTpi - userTpi;

  let maxPartnerGainRatio = Infinity;
  if (delta >= cfg.strongTeamDelta2) {
    maxPartnerGainRatio = cfg.maxPartnerGainAtDelta2;
    notes.push(
      `Parity guardrail: partner is much stronger (ΔTPI=${Math.round(delta)}). Limiting partner gain to <= ${(cfg.maxPartnerGainAtDelta2 - 1) * 100}% in recommended offers.`
    );
  } else if (delta >= cfg.strongTeamDelta1) {
    maxPartnerGainRatio = cfg.maxPartnerGainAtDelta1;
    notes.push(
      `Parity guardrail: partner is stronger (ΔTPI=${Math.round(delta)}). Limiting partner gain to <= ${(cfg.maxPartnerGainAtDelta1 - 1) * 100}% in recommended offers.`
    );
  }

  const filtered: TradeCandidate[] = [];
  let removed = 0;

  for (const c of args.candidates) {
    const codes: GuardrailReasonCode[] = [];
    const details: Record<string, any> = {};

    const giveTotal = safeNum(c.giveTotal, 0);
    const receiveTotal = safeNum(c.receiveTotal, 0);

    if (receiveTotal <= 0) {
      codes.push("GR_NO_RECEIVE_TOTAL");
      details.receiveTotal = receiveTotal;
      details.giveTotal = giveTotal;
      removed++;
      if (cfg.includeReasonCodes) {
        removedDebug.push({ tradeId: c.id, codes, details });
        for (const code of codes) incSummary(summaryByCode, code);
      }
      continue;
    }

    const partnerGainRatio = giveTotal / receiveTotal;

    if (partnerGainRatio > maxPartnerGainRatio) {
      codes.push("GR_STRONG_TEAM_GAIN_LIMIT");
      details.partnerGainRatio = partnerGainRatio;
      details.maxPartnerGainRatio = maxPartnerGainRatio;
      details.deltaTpi = delta;

      removed++;
      if (cfg.includeReasonCodes) {
        removedDebug.push({ tradeId: c.id, codes, details });
        for (const code of codes) incSummary(summaryByCode, code);
      }
      continue;
    }

    if (cfg.protectWeakTeams && userTpi < cfg.weakTeamTpiThreshold) {
      const userReceivingAgingVet = includesAgingVet(c.receive, cfg.agingVetAge);
      if (userReceivingAgingVet) {
        const { hasYouth, hasPremiumPick } = includesYouthOrPremiumPicks(c.give, cfg.youthAge);

        if ((hasYouth || hasPremiumPick) && partnerGainRatio > cfg.maxWeakTeamOverpayRatio) {
          codes.push("GR_WEAK_TEAM_ANTI_REBUILD");
          details.userTpi = userTpi;
          details.weakThreshold = cfg.weakTeamTpiThreshold;
          details.agingVetAge = cfg.agingVetAge;
          details.hasYouth = hasYouth;
          details.hasPremiumPick = hasPremiumPick;
          details.partnerGainRatio = partnerGainRatio;
          details.maxWeakOverpay = cfg.maxWeakTeamOverpayRatio;

          removed++;
          if (cfg.includeReasonCodes) {
            removedDebug.push({ tradeId: c.id, codes, details });
            for (const code of codes) incSummary(summaryByCode, code);
          }
          continue;
        }
      }
    }

    filtered.push(c);
    if (cfg.includeReasonCodes) {
      keptDebug.push({ tradeId: c.id, codes: [], details: undefined });
    }
  }

  if (removed > 0) notes.push(`Guardrails filtered out ${removed} candidate(s) from recommendation.`);
  if (filtered.length === 0) notes.push("All candidates were filtered by guardrails; returning unfiltered list may be necessary for manual browsing.");

  return {
    filtered,
    removedCount: removed,
    notes,
    tpiByRosterId,
    removed: cfg.includeReasonCodes ? removedDebug : undefined,
    kept: cfg.includeReasonCodes ? keptDebug : undefined,
    summaryByCode: cfg.includeReasonCodes ? (summaryByCode as any) : undefined,
  };
}
