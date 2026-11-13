import type { Position } from "@/lib/league-decision-context";

type AssetKind = "PLAYER" | "PICK";

export type AllowedPricedAsset = {
  id: string;
  label: string;
  kind: AssetKind;
  position?: string;
  tier?: string;
  value: number;
  age?: number;
  isStarter?: boolean;
  pickSeason?: number;
  pickRound?: number;
};

export type TeamProfileLite = {
  teamId: string;
  competitiveWindow: "WIN_NOW" | "REBUILD" | "MIDDLE";
  needs: Position[];
  surpluses: Position[];
};

type AllowedAssetsResult = {
  userAssetsAllowed: Array<{ id: string; label: string; kind: AssetKind }>;
  partnerAssetsAllowed: Array<{ id: string; label: string; kind: AssetKind }>;
  userPicksAllowed: Array<{ id: string; label: string }>;
  partnerPicksAllowed: Array<{ id: string; label: string }>;
  redLineIds: Set<string>;
};

export function buildAllowedAssets({
  objective,
  userTeam,
  partnerTeam,
  userAssets,
  partnerAssets,
  currentYear,
  allowFutureFirsts = false,
  coreTopN = 2,
}: {
  objective: "WIN_NOW" | "REBUILD" | "BALANCED";
  userTeam: TeamProfileLite;
  partnerTeam: TeamProfileLite;
  userAssets: AllowedPricedAsset[];
  partnerAssets: AllowedPricedAsset[];
  currentYear: number;
  allowFutureFirsts?: boolean;
  coreTopN?: number;
}): AllowedAssetsResult {
  const userCore = computeCoreAssetIds(userAssets, currentYear, coreTopN);
  const partnerCore = computeCoreAssetIds(partnerAssets, currentYear, coreTopN);

  const userAllowedPlayers = userAssets
    .filter((a) => a.kind === "PLAYER")
    .filter((a) => !userCore.has(a.id))
    .filter((a) => isUserSendAllowed(a, userTeam, objective))
    .sort((a, b) => b.value - a.value);

  const userAllowedPicks = userAssets
    .filter((a) => a.kind === "PICK")
    .filter((a) => !userCore.has(a.id))
    .filter((a) => isUserPickSendAllowed(a, objective, currentYear, allowFutureFirsts))
    .sort((a, b) => (b.pickSeason ?? 0) - (a.pickSeason ?? 0) || (b.pickRound ?? 9) - (a.pickRound ?? 9));

  const partnerAllowedPlayers = partnerAssets
    .filter((a) => a.kind === "PLAYER")
    .filter((a) => !partnerCore.has(a.id))
    .filter((a) => isPartnerRequestAllowed(a, userTeam, partnerTeam))
    .sort((a, b) => b.value - a.value);

  const partnerAllowedPicks = partnerAssets
    .filter((a) => a.kind === "PICK")
    .filter((a) => !partnerCore.has(a.id))
    .filter((a) => isPartnerPickRequestAllowed(a, partnerTeam, currentYear))
    .sort((a, b) => (b.pickSeason ?? 0) - (a.pickSeason ?? 0) || (b.pickRound ?? 9) - (a.pickRound ?? 9));

  const userAssetsAllowed = userAllowedPlayers.slice(0, 18).map(toAllowed);
  const partnerAssetsAllowed = partnerAllowedPlayers.slice(0, 18).map(toAllowed);

  const userPicksAllowed = userAllowedPicks.slice(0, 10).map((p) => ({ id: p.id, label: p.label }));
  const partnerPicksAllowed = partnerAllowedPicks.slice(0, 10).map((p) => ({ id: p.id, label: p.label }));

  const redLineIds = new Set<string>([...userCore]);

  return {
    userAssetsAllowed,
    partnerAssetsAllowed,
    userPicksAllowed,
    partnerPicksAllowed,
    redLineIds,
  };
}

function toAllowed(a: AllowedPricedAsset) {
  return { id: a.id, label: a.label, kind: a.kind };
}

