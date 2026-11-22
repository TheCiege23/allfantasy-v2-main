import { prisma } from "@/lib/prisma";
import { boundMap } from "@/lib/ttl-memo";

export interface PlayerAnalytics {
  name: string;
  normalizedName: string;
  position: string;
  status: string | null;
  currentTeam: string | null;
  season: string;

  combine: {
    fortyYardDash: number | null;
    twentyYardShuttle: number | null;
    threeConeDrill: number | null;
    benchPress: number | null;
    broadJump: number | null;
    verticalJump: number | null;
    athleticismScore: number | null;
    speedScore: number | null;
    burstScore: number | null;
    agilityScore: number | null;
    sparqX: number | null;
  };

  physical: {
    armLengthIn: number | null;
    handSizeIn: number | null;
    heightIn: number | null;
    weightLb: number | null;
    bmi: number | null;
    catchRadius: number | null;
    throwVelocityMph: number | null;
  };

  college: {
    breakoutAge: number | null;
    breakoutRating: number | null;
    breakoutYear: number | null;
    college: string | null;
    dominatorRating: number | null;
    dynamicScore: number | null;
    levelOfCompetition: number | null;
    freshmanYards: number | null;
    targetShare: number | null;
    receiverRating: string | null;
    ypr: number | null;
    teammateScore: number | null;
    bestSeasonYardageShare: number | null;
  };

  draft: {
    draftPick: number | null;
    draftYear: number | null;
    currentAdp: number | null;
    currentAdpTrend: number | null;
    lifetimeValue: number | null;
  };

  comparablePlayers: string[];
  weeklyVolatility: number | null;
  totalFantasyPoints: number | null;
  fantasyPointsPerGame: number | null;
  expectedFantasyPoints: number | null;
  expectedFantasyPointsPerGame: number | null;

  rawData: Record<string, any> | null;
}

function normalizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[''`]/g, "'")
    .replace(/[^a-z0-9' .\-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseComparables(raw: string | null | undefined): string[] {
  if (!raw || raw.trim() === "") return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const cache = new Map<string, { data: PlayerAnalytics | null; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000;
// Keyed by player name and season; bounded so names looked up once do not stay forever.
const CACHE_MAX_ENTRIES = 5_000;
function setCached(key: string, data: PlayerAnalytics | null) {
  boundMap(cache, (e) => Date.now() - e.ts >= CACHE_TTL, CACHE_MAX_ENTRIES);
  cache.set(key, { data, ts: Date.now() });
}

export async function getPlayerAnalytics(
  name: string,
  season?: string
): Promise<PlayerAnalytics | null> {
  const normalizedName = normalizeName(name);
  const cacheKey = `${normalizedName}|${season || "latest"}`;

  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  const where: any = { normalizedName };
  if (season) where.season = season;

  const row = await prisma.playerAnalyticsSnapshot.findFirst({
    where,
    orderBy: { season: "desc" },
  });

  if (!row) {
    setCached(cacheKey, null);
    return null;
  }

  const result: PlayerAnalytics = {
    name: row.name,
    normalizedName: row.normalizedName,
    position: row.position,
    status: row.status,
    currentTeam: row.currentTeam,
    season: row.season,
    combine: {
      fortyYardDash: row.fortyYardDash,
      twentyYardShuttle: row.twentyYardShuttle,
      threeConeDrill: row.threeConeDrill,
      benchPress: row.benchPress,
      broadJump: row.broadJump,
      verticalJump: row.verticalJump,
      athleticismScore: row.athleticismScore,
      speedScore: row.speedScore,
      burstScore: row.burstScore,
      agilityScore: row.agilityScore,
      sparqX: row.sparqX,
    },
    physical: {
      armLengthIn: row.armLengthIn,
      handSizeIn: row.handSizeIn,
      heightIn: row.heightIn,
      weightLb: row.weightLb,
      bmi: row.bmi,
      catchRadius: row.catchRadius,
      throwVelocityMph: row.throwVelocityMph,
    },
    college: {
      breakoutAge: row.breakoutAge,
      breakoutRating: row.breakoutRating,
      breakoutYear: row.breakoutYear,
      college: row.college,
      dominatorRating: row.collegeDominatorRating,
      dynamicScore: row.collegeDynamicScore,
      levelOfCompetition: row.collegeLevelOfCompetition,
      freshmanYards: row.collegeFreshmanYards,
      targetShare: row.collegeTargetShare,
      receiverRating: row.collegeReceiverRating,
      ypr: row.collegeYpr,
      teammateScore: row.collegeTeammateScore,
      bestSeasonYardageShare: row.bestCollegeSeasonYardageShare,
    },
    draft: {
      draftPick: row.draftPick,
      draftYear: row.draftYear,
      currentAdp: row.currentAdp,
      currentAdpTrend: row.currentAdpTrend,
      lifetimeValue: row.lifetimeValue,
    },
    comparablePlayers: parseComparables(row.bestComparablePlayers),
    weeklyVolatility: row.weeklyVolatility,
    totalFantasyPoints: row.totalFantasyPoints,
    fantasyPointsPerGame: row.fantasyPointsPerGame,
    expectedFantasyPoints: row.expectedFantasyPoints,
    expectedFantasyPointsPerGame: row.expectedFantasyPointsPerGame,
    rawData: row.rawData as Record<string, any> | null,
  };

  setCached(cacheKey, result);
  return result;
}

export async function getPlayerAnalyticsBatch(
  names: string[],
  season?: string
): Promise<Map<string, PlayerAnalytics>> {
  const result = new Map<string, PlayerAnalytics>();
  const uncached: string[] = [];
  const normalizedMap = new Map<string, string>();

  for (const name of names) {
    const norm = normalizeName(name);
    normalizedMap.set(norm, name);
    const cacheKey = `${norm}|${season || "latest"}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      if (cached.data) result.set(name, cached.data);
    } else {
      uncached.push(norm);
    }
  }

  if (uncached.length === 0) return result;

  const where: any = { normalizedName: { in: uncached } };
  if (season) where.season = season;

  const rows = await prisma.playerAnalyticsSnapshot.findMany({
    where,
    orderBy: { season: "desc" },
  });

  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.normalizedName)) continue;
    seen.add(row.normalizedName);

    const originalName = normalizedMap.get(row.normalizedName) || row.name;
    const analytics: PlayerAnalytics = {
      name: row.name,
      normalizedName: row.normalizedName,
      position: row.position,
      status: row.status,
      currentTeam: row.currentTeam,
      season: row.season,
      combine: {
        fortyYardDash: row.fortyYardDash,
        twentyYardShuttle: row.twentyYardShuttle,
        threeConeDrill: row.threeConeDrill,
        benchPress: row.benchPress,
        broadJump: row.broadJump,
        verticalJump: row.verticalJump,
        athleticismScore: row.athleticismScore,
        speedScore: row.speedScore,
        burstScore: row.burstScore,
        agilityScore: row.agilityScore,
        sparqX: row.sparqX,
      },
      physical: {
        armLengthIn: row.armLengthIn,
        handSizeIn: row.handSizeIn,
        heightIn: row.heightIn,
        weightLb: row.weightLb,
        bmi: row.bmi,
        catchRadius: row.catchRadius,
        throwVelocityMph: row.throwVelocityMph,
      },
      college: {
        breakoutAge: row.breakoutAge,
        breakoutRating: row.breakoutRating,
        breakoutYear: row.breakoutYear,
        college: row.college,
        dominatorRating: row.collegeDominatorRating,
        dynamicScore: row.collegeDynamicScore,
        levelOfCompetition: row.collegeLevelOfCompetition,
        freshmanYards: row.collegeFreshmanYards,
        targetShare: row.collegeTargetShare,
        receiverRating: row.collegeReceiverRating,
        ypr: row.collegeYpr,
        teammateScore: row.collegeTeammateScore,
        bestSeasonYardageShare: row.bestCollegeSeasonYardageShare,
      },
      draft: {
        draftPick: row.draftPick,
        draftYear: row.draftYear,
        currentAdp: row.currentAdp,
        currentAdpTrend: row.currentAdpTrend,
        lifetimeValue: row.lifetimeValue,
      },
      comparablePlayers: parseComparables(row.bestComparablePlayers),
      weeklyVolatility: row.weeklyVolatility,
      totalFantasyPoints: row.totalFantasyPoints,
      fantasyPointsPerGame: row.fantasyPointsPerGame,
      expectedFantasyPoints: row.expectedFantasyPoints,
      expectedFantasyPointsPerGame: row.expectedFantasyPointsPerGame,
      rawData: row.rawData as Record<string, any> | null,
    };

    result.set(originalName, analytics);
    const cacheKey = `${row.normalizedName}|${season || "latest"}`;
    setCached(cacheKey, analytics);
  }

  for (const norm of uncached) {
    if (!seen.has(norm)) {
      const cacheKey = `${norm}|${season || "latest"}`;
      setCached(cacheKey, null);
    }
  }

  return result;
}

