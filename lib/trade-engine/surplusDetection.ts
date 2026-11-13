// lib/trade-engine/surplusDetection.ts
import type { Asset, LeagueIntelligence } from "./types";

type SurplusDetectionResult = {
  rosterId: number;
  needs?: any;
  surplus: Asset[];
  core: Asset[];
  surplusByPos: Record<string, Asset[]>;
  coreByPos: Record<string, Asset[]>;
};

function isAssetLike(x: any): x is Asset {
  return !!x && typeof x === "object" && typeof x.id === "string" && typeof x.type === "string";
}

function getProfile(intel: LeagueIntelligence, rosterId: number): any | undefined {
  const anyIntel = intel as any;

  if (anyIntel.profilesByRosterId?.[rosterId]) return anyIntel.profilesByRosterId[rosterId];
  if (anyIntel.managerProfilesByRosterId?.[rosterId]) return anyIntel.managerProfilesByRosterId[rosterId];

  const arr = anyIntel.managerProfiles ?? anyIntel.profiles ?? [];
  if (Array.isArray(arr)) return arr.find((p: any) => p?.rosterId === rosterId);

  return undefined;
}

function normalizeSurplus(raw: any): Asset[] {
  if (!raw) return [];

  if (Array.isArray(raw)) return raw.filter(isAssetLike);

  if (raw?.items && Array.isArray(raw.items)) {
    return raw.items.filter(isAssetLike);
  }

  if (typeof raw === "object") {
    const out: Asset[] = [];
    for (const v of Object.values(raw)) {
      if (Array.isArray(v)) out.push(...v.filter(isAssetLike));
    }
    return out;
  }

  return [];
}

function normalizeAssets(raw: any): Asset[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(isAssetLike);
  if (raw?.items && Array.isArray(raw.items)) return raw.items.filter(isAssetLike);
  return [];
}

function groupByPos(assets: Asset[]): Record<string, Asset[]> {
  const by: Record<string, Asset[]> = {};
  for (const a of assets) {
    const key =
      a.type === "PLAYER"
        ? (a.pos || (a.isIdp ? (a.idpPos || "IDP") : "UNK"))
        : a.type;
    (by[key] ??= []).push(a);
  }
  return by;
}

function computeCore(allAssets: Asset[], surplus: Asset[]): Asset[] {
  const surplusIds = new Set(surplus.map((a) => a.id));
  return allAssets.filter((a) => !surplusIds.has(a.id));
}

export function detectSurplusAssets(
  intelligence: LeagueIntelligence,
  rosterId: number
): SurplusDetectionResult {
  const profile = getProfile(intelligence, rosterId);

  const needs = profile?.needs;
  const surplus = normalizeSurplus(profile?.surplus);
  const allAssets = normalizeAssets(profile?.assets);

  const core = computeCore(allAssets, surplus);

  return {
    rosterId,
    needs,
    surplus,
    core,
    surplusByPos: groupByPos(surplus),
    coreByPos: groupByPos(core),
  };
}