function computeCoreAssetIds(assets: AllowedPricedAsset[], currentYear: number, topN: number) {
  const core = new Set<string>();

  const players = assets.filter((a) => a.kind === "PLAYER");
  const picks = assets.filter((a) => a.kind === "PICK");

  for (const p of players) {
    const t = normalizeTier(p.tier);
    if (t === "Elite" || t === "Tier0_Untouchable" || t === "Tier1" || t === "Tier1_Cornerstone") {
      core.add(p.id);
    }
  }

  players
    .slice()
    .sort((a, b) => b.value - a.value)
    .slice(0, topN)
    .forEach((p) => core.add(p.id));

  const futureFirsts = picks.filter(
    (p) => p.pickRound === 1 && (p.pickSeason ?? 0) >= currentYear
  );
  const nearFirsts = futureFirsts.filter(
    (p) => (p.pickSeason ?? currentYear) <= currentYear + 2
  );

  if (futureFirsts.length <= 1) {
    futureFirsts.forEach((p) => core.add(p.id));
  } else {
    nearFirsts.forEach((p) => core.add(p.id));
  }

  return core;
}

function normalizeTier(tier?: string): string {
  if (!tier) return "Depth";
  if (tier.startsWith("Tier0") || tier === "Elite") return "Elite";
  if (tier.startsWith("Tier1")) return "Tier1";
  if (tier.startsWith("Tier2")) return "Tier2";
  if (tier.startsWith("Tier3")) return "Tier3";
  if (tier.startsWith("Tier4")) return "Tier4";
  return tier;
}

function isUserSendAllowed(
  a: AllowedPricedAsset,
  userTeam: TeamProfileLite,
  objective: string
): boolean {
  const tier = normalizeTier(a.tier);
  const pos = a.position as Position | undefined;

  const isSurplusPos = pos ? userTeam.surpluses.includes(pos) : false;
  const isNeedPos = pos ? userTeam.needs.includes(pos) : false;

  const isTier2Plus = tier === "Tier2" || tier === "Tier1" || tier === "Elite";
  const isTier3Plus = tier === "Tier3" || isTier2Plus;
  const isLowerTier = tier === "Tier4" || tier === "Depth";

  if (isNeedPos && a.isStarter && !isSurplusPos) return false;
  if (isNeedPos && isTier3Plus && !isSurplusPos) return false;

  if (objective === "WIN_NOW") {
    if (isLowerTier) return true;
    if (tier === "Tier3") return true;
    if (tier === "Tier2") return isSurplusPos || isOlderForPosition(a);
    return false;
  }

  if (objective === "REBUILD") {
    if (isLowerTier) return true;
    if (tier === "Tier3") return true;
    if (tier === "Tier2") return isOlderForPosition(a) || pos === "RB";
    return false;
  }

  if (isLowerTier) return true;
  if (tier === "Tier3") return true;
  if (tier === "Tier2") return isSurplusPos;
  return false;
}

function isOlderForPosition(a: AllowedPricedAsset): boolean {
  if (!a.age || !a.position) return false;
  if (a.position === "RB") return a.age >= 28;
  if (a.position === "WR") return a.age >= 29;
  if (a.position === "TE") return a.age >= 30;
  if (a.position === "QB") return a.age >= 31;
  return false;
}

function isUserPickSendAllowed(
  a: AllowedPricedAsset,
  objective: string,
  _currentYear: number,
  allowFutureFirsts: boolean
): boolean {
  const round = a.pickRound;
  if (!round) return false;

  if (round === 1) return allowFutureFirsts && objective !== "WIN_NOW";
  if (round >= 2 && round <= 4) return true;

  return false;
}

function isPartnerRequestAllowed(
  a: AllowedPricedAsset,
  userTeam: TeamProfileLite,
  partnerTeam: TeamProfileLite
): boolean {
  const pos = a.position as Position | undefined;
  const tier = normalizeTier(a.tier);

  const matchesUserNeed = pos ? userTeam.needs.includes(pos) : false;
  const partnerSurplus = pos ? partnerTeam.surpluses.includes(pos) : false;
  const partnerNeed = pos ? partnerTeam.needs.includes(pos) : false;

  if (partnerNeed && a.isStarter) return false;
  if (partnerNeed && tier !== "Depth") return false;

  if (partnerSurplus && matchesUserNeed) return true;
  if (partnerSurplus && (tier === "Tier2" || tier === "Tier3" || tier === "Tier4")) return true;
  if (matchesUserNeed && (tier === "Tier3" || tier === "Tier4" || tier === "Depth")) return true;

  return false;
}

function isPartnerPickRequestAllowed(
  a: AllowedPricedAsset,
  partnerTeam: TeamProfileLite,
  _currentYear: number
): boolean {
  const round = a.pickRound;
  if (!round) return false;

  if (partnerTeam.competitiveWindow === "WIN_NOW") {
    return round >= 2 && round <= 4;
  }

  if (partnerTeam.competitiveWindow === "REBUILD") {
    return round >= 3 && round <= 4;
  }

  return round >= 3 && round <= 4;
}