export function computeAthleticGrade(analytics: PlayerAnalytics): {
  grade: string;
  score: number;
  label: string;
} {
  const c = analytics.combine;
  let score = 50;

  if (c.athleticismScore != null) {
    score = Math.min(100, Math.max(0, (c.athleticismScore / 140) * 100));
  } else {
    let components = 0;
    let total = 0;

    if (c.speedScore != null) {
      total += Math.min(100, (c.speedScore / 130) * 100);
      components++;
    }
    if (c.burstScore != null) {
      total += Math.min(100, (c.burstScore / 140) * 100);
      components++;
    }
    if (c.agilityScore != null) {
      total += Math.min(100, (11.5 / Math.max(c.agilityScore, 10)) * 100);
      components++;
    }

    if (components > 0) score = total / components;
  }

  let grade: string;
  let label: string;
  if (score >= 90) { grade = "A+"; label = "Elite Athlete"; }
  else if (score >= 80) { grade = "A"; label = "Exceptional"; }
  else if (score >= 70) { grade = "B+"; label = "Above Average"; }
  else if (score >= 60) { grade = "B"; label = "Average"; }
  else if (score >= 50) { grade = "C+"; label = "Below Average"; }
  else if (score >= 40) { grade = "C"; label = "Limited"; }
  else { grade = "D"; label = "Poor"; }

  return { grade, score: Math.round(score), label };
}

export function computeCollegeProductionGrade(analytics: PlayerAnalytics): {
  grade: string;
  score: number;
  label: string;
} {
  const col = analytics.college;
  let score = 50;
  let components = 0;
  let total = 0;

  if (col.dominatorRating != null && col.dominatorRating > 0) {
    total += Math.min(100, (col.dominatorRating / 45) * 100);
    components++;
  }
  if (col.breakoutAge != null) {
    const ageScore = col.breakoutAge <= 19.5 ? 95 :
      col.breakoutAge <= 20 ? 90 :
      col.breakoutAge <= 20.5 ? 85 :
      col.breakoutAge <= 21 ? 75 :
      col.breakoutAge <= 21.5 ? 65 :
      col.breakoutAge <= 22 ? 50 :
      Math.max(20, 50 - (col.breakoutAge - 22) * 15);
    total += ageScore;
    components++;
  }
  if (col.levelOfCompetition != null && col.levelOfCompetition > 0) {
    total += Math.min(100, (col.levelOfCompetition / 100) * 100);
    components++;
  }

  if (components > 0) score = total / components;

  let grade: string;
  let label: string;
  if (score >= 85) { grade = "A+"; label = "Elite Producer"; }
  else if (score >= 75) { grade = "A"; label = "Strong Producer"; }
  else if (score >= 65) { grade = "B+"; label = "Good Producer"; }
  else if (score >= 55) { grade = "B"; label = "Average Producer"; }
  else if (score >= 45) { grade = "C+"; label = "Below Average"; }
  else if (score >= 35) { grade = "C"; label = "Limited Production"; }
  else { grade = "D"; label = "Minimal Production"; }

  return { grade, score: Math.round(score), label };
}

export function clearAnalyticsCache(): void {
  cache.clear();
}
