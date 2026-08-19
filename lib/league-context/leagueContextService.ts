import 'server-only'

import { prisma } from '@/lib/prisma'

/**
 * leagueContextService — slice 5: the LeagueContext envelope.
 *
 * One object that every engine (Decision OS, draft intel, recommendations)
 * consults BEFORE speaking, built from the league's REAL Sleeper settings:
 *  - scoring_settings verbatim + derived format/emphasis (incl. IDP tackle-heavy
 *    vs big-play read),
 *  - roster_positions → starter shape (DL/LB/DB/IDP_FLEX/SUPER_FLEX aware),
 *  - variant flags (idp / superflex / dynasty / keeper / best-ball),
 *  - the ADP column that actually matches this league's format,
 *  - HOUSE RULES the platform API cannot see (pirate first). House rules are
 *    suggest-then-confirm: a name match only ever produces a `detected`
 *    suggestion; strategy flags activate when a league owner DECLARES the rule.
 *    Declarations persist in SportsDataCache (no schema migration).
 *
 * Honesty contract: everything here is either read from the platform, counted,
 * or explicitly labeled as a detected-but-unconfirmed suggestion.
 */

const SLEEPER = 'https://api.sleeper.app/v1'
const CACHE_PREFIX = 'league-context:v1:'
const RULES_PREFIX = 'league-context:rules:v1:'
const CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6h
const RULES_TTL_MS = 10 * 365 * 24 * 60 * 60 * 1000 // declarations are not a cache

