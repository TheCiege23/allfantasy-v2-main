/**
 * The FantasyCalc adapter — the vendor boundary, and nothing else.
 *
 * WHY THIS FILE IS SEPARATE FROM `lib/fantasycalc.ts`. That module holds the
 * pure half: `findPlayerByName`, `getPickValue`, `getValueTier`,
 * `calculateTradeBalance`, the trade-grading maths, the types. Roughly 45
 * modules import those, legitimately and with no interest in the network.
 *
 * While the fetch lived beside them, the DB-first guard could never exempt the
 * adapter: an exemption is earned by having only ingestion-shaped importers,
 * and a module imported by 45 surfaces plainly does not. Splitting the FETCH
 * out — rather than moving the 45 importers — leaves this file with the small
 * set that should have it: the DB-first layer, the sync script, and one
 * ingestion module.
 *
 * ⚠ ANYTHING ADDED HERE IS A LIVE VENDOR CALL ON WHATEVER IMPORTS IT. Request
 * paths must go through `lib/fantasycalc-db.ts`. If you find yourself importing
 * this file from a route, that is the signal to add a DB-first accessor there
 * instead.
 */

import type {
  FantasyCalcCache,
  FantasyCalcPlayer,
  FantasyCalcPlayerIdentity,
  FantasyCalcSettings,
  PlayerValueLookup,
} from './fantasycalc'
import { buildPlayerValuesForNames } from './fantasycalc'

const FANTASYCALC_API_BASE = 'https://api.fantasycalc.com/values/current';
const FANTASYCALC_PLAYERS_BASE = 'https://api.fantasycalc.com/players';

const cache: Map<string, FantasyCalcCache> = new Map();
const CACHE_TTL = 1000 * 60 * 60; // 1 hour

function getCacheKey(settings: FantasyCalcSettings): string {
  return `${settings.isDynasty}-${settings.numQbs}-${settings.numTeams}-${settings.ppr}`;
}

export async function fetchFantasyCalcValues(
  settings: FantasyCalcSettings = { isDynasty: true, numQbs: 2, numTeams: 12, ppr: 1 }
): Promise<FantasyCalcPlayer[]> {
  const cacheKey = getCacheKey(settings);
  const cached = cache.get(cacheKey);

  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return cached.data;
  }

  const url = `${FANTASYCALC_API_BASE}?isDynasty=${settings.isDynasty}&numQbs=${settings.numQbs}&numTeams=${settings.numTeams}&ppr=${settings.ppr}`;

  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`FantasyCalc API error: ${response.status}`);
  }

  const data: FantasyCalcPlayer[] = await response.json();

  cache.set(cacheKey, {
    data,
    fetchedAt: Date.now(),
    settings,
  });

  return data;
}

let playersDirectoryCache: { data: FantasyCalcPlayerIdentity[]; fetchedAt: number } | null = null;
const PLAYERS_CACHE_TTL = 1000 * 60 * 60 * 12; // 12 hours

export async function fetchFantasyCalcPlayerDirectory(): Promise<FantasyCalcPlayerIdentity[]> {
  if (playersDirectoryCache && Date.now() - playersDirectoryCache.fetchedAt < PLAYERS_CACHE_TTL) {
    return playersDirectoryCache.data;
  }

  const response = await fetch(FANTASYCALC_PLAYERS_BASE, {
    headers: { 'Accept': 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`FantasyCalc Players API error: ${response.status}`);
  }

  const data: FantasyCalcPlayerIdentity[] = await response.json();

  playersDirectoryCache = { data, fetchedAt: Date.now() };

  return data;
}

/**
 * Age of THIS MODULE'S in-process cache — not of the DB snapshot.
 *
 * ⚠ If the surface asking has moved to `getFantasyCalcValuesDbFirst`, this is
 * the wrong function and will answer `null` forever, because the DB-first path
 * never populates the Map above. Use `getFantasyCalcCacheAgeMs` from
 * `lib/fantasycalc-db.ts` instead. `league-rankings-v2` shipped exactly that bug
 * for the length of one commit: a freshness readout reporting "unknown" for data
 * that was fresh, with no type error to catch it.
 */
export function getValuationCacheAgeMs(settings: FantasyCalcSettings): number | null {
  const cacheKey = getCacheKey(settings);
  const cached = cache.get(cacheKey);
  if (!cached) return null;
  return Date.now() - cached.fetchedAt;
}

/**
 * Fetching wrapper, kept for non-request callers.
 *
 * Request paths must use `getPlayerValuesForNamesDbFirst` from
 * `lib/fantasycalc-db.ts` instead — this one goes straight to the vendor.
 *
 * The swallow-and-return-empty behaviour is preserved deliberately rather than
 * "fixed" in passing: several callers treat an empty map as "no values known"
 * and render around it. Making it throw here would change those surfaces in a
 * commit that is supposed to be a move, not a behaviour change.
 */
export async function getPlayerValuesForNames(
  names: string[],
  settings: FantasyCalcSettings = { isDynasty: true, numQbs: 2, numTeams: 12, ppr: 1 }
): Promise<Map<string, PlayerValueLookup>> {
  try {
    const players = await fetchFantasyCalcValues(settings);
    return buildPlayerValuesForNames(players, names);
  } catch (error) {
    console.error('Failed to fetch FantasyCalc values:', error);
    return new Map<string, PlayerValueLookup>();
  }
}
