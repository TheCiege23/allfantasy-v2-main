import 'server-only'

import { prisma } from '@/lib/prisma'
import type { LeagueContextEnvelope } from '@/lib/league-context/leagueContextService'

/**
 * marketValueService — REAL trade-value charts for players, picks, and FAAB,
 * matched to the league's exact format via the LeagueContext envelope.
 *
 * Source: FantasyCalc's public market-consensus values (built from thousands
 * of real trades), fetched per format:
 *  - redraft vs dynasty (isDynasty),
 *  - 1QB vs superflex (numQbs),
 *  - league size (numTeams) and PPR weight,
 *  - DRAFT PICKS are first-class entries in dynasty mode ("2026 Pick 1.01",
 *    "2027 Round 2") — parsed into exact-slot and round-average values.
 *  - Best-ball leagues use redraft market values (the closest public
 *    consensus) — the payload says so explicitly rather than pretending a
 *    best-ball-specific chart exists.
 *
 * FAAB has no public market chart, so its conversion is an AF HEURISTIC and is
 * labeled as such everywhere it appears: a full FAAB budget is valued at the
 * market value of the ~150th-ranked asset (a waiver-tier player — what a whole
 * budget typically nets you), scaled linearly. The formula ships in the
 * payload so it can be argued with.
 *
 * Values are cached 6h per format combination. Nothing here is an AF opinion:
 * player/pick numbers are market consensus, and the one heuristic is labeled.
 */

const FC = 'https://api.fantasycalc.com/values/current'
const CACHE_PREFIX = 'market-values:v1:'
const CACHE_TTL_MS = 6 * 60 * 60 * 1000
const FAAB_ANCHOR_RANK = 150

type FcRow = {
  player?: {
    name?: string | null
    sleeperId?: string | null
    position?: string | null
  } | null
  value?: number | null
  redraftValue?: number | null
  overallRank?: number | null
  trend30Day?: number | null
  /** Feed's own dispersion for this valuation, in `value` units. */
  maybeMovingStandardDeviation?: number | null
}

export type MarketValueEntry = {
  name: string
  sleeperId: string | null
  position: string | null
  value: number
  overallRank: number | null
  trend30Day: number | null
  /**
   * How contested this valuation is, in the same units as `value` — the feed's
   * own moving standard deviation across contributing markets.
   *
   * Carried so a consumer can tell a genuine value gap from noise: a 500-point
   * edge between two players whose valuations each swing by 400 is not an edge.
   * Optional because payloads cached before this field existed will not have it,
   * and a missing uncertainty must read as "unknown", not as "zero doubt".
   */
  stdDev?: number | null
}

export type MarketValuesPayload = {
  version: 1
  fetchedAt: string
  source: string
  mode: 'dynasty' | 'redraft'
  bestBallNote: string | null
  numQbs: 1 | 2
  numTeams: number
  ppr: number
  /** Player values keyed by Sleeper player id. */
  bySleeperId: Record<string, MarketValueEntry>
  /** Exact pick values keyed `${season}:${round}.${slot}` (dynasty mode). */
  pickBySlot: Record<string, number>
  /** Round-average pick values keyed `${season}:${round}` (dynasty mode). */
  pickByRound: Record<string, number>
  /** AF heuristic anchor for FAAB conversion + its formula, stated plainly. */
  faab: { anchorRank: number; anchorValue: number | null; formula: string }
}

function cacheKeyFor(mode: string, numQbs: number, numTeams: number, ppr: number): string {
  return `${CACHE_PREFIX}${mode}:${numQbs}qb:${numTeams}t:${ppr}ppr`
}

async function fetchFcRows(
  isDynasty: boolean,
  numQbs: number,
  numTeams: number,
  ppr: number,
): Promise<FcRow[] | null> {
  try {
    const url = `${FC}?isDynasty=${isDynasty}&numQbs=${numQbs}&numTeams=${numTeams}&ppr=${ppr}`
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return null
    const data = (await res.json()) as unknown
    return Array.isArray(data) ? (data as FcRow[]) : null
  } catch {
    return null
  }
}

/** "2026 Pick 1.01" → {season:'2026', round:1, slot:1}; "2027 Round 2" / "2027 2nd" → round only. */
function parsePickName(name: string): { season: string; round: number; slot: number | null } | null {
  const exact = name.match(/^(\d{4})\s+Pick\s+(\d+)\.(\d+)$/i)
  if (exact) return { season: exact[1], round: Number(exact[2]), slot: Number(exact[3]) }
  const roundWord = name.match(/^(\d{4})\s+(?:Round\s+(\d+)|(\d)(?:st|nd|rd|th))$/i)
  if (roundWord) {
    const round = Number(roundWord[2] ?? roundWord[3])
    return Number.isFinite(round) ? { season: roundWord[1], round, slot: null } : null
  }
  return null
}