async function j<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${SLEEPER}${path}`, { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

// ── Wire types (consumed subset) ─────────────────────────────────────────────
export type SleeperLeagueWire = {
  league_id: string
  name: string
  season: string
  status: string
  total_rosters: number
  scoring_settings?: Record<string, number> | null
  roster_positions?: string[] | null
  settings?: Record<string, number | undefined> | null
  previous_league_id?: string | null
}

export async function fetchSleeperLeague(sleeperLeagueId: string): Promise<SleeperLeagueWire | null> {
  return j<SleeperLeagueWire>(`/league/${sleeperLeagueId}`)
}

// ── House rules taxonomy ─────────────────────────────────────────────────────
export type HouseRuleId = 'pirate'

export type HouseRuleDeclaration = {
  id: HouseRuleId
  enabled: boolean
  declaredByUserId: string
  declaredAt: string
}

export type PirateStrategy = {
  active: boolean
  source: 'declared' | 'detected'
  flags: {
    floorOverCeiling: true
    concentrationRiskPenalty: true
    weeklyWinsCompound: true
  }
  lines: string[]
}

const PIRATE_LINES: string[] = [
  'Every matchup win steals a player from the loser — weekly wins compound into roster value, so the projected weekly FLOOR outranks season-long ceiling.',
  'Losing a week costs a player: boom/bust rosters hand their best assets to whoever beats them on a bust week. Prefer consistent scorers.',
  'Concentration is risk: value stacked in one or two studs is exactly what an opponent steals. Spread value across the lineup.',
]

// ── Envelope ─────────────────────────────────────────────────────────────────
export type IdpEmphasis = 'tackle-heavy' | 'big-play' | 'balanced'

export type LeagueContextEnvelope = {
  version: 1
  fetchedAt: string
  sleeperLeagueId: string
  name: string
  season: string
  status: string
  teams: number
  variant: {
    idp: boolean
    superflex: boolean
    dynasty: boolean
    keeper: boolean
    bestBall: boolean
  }
  roster: {
    positions: string[]
    starters: Record<string, number>
    starterCount: number
    bench: number
  }
  scoring: {
    settings: Record<string, number>
    receptionWeight: number
    format: 'ppr' | 'half_ppr' | 'std'
    idp: {
      present: boolean
      tacklePts: number
      sackPts: number
      intPts: number
      emphasis: IdpEmphasis | null
    }
  }
  /** The adp_* column in the RotoWire/Sleeper projections feed matching this league. */
  adpKey: string
  adpKeyLabel: string
  houseRules: {
    declared: HouseRuleDeclaration[]
    detected: { id: HouseRuleId; evidence: string }[]
    pirate: PirateStrategy | null
  }
  /** Names anything upstream refused to give us. */
  missing: string[]
}

const NON_STARTER = new Set(['BN', 'TAXI', 'IR'])
const IDP_SLOTS = new Set(['DL', 'LB', 'DB', 'IDP_FLEX', 'DE', 'DT', 'CB', 'S'])

function deriveFormat(rec: number): 'ppr' | 'half_ppr' | 'std' {
  if (rec >= 0.75) return 'ppr'
  if (rec >= 0.25) return 'half_ppr'
  return 'std'
}

function deriveIdpEmphasis(tackle: number, sack: number, int_: number): IdpEmphasis {
  const bigPlay = Math.max(sack, int_)
  if (tackle <= 0) return 'big-play'
  const ratio = bigPlay / tackle
  if (ratio >= 5) return 'big-play'
  if (ratio <= 2.5) return 'tackle-heavy'
  return 'balanced'
}

function pickAdpKey(v: LeagueContextEnvelope['variant'], format: 'ppr' | 'half_ppr' | 'std'): { key: string; label: string } {
  if (v.idp) {
    return v.superflex
      ? { key: 'adp_idp', label: 'IDP superflex ADP' }
      : { key: 'adp_idp_1qb', label: 'IDP 1-QB ADP' }
  }
  if (v.dynasty) {
    if (v.superflex) return { key: 'adp_dynasty_2qb', label: 'Dynasty superflex ADP' }
    if (format === 'ppr') return { key: 'adp_dynasty_ppr', label: 'Dynasty PPR ADP' }
    if (format === 'half_ppr') return { key: 'adp_dynasty_half_ppr', label: 'Dynasty half-PPR ADP' }
    return { key: 'adp_dynasty_std', label: 'Dynasty standard ADP' }
  }
  if (v.superflex) return { key: 'adp_2qb', label: 'Superflex ADP' }
  if (format === 'ppr') return { key: 'adp_ppr', label: 'PPR ADP' }
  if (format === 'half_ppr') return { key: 'adp_half_ppr', label: 'Half-PPR ADP' }
  return { key: 'adp_std', label: 'Standard ADP' }
}

// ── Declarations (SportsDataCache, no migration) ─────────────────────────────
type RulesRecord = { version: 1; rules: HouseRuleDeclaration[] }

export async function getDeclaredHouseRules(sleeperLeagueId: string): Promise<HouseRuleDeclaration[]> {
  const row = await prisma.sportsDataCache
    .findUnique({ where: { cacheKey: `${RULES_PREFIX}${sleeperLeagueId}` } })
    .catch(() => null)
  const data = row?.data as unknown as RulesRecord | null
  return data?.version === 1 && Array.isArray(data.rules) ? data.rules : []
}

export async function declareHouseRule(
  sleeperLeagueId: string,
  ruleId: HouseRuleId,
  enabled: boolean,
  declaredByUserId: string,
): Promise<HouseRuleDeclaration[]> {
  const current = await getDeclaredHouseRules(sleeperLeagueId)
  const next: HouseRuleDeclaration[] = [
    ...current.filter((r) => r.id !== ruleId),
    { id: ruleId, enabled, declaredByUserId, declaredAt: new Date().toISOString() },
  ]
  const cacheKey = `${RULES_PREFIX}${sleeperLeagueId}`
  const data = { version: 1, rules: next } as unknown as object
  const expiresAt = new Date(Date.now() + RULES_TTL_MS)
  await prisma.sportsDataCache.upsert({
    where: { cacheKey },
    update: { data, expiresAt },
    create: { cacheKey, data, expiresAt },
  })
  // A declaration changes strategy flags — drop the envelope cache immediately.
  await prisma.sportsDataCache
    .delete({ where: { cacheKey: `${CACHE_PREFIX}${sleeperLeagueId}` } })
    .catch(() => null)
  return next
}

// ── Build ────────────────────────────────────────────────────────────────────
function buildEnvelope(
  league: SleeperLeagueWire,
  declared: HouseRuleDeclaration[],
): LeagueContextEnvelope {
  const missing: string[] = []
  const scoringSettings = league.scoring_settings ?? {}
  if (!league.scoring_settings) missing.push('scoring settings')
  const positions = league.roster_positions ?? []
  if (!league.roster_positions) missing.push('roster positions')

  const starters: Record<string, number> = {}
  let bench = 0
  for (const p of positions) {
    if (NON_STARTER.has(p)) {
      if (p === 'BN') bench += 1
      continue
    }
    starters[p] = (starters[p] ?? 0) + 1
  }
  const starterCount = Object.values(starters).reduce((a, b) => a + b, 0)

  const idpPresent = positions.some((p) => IDP_SLOTS.has(p))
  const superflex = positions.includes('SUPER_FLEX')
  const type = league.settings?.type ?? 0
  const variant = {
    idp: idpPresent,
    superflex,
    dynasty: type === 2,
    keeper: type === 1,
    bestBall: (league.settings?.best_ball ?? 0) === 1,
  }

  const rec = scoringSettings.rec ?? 0
  const format = deriveFormat(rec)
  const tacklePts = (scoringSettings.idp_tkl ?? 0) + (scoringSettings.idp_tkl_solo ?? 0)
  const sackPts = scoringSettings.idp_sack ?? 0
  const intPts = scoringSettings.idp_int ?? 0
  const adp = pickAdpKey(variant, format)

  // House rules: name-based DETECTION is only ever a suggestion.
  const detected: { id: HouseRuleId; evidence: string }[] = []
  if (/pirate/i.test(league.name)) {
    detected.push({ id: 'pirate', evidence: `league name contains “pirate” (“${league.name}”)` })
  }
  const pirateDeclared = declared.find((r) => r.id === 'pirate')
  const pirateDetected = detected.find((d) => d.id === 'pirate')
  const pirate: PirateStrategy | null =
    pirateDeclared?.enabled === true
      ? {
          active: true,
          source: 'declared',
          flags: { floorOverCeiling: true, concentrationRiskPenalty: true, weeklyWinsCompound: true },
          lines: PIRATE_LINES,
        }
      : pirateDeclared?.enabled === false
        ? null // explicitly declared NOT a pirate league — suppress the suggestion too
        : pirateDetected
          ? {
              active: false,
              source: 'detected',
              flags: { floorOverCeiling: true, concentrationRiskPenalty: true, weeklyWinsCompound: true },
              lines: PIRATE_LINES,
            }
          : null

  return {
    version: 1,
    fetchedAt: new Date().toISOString(),
    sleeperLeagueId: league.league_id,
    name: league.name,
    season: league.season,
    status: league.status,
    teams: league.total_rosters,
    variant,
    roster: { positions, starters, starterCount, bench },
    scoring: {
      settings: scoringSettings,
      receptionWeight: rec,
      format,
      idp: {
        present: idpPresent,
        tacklePts,
        sackPts,
        intPts,
        emphasis: idpPresent ? deriveIdpEmphasis(tacklePts, sackPts, intPts) : null,
      },
    },
    adpKey: adp.key,
    adpKeyLabel: adp.label,
    houseRules: {
      declared,
      detected: pirateDeclared?.enabled === false ? [] : detected,
      pirate,
    },
    missing,
  }
}

/** Cached accessor. Declarations are read fresh every call (they're tiny and authoritative). */
export async function getLeagueContext(sleeperLeagueId: string): Promise<LeagueContextEnvelope | null> {
  const cacheKey = `${CACHE_PREFIX}${sleeperLeagueId}`
  const now = new Date()
  const declared = await getDeclaredHouseRules(sleeperLeagueId)

  const cached = await prisma.sportsDataCache.findUnique({ where: { cacheKey } }).catch(() => null)
  const cachedPayload =
    cached && cached.data && typeof cached.data === 'object'
      ? (cached.data as unknown as LeagueContextEnvelope)
      : null
  if (cachedPayload?.version === 1 && cached && cached.expiresAt > now) {
    // Rebuild the house-rule view over the cached platform snapshot so a fresh
    // declaration is reflected without waiting out the TTL.
    return buildEnvelope(
      {
        league_id: cachedPayload.sleeperLeagueId,
        name: cachedPayload.name,
        season: cachedPayload.season,
        status: cachedPayload.status,
        total_rosters: cachedPayload.teams,
        scoring_settings: cachedPayload.scoring.settings,
        roster_positions: cachedPayload.roster.positions,
        settings: {
          type: cachedPayload.variant.dynasty ? 2 : cachedPayload.variant.keeper ? 1 : 0,
          best_ball: cachedPayload.variant.bestBall ? 1 : 0,
        },
      },
      declared,
    )
  }

  const league = await fetchSleeperLeague(sleeperLeagueId)
  if (!league) {
    return cachedPayload?.version === 1 ? buildEnvelope(
      {
        league_id: cachedPayload.sleeperLeagueId,
        name: cachedPayload.name,
        season: cachedPayload.season,
        status: cachedPayload.status,
        total_rosters: cachedPayload.teams,
        scoring_settings: cachedPayload.scoring.settings,
        roster_positions: cachedPayload.roster.positions,
        settings: {
          type: cachedPayload.variant.dynasty ? 2 : cachedPayload.variant.keeper ? 1 : 0,
          best_ball: cachedPayload.variant.bestBall ? 1 : 0,
        },
      },
      declared,
    ) : null
  }

  const fresh = buildEnvelope(league, declared)
  await prisma.sportsDataCache
    .upsert({
      where: { cacheKey },
      update: { data: fresh as unknown as object, expiresAt: new Date(now.getTime() + CACHE_TTL_MS) },
      create: { cacheKey, data: fresh as unknown as object, expiresAt: new Date(now.getTime() + CACHE_TTL_MS) },
    })
    .catch((err) => {
      console.error('[league-context] cache write failed (serving live result)', { sleeperLeagueId, err })
    })
  return fresh
}