export async function getMarketValues(
  context: Pick<LeagueContextEnvelope, 'variant' | 'scoring' | 'teams'>,
): Promise<MarketValuesPayload | null> {
  const isDynasty = context.variant.dynasty || context.variant.keeper
  const numQbs: 1 | 2 = context.variant.superflex ? 2 : 1
  const numTeams = Math.min(Math.max(context.teams || 12, 8), 16)
  const ppr = context.scoring.format === 'ppr' ? 1 : context.scoring.format === 'half_ppr' ? 0.5 : 0
  const mode: 'dynasty' | 'redraft' = isDynasty ? 'dynasty' : 'redraft'
  const cacheKey = cacheKeyFor(mode, numQbs, numTeams, ppr)

  const now = new Date()
  const cached = await prisma.sportsDataCache.findUnique({ where: { cacheKey } }).catch(() => null)
  const cachedPayload =
    cached && cached.data && typeof cached.data === 'object'
      ? (cached.data as unknown as MarketValuesPayload)
      : null
  if (cachedPayload?.version === 1 && cached && cached.expiresAt > now) return cachedPayload

  const rows = await fetchFcRows(isDynasty, numQbs, numTeams, ppr)
  if (!rows) return cachedPayload?.version === 1 ? cachedPayload : null

  const bySleeperId: Record<string, MarketValueEntry> = {}
  const pickBySlot: Record<string, number> = {}
  const pickRoundAcc = new Map<string, number[]>()
  let faabAnchorValue: number | null = null
  let bestAnchorDistance = Number.POSITIVE_INFINITY

  for (const r of rows) {
    const name = r.player?.name?.trim()
    const value = typeof r.value === 'number' ? r.value : null
    if (!name || value == null) continue
    const position = r.player?.position?.toUpperCase() ?? null

    if (position === 'PICK') {
      const parsed = parsePickName(name)
      if (parsed) {
        if (parsed.slot != null) {
          pickBySlot[`${parsed.season}:${parsed.round}.${parsed.slot}`] = value
        }
        const rk = `${parsed.season}:${parsed.round}`
        const list = pickRoundAcc.get(rk) ?? []
        list.push(value)
        pickRoundAcc.set(rk, list)
      }
      continue
    }

    const entry: MarketValueEntry = {
      name,
      sleeperId: r.player?.sleeperId ? String(r.player.sleeperId) : null,
      position,
      value,
      overallRank: r.overallRank ?? null,
      trend30Day: r.trend30Day ?? null,
      stdDev:
        typeof r.maybeMovingStandardDeviation === 'number' ? r.maybeMovingStandardDeviation : null,
    }
    if (entry.sleeperId) bySleeperId[entry.sleeperId] = entry
    if (entry.overallRank != null) {
      const dist = Math.abs(entry.overallRank - FAAB_ANCHOR_RANK)
      if (dist < bestAnchorDistance) {
        bestAnchorDistance = dist
        faabAnchorValue = value
      }
    }
  }

  const pickByRound: Record<string, number> = {}
  for (const [key, values] of pickRoundAcc) {
    pickByRound[key] = Math.round(values.reduce((a, b) => a + b, 0) / values.length)
  }

  const fresh: MarketValuesPayload = {
    version: 1,
    fetchedAt: new Date().toISOString(),
    source: 'FantasyCalc market consensus (built from real trades)',
    mode,
    bestBallNote: context.variant.bestBall
      ? 'Best ball: no public best-ball chart exists, so redraft market values are used; weekly-lineup-free formats reward depth — read borderline calls with that lens.'
      : null,
    numQbs,
    numTeams,
    ppr,
    bySleeperId,
    pickBySlot,
    pickByRound,
    faab: {
      anchorRank: FAAB_ANCHOR_RANK,
      anchorValue: faabAnchorValue,
      formula: `AF heuristic (not market data): a FULL FAAB budget ≈ the market value of the ~${FAAB_ANCHOR_RANK}th-ranked asset; $X of a $B budget = (X/B) × that anchor.`,
    },
  }
  await prisma.sportsDataCache
    .upsert({
      where: { cacheKey },
      update: { data: fresh as unknown as object, expiresAt: new Date(now.getTime() + CACHE_TTL_MS) },
      create: { cacheKey, data: fresh as unknown as object, expiresAt: new Date(now.getTime() + CACHE_TTL_MS) },
    })
    .catch(() => null)
  return fresh
}

// ── Lookups ──────────────────────────────────────────────────────────────────
export function playerValue(values: MarketValuesPayload, sleeperId: string): number | null {
  return values.bySleeperId[sleeperId]?.value ?? null
}

/** Pick value: exact slot when known, else that season+round's average. */
export function pickValue(
  values: MarketValuesPayload,
  season: string,
  round: number,
  slot?: number | null,
): number | null {
  if (slot != null) {
    const exact = values.pickBySlot[`${season}:${round}.${slot}`]
    if (exact != null) return exact
  }
  return values.pickByRound[`${season}:${round}`] ?? null
}

/** FAAB → value points via the documented heuristic. Null when no anchor resolved. */
export function faabValue(values: MarketValuesPayload, dollars: number, budget = 100): number | null {
  if (values.faab.anchorValue == null || budget <= 0) return null
  return Math.round((dollars / budget) * values.faab.anchorValue)
}
