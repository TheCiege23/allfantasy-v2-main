// CFB Player Data - Integrates with CollegeFootballData.com API for devy player info
import { prisma } from '@/lib/prisma'
import { getCfbdApiKey } from '@/lib/cfbd-env'
import { cfbdGet, describeCfbdFailure, CFBD_BASE_URL, type CfbdResult } from '@/lib/cfbd-fetch'

export interface CFBPlayer {
  id: number
  firstName: string
  lastName: string
  fullName: string
  team: string
  position: string
  jersey: number | null
  year: number | null  // 1=FR, 2=SO, 3=JR, 4=SR, 5=5th
  height: number | null
  weight: number | null
  hometown: string | null
  homeState: string | null
  homeCountry: string | null
}

export interface CFBPlayerStats {
  playerId: number
  playerName: string
  team: string
  position: string
  passingYards: number
  passingTDs: number
  rushingYards: number
  rushingTDs: number
  receivingYards: number
  receivingTDs: number
  receptions: number
}

export interface DevyPlayerValue {
  name: string
  team: string
  position: string
  classYear: string // FR, SO, JR, SR
  /**
   * Devy points from the ranked board, or NULL when the player is not ranked.
   *
   * ⚠ NULL, NEVER 0 — that distinction is the whole point. This used to carry
   * `DevyPlayer.devyValue`, a position-and-class-year lookup that is 0 for 1,237
   * of 1,718 rows, so "no data" and "worthless" were the same number and a
   * consumer could not tell a freshman nobody has scouted from a player the
   * board actively rates at nothing.
   *
   * `lib/devy/devyValueBoard.ts` is the authority and states the same rule.
   */
  devyValue: number | null
  /** 1 = best devy asset on the board. Null when unranked. */
  devyRank?: number | null
  projectedNFLValue: number | null
  draftEligibleYear: number
  projectedRound: number | null
  trend: 'rising' | 'falling' | 'stable'
  notes: string | null
}

const CFBD_BASE = CFBD_BASE_URL

/**
 * Quota/credential guard for the fetchers NOT YET converted to `cfbdGet`.
 *
 * `lib/cfbd-fetch.ts` is the better answer and where these should all end up:
 * it returns a discriminated `CfbdResult` so a caller must SAY what it does when
 * the answer is "we could not ask". Two functions have moved
 * (`getCFBDraftPicksResult`, `getCFBTeamRosterResult`); ELEVEN below still
 * answer `!response.ok` with `return []`, which makes a 429 quota wall
 * indistinguishable from "this team has no players".
 *
 * That conflation is live, not theoretical: on 2026-08-25 the key returned
 * `429 {"message":"Monthly call quota exceeded."}` for every endpoint and the
 * roster ingest reported `upserted: 0, errors: 0` — a clean, healthy-looking
 * zero for a provider answering nothing at all.
 *
 * So the eleven throw instead. 401/403/429 are never a legitimate empty result;
 * a 404 or a genuinely empty array still falls through to `[]`. This is a
 * stopgap that keeps those callers honest until they move to `cfbdGet` too —
 * delete it as each one migrates.
 *
 * The message deliberately carries no URL or body: the key travels in a header,
 * but query strings can carry identifying params and this string reaches logs.
 */
const CFBD_NEVER_EMPTY_STATUSES = new Set([401, 403, 429])

export class CfbdUnavailableError extends Error {
  constructor(public readonly status: number) {
    super(
      status === 429
        ? 'CFBD refused the request: quota or rate limit exceeded (HTTP 429)'
        : `CFBD refused the request: credential rejected (HTTP ${status})`,
    )
    this.name = 'CfbdUnavailableError'
  }
}

function assertCfbdAvailable(response: { status: number; ok: boolean }): void {
  if (!response.ok && CFBD_NEVER_EMPTY_STATUSES.has(response.status)) {
    throw new CfbdUnavailableError(response.status)
  }
}

function getClassYearString(year: number | null): string {
  switch (year) {
    case 1: return 'FR'
    case 2: return 'SO'
    case 3: return 'JR'
    case 4: return 'SR'
    case 5: return '5th'
    default: return 'Unknown'
  }
}

function calculateDraftEligibleYear(classYear: number | null): number {
  const currentYear = new Date().getFullYear()
  if (!classYear) return currentYear + 3
  
  // Players are draft eligible 3 years after high school
  // FR (1) = 3 more years, SO (2) = 2 more, JR (3) = 1 more, SR (4) = this year
  const yearsRemaining = Math.max(0, 4 - classYear)
  return currentYear + yearsRemaining
}

// Calculate devy value based on position, class year, and projected draft capital
function calculateDevyValue(
  position: string,
  classYear: number | null,
  projectedRound: number | null,
  stats?: { passingYards?: number; rushingYards?: number; receivingYards?: number; receptions?: number }
): number {
  const baseValues: Record<string, number> = {
    QB: 6000,
    RB: 4500,
    WR: 5000,
    TE: 3500,
    OL: 1500,
    DL: 1500,
    LB: 1500,
    DB: 1500,
    K: 500,
    P: 300,
  }

  let baseValue = baseValues[position] || 2000

  // Class year multiplier - underclassmen are more valuable in devy
  const classMultipliers: Record<number, number> = {
    1: 1.4,  // FR - high upside
    2: 1.3,  // SO - still developing
    3: 1.1,  // JR - approaching draft
    4: 1.0,  // SR - draft year
    5: 0.9,  // 5th year
  }
  baseValue *= classMultipliers[classYear || 4] || 1.0

  // Projected draft round multiplier
  if (projectedRound) {
    const roundMultipliers: Record<number, number> = {
      1: 1.8,  // 1st round
      2: 1.4,  // 2nd round
      3: 1.1,  // 3rd round
      4: 0.9,  // 4th round
      5: 0.7,  // 5th round
      6: 0.5,  // 6th round
      7: 0.3,  // 7th round
    }
    baseValue *= roundMultipliers[projectedRound] || 0.5
  }

  // Stats boost
  if (stats) {
    if (position === 'QB' && stats.passingYards) {
      baseValue += Math.min(stats.passingYards / 100, 1500)
    }
    if ((position === 'RB') && stats.rushingYards) {
      baseValue += Math.min(stats.rushingYards / 50, 1200)
    }
    if ((position === 'WR' || position === 'TE') && stats.receivingYards) {
      baseValue += Math.min(stats.receivingYards / 50, 1200)
    }
  }

  return Math.round(baseValue)
}

export async function searchCFBPlayers(searchTerm: string): Promise<CFBPlayer[]> {
  const apiKey = getCfbdApiKey()
  if (!apiKey) {
    console.error('CFBD key not found')
    return []
  }

  try {
    const response = await fetch(
      `${CFBD_BASE}/player/search?searchTerm=${encodeURIComponent(searchTerm)}`,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json',
        },
      }
    )

    assertCfbdAvailable(response)
    if (!response.ok) {
      console.error('CFBD player search failed:', response.status)
      return []
    }

    const data = await response.json()
    return data.map((p: any) => {
      const fn = p.firstName || p.first_name || ''
      const ln = p.lastName || p.last_name || ''
      return {
        id: p.id,
        firstName: fn,
        lastName: ln,
        fullName: `${fn} ${ln}`,
        team: p.team,
        position: p.position,
        jersey: p.jersey,
        year: p.year,
        height: p.height,
        weight: p.weight,
        hometown: p.homeCity || p.hometown || null,
        homeState: p.homeState || p.home_state || null,
        homeCountry: p.homeCountry || p.home_country || null,
      }
    })
  } catch (error) {
    // A quota/credential refusal is not "no data" — let it out so the caller
    // records a real error instead of an empty, healthy-looking result.
    if (error instanceof CfbdUnavailableError) throw error
    console.error('CFBD player search error:', error)
    return []
  }
}

export async function getCFBPlayerStats(year: number, team?: string): Promise<CFBPlayerStats[]> {
  const apiKey = getCfbdApiKey()
  if (!apiKey) return []

  try {
    let url = `${CFBD_BASE}/stats/player/season?year=${year}`
    if (team) url += `&team=${encodeURIComponent(team)}`

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
      },
    })

    assertCfbdAvailable(response)
    if (!response.ok) return []

    const data = await response.json()
    
    // Aggregate stats by player
    const playerMap = new Map<string, CFBPlayerStats>()
    
    for (const stat of data) {
      const key = `${stat.player}-${stat.team}`
      if (!playerMap.has(key)) {
        playerMap.set(key, {
          playerId: stat.playerId,
          playerName: stat.player,
          team: stat.team,
          position: stat.category === 'passing' ? 'QB' : 
                   stat.category === 'rushing' ? 'RB' :
                   stat.category === 'receiving' ? 'WR' : '',
          passingYards: 0,
          passingTDs: 0,
          rushingYards: 0,
          rushingTDs: 0,
          receivingYards: 0,
          receivingTDs: 0,
          receptions: 0,
        })
      }
      
      const player = playerMap.get(key)!
      
      if (stat.statType === 'YDS') {
        if (stat.category === 'passing') player.passingYards = parseInt(stat.stat) || 0
        if (stat.category === 'rushing') player.rushingYards = parseInt(stat.stat) || 0
        if (stat.category === 'receiving') player.receivingYards = parseInt(stat.stat) || 0
      }
      if (stat.statType === 'TD') {
        if (stat.category === 'passing') player.passingTDs = parseInt(stat.stat) || 0
        if (stat.category === 'rushing') player.rushingTDs = parseInt(stat.stat) || 0
        if (stat.category === 'receiving') player.receivingTDs = parseInt(stat.stat) || 0
      }
      if (stat.statType === 'REC') {
        player.receptions = parseInt(stat.stat) || 0
      }
    }

    return Array.from(playerMap.values())
  } catch (error) {
    // A quota/credential refusal is not "no data" — let it out so the caller
    // records a real error instead of an empty, healthy-looking result.
    if (error instanceof CfbdUnavailableError) throw error
    console.error('CFBD stats error:', error)
    return []
  }
}

export interface CFBDraftPick {
  collegeId: number | null
  collegeName: string
  collegeTeam: string
  collegeConference: string | null
  nflTeam: string
  year: number
  round: number
  pick: number
  overallPick: number
  position: string
  playerName: string
  height: number | null
  weight: number | null
}

function mapDraftPick(p: any): CFBDraftPick {
  return {
    collegeId: p.collegeAthleteId || p.collegeId || null,
    collegeName: p.name || '',
    collegeTeam: p.collegeTeam || p.college || '',
    collegeConference: p.collegeConference || null,
    nflTeam: p.nflTeam || '',
    year: p.year,
    round: p.round,
    pick: p.pick,
    overallPick: p.overall || p.pick,
    position: p.position || '',
    playerName: p.name || '',
    height: p.height || null,
    weight: p.weight || null,
  }
}

/**
 * Draft picks, with a failed request kept distinct from an empty draft class.
 *
 * ⚠ PREFER THIS ANYWHERE THE ANSWER GETS WRITTEN DOWN. The plain version below
 * still collapses a failure into `[]` for its existing callers, and "nobody was
 * drafted" is a conclusion no caller should reach by being rate limited. See
 * lib/cfbd-fetch.ts.
 */
export async function getCFBDraftPicksResult(
  year: number,
  college?: string,
): Promise<CfbdResult<CFBDraftPick[]>> {
  let path = `/draft/picks?year=${year}`
  if (college) path += `&college=${encodeURIComponent(college)}`

  const res = await cfbdGet<unknown>(path, getCfbdApiKey())
  if (!res.ok) return res
  if (!Array.isArray(res.data)) {
    return {
      ok: false,
      failure: { kind: 'http', status: null, message: 'CFBD draft picks was not an array', path },
    }
  }
  return { ok: true, data: res.data.map(mapDraftPick) }
}

export async function getCFBDraftPicks(year: number, college?: string): Promise<CFBDraftPick[]> {
  const res = await getCFBDraftPicksResult(year, college)
  if (!res.ok) {
    console.error('[CFBD] Draft picks fetch failed:', describeCfbdFailure(res.failure))
    return []
  }
  return res.data
}

/**
 * A team's roster, with a failed request kept distinct from an empty roster.
 *
 * ⚠ THE CLASSIFIER TREATS ABSENCE FROM THIS LIST AS EVIDENCE. If the request
 * merely failed, "not on a current roster" becomes a fact about the network
 * rather than the player, and lib/devy-classification.ts writes it down.
 */
export async function getCFBTeamRosterResult(
  team: string,
  year?: number,
): Promise<CfbdResult<CFBPlayer[]>> {
  const rosterYear = year || new Date().getFullYear()
  const path = `/roster?team=${encodeURIComponent(team)}&year=${rosterYear}`

  const res = await cfbdGet<unknown>(path, getCfbdApiKey())
  if (!res.ok) return res
  if (!Array.isArray(res.data)) {
    return {
      ok: false,
      failure: { kind: 'http', status: null, message: 'CFBD roster was not an array', path },
    }
  }
  return { ok: true, data: mapRoster(res.data, team) }
}

function mapRoster(data: any[], team: string): CFBPlayer[] {
  return data
      .filter((p: any) => {
        const fn = p.firstName || p.first_name
        const ln = p.lastName || p.last_name
        return fn && ln && fn !== 'undefined' && ln !== 'undefined'
      })
      .map((p: any) => {
        const fn = p.firstName || p.first_name || ''
        const ln = p.lastName || p.last_name || ''
        return {
          id: p.id,
          firstName: fn,
          lastName: ln,
          fullName: `${fn} ${ln}`,
          team: team,
          position: p.position,
          jersey: p.jersey,
          year: p.year,
          height: p.height,
          weight: p.weight,
          hometown: p.homeCity || p.home_town || null,
          homeState: p.homeState || p.home_state || null,
          homeCountry: p.homeCountry || p.home_country || null,
        }
      })
}

export async function getCFBTeamRoster(team: string, year?: number): Promise<CFBPlayer[]> {
  const res = await getCFBTeamRosterResult(team, year)
  if (!res.ok) {
    console.error('CFBD roster error:', describeCfbdFailure(res.failure))
    return []
  }
  return res.data
}

export function enrichFantraxPlayerWithDevyValue(
  player: { name: string; position: string; nflTeam: string; year?: string },
  stats?: CFBPlayerStats,
  projectedRound?: number
): DevyPlayerValue {
  // Parse class year from string like "JR", "SR", etc.
  const classYearMap: Record<string, number> = {
    'FR': 1, 'Freshman': 1, '1': 1,
    'SO': 2, 'Sophomore': 2, '2': 2,
    'JR': 3, 'Junior': 3, '3': 3,
    'SR': 4, 'Senior': 4, '4': 4,
    '5th': 5, 'RS': 4, 'Redshirt': 4,
  }
  
  const classYearNum = classYearMap[player.year || 'JR'] || 3
  const classYear = getClassYearString(classYearNum)
  
  const devyValue = calculateDevyValue(
    player.position,
    classYearNum,
    projectedRound || null,
    stats ? {
      passingYards: stats.passingYards,
      rushingYards: stats.rushingYards,
      receivingYards: stats.receivingYards,
      receptions: stats.receptions,
    } : undefined
  )

  // Estimate projected NFL value (roughly 1.5-2x devy value for top prospects)
  const projectedNFLValue = projectedRound && projectedRound <= 3 
    ? Math.round(devyValue * 1.8)
    : null

  return {
    name: player.name,
    team: player.nflTeam, // In devy context, this is the college team
    position: player.position,
    classYear,
    devyValue,
    projectedNFLValue,
    draftEligibleYear: calculateDraftEligibleYear(classYearNum),
    projectedRound: projectedRound || null,
    trend: 'stable',
    notes: null,
  }
}

// Get devy values for a list of player names
export async function getDevyValuesForPlayers(
  players: Array<{ name: string; position: string; team: string; year?: string }>
): Promise<DevyPlayerValue[]> {
  const results: DevyPlayerValue[] = []

  for (const player of players) {
    // Search for player in CFBD to get accurate info
    const cfbResults = await searchCFBPlayers(player.name)
    const cfbPlayer = cfbResults.find(p => 
      p.fullName.toLowerCase() === player.name.toLowerCase() ||
      `${p.firstName} ${p.lastName}`.toLowerCase() === player.name.toLowerCase()
    )

    if (cfbPlayer) {
      const devyValue = calculateDevyValue(
        cfbPlayer.position || player.position,
        cfbPlayer.year,
        null // No projected round data from CFBD
      )

      results.push({
        name: cfbPlayer.fullName,
        team: cfbPlayer.team,
        position: cfbPlayer.position || player.position,
        classYear: getClassYearString(cfbPlayer.year),
        devyValue,
        projectedNFLValue: null,
        draftEligibleYear: calculateDraftEligibleYear(cfbPlayer.year),
        projectedRound: null,
        trend: 'stable',
        notes: null,
      })
    } else {
      // Use provided data if CFBD search fails
      results.push(enrichFantraxPlayerWithDevyValue(
        { name: player.name, position: player.position, nflTeam: player.team, year: player.year }
      ))
    }
  }

  return results
}

// Batch fetch for performance - get all players from a team
export async function getTeamDevyRoster(team: string, year?: number): Promise<DevyPlayerValue[]> {
  const roster = await getCFBTeamRoster(team, year)
  
  return roster
    .filter(p => ['QB', 'RB', 'WR', 'TE'].includes(p.position))
    .map(p => ({
      name: p.fullName,
      team: p.team,
      position: p.position,
      classYear: getClassYearString(p.year),
      devyValue: calculateDevyValue(p.position, p.year, null),
      projectedNFLValue: null,
      draftEligibleYear: calculateDraftEligibleYear(p.year),
      projectedRound: null,
      trend: 'stable' as const,
      notes: null,
    }))
}

// ──────────────────────────────────────────────────────────────────
// CFBD v2 Caching Layer
// ──────────────────────────────────────────────────────────────────

async function getCachedOrFetch<T>(cacheKey: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T | null> {
  try {
    const cached = await prisma.sportsDataCache.findUnique({ where: { cacheKey } })
    if (cached && cached.expiresAt > new Date()) {
      return cached.data as T
    }
  } catch {}

  try {
    const data = await fetcher()
    if (data !== null && data !== undefined) {
      const expiresAt = new Date(Date.now() + ttlMs)
      await prisma.sportsDataCache.upsert({
        where: { cacheKey },
        create: { cacheKey, data: data as any, expiresAt },
        update: { data: data as any, expiresAt },
      })
    }
    return data
  } catch (err) {
    // Same reason: a refusal must not be laundered into `null` and read as
    // "this endpoint has nothing". Nothing is cached on this path.
    if (err instanceof CfbdUnavailableError) throw err
    console.error(`[CFBD Cache] Fetch failed for ${cacheKey}:`, err)
    return null
  }
}

const ONE_HOUR = 3600_000
const ONE_DAY = 86_400_000
const SEVEN_DAYS = 7 * ONE_DAY
const THIRTY_DAYS = 30 * ONE_DAY

// ──────────────────────────────────────────────────────────────────
// CFBD v2: Recruiting Data
// ──────────────────────────────────────────────────────────────────

export interface CFBRecruit {
  id: number | null
  athleteId: number | null
  recruitType: string
  year: number
  ranking: number | null
  name: string
  school: string | null
  committedTo: string | null
  position: string | null
  height: number | null
  weight: number | null
  stars: number
  rating: number
  city: string | null
  stateProvince: string | null
  country: string | null
}

export async function getCFBRecruits(year: number, team?: string, position?: string): Promise<CFBRecruit[]> {
  const apiKey = getCfbdApiKey()
  if (!apiKey) return []

  const cacheKey = `cfbd-recruits-${year}-${team || 'all'}-${position || 'all'}`

  const result = await getCachedOrFetch<CFBRecruit[]>(cacheKey, SEVEN_DAYS, async () => {
    let url = `${CFBD_BASE}/recruiting/players?year=${year}`
    if (team) url += `&team=${encodeURIComponent(team)}`
    if (position) url += `&position=${encodeURIComponent(position)}`

    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' },
    })

    assertCfbdAvailable(response)
    if (!response.ok) {
      console.error('[CFBD] Recruiting fetch failed:', response.status)
      return []
    }

    const data = await response.json()
    return data.map((r: any) => ({
      id: r.id ?? null,
      athleteId: r.athleteId ?? null,
      recruitType: r.recruitType || 'HighSchool',
      year: r.year,
      ranking: r.ranking ?? null,
      name: r.name || '',
      school: r.school ?? null,
      committedTo: r.committedTo ?? null,
      position: r.position ?? null,
      height: r.height ?? null,
      weight: r.weight ?? null,
      stars: r.stars ?? 0,
      rating: r.rating ?? 0,
      city: r.city ?? null,
      stateProvince: r.stateProvince ?? null,
      country: r.country ?? null,
    }))
  })

  return result || []
}

export async function getCFBTeamRecruitingRankings(year: number, team?: string): Promise<Array<{
  year: number
  team: string
  rank: number
  points: number
}>> {
  const apiKey = getCfbdApiKey()
  if (!apiKey) return []

  const cacheKey = `cfbd-recruiting-team-${year}-${team || 'all'}`

  const result = await getCachedOrFetch(cacheKey, THIRTY_DAYS, async () => {
    let url = `${CFBD_BASE}/recruiting/teams?year=${year}`
    if (team) url += `&team=${encodeURIComponent(team)}`

    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' },
    })
    assertCfbdAvailable(response)
    if (!response.ok) return []

    const data = await response.json()
    return data.map((r: any) => ({
      year: r.year,
      team: r.team || '',
      rank: r.rank ?? 999,
      points: r.points ?? 0,
    }))
  })

  return result || []
}

// ──────────────────────────────────────────────────────────────────
// CFBD v2: Transfer Portal
// ──────────────────────────────────────────────────────────────────

export interface CFBTransferPortalEntry {
  firstName: string
  lastName: string
  fullName: string
  position: string
  origin: string
  destination: string | null
  transferDate: string | null
  rating: number | null
  stars: number | null
  eligibility: string | null
  season: number
}

export async function getCFBTransferPortal(year: number): Promise<CFBTransferPortalEntry[]> {
  const apiKey = getCfbdApiKey()
  if (!apiKey) return []

  const cacheKey = `cfbd-transfer-portal-${year}`

  const result = await getCachedOrFetch<CFBTransferPortalEntry[]>(cacheKey, ONE_DAY, async () => {
    const response = await fetch(`${CFBD_BASE}/player/portal?year=${year}`, {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' },
    })

    assertCfbdAvailable(response)
    if (!response.ok) {
      console.error('[CFBD] Transfer portal fetch failed:', response.status)
      return []
    }

    const data = await response.json()
    return data.map((t: any) => ({
      firstName: t.firstName || t.first_name || '',
      lastName: t.lastName || t.last_name || '',
      fullName: `${t.firstName || t.first_name || ''} ${t.lastName || t.last_name || ''}`.trim(),
      position: t.position || '',
      origin: t.origin || '',
      destination: t.destination ?? null,
      transferDate: t.transferDate ?? null,
      rating: t.rating ?? null,
      stars: t.stars ?? null,
      eligibility: t.eligibility ?? null,
      season: t.season || year,
    }))
  })

  return result || []
}

// ──────────────────────────────────────────────────────────────────
// CFBD v2: Returning Production
// ──────────────────────────────────────────────────────────────────

export interface CFBReturningProduction {
  team: string
  conference: string | null
  season: number
  totalPPA: number | null
  totalPassingPPA: number | null
  totalRushingPPA: number | null
  totalReceivingPPA: number | null
  percentPPA: number | null
  percentPassingPPA: number | null
  percentRushingPPA: number | null
  percentReceivingPPA: number | null
  usage: number | null
  passingUsage: number | null
  rushingUsage: number | null
  receivingUsage: number | null
}

export async function getCFBReturningProduction(year: number, team?: string): Promise<CFBReturningProduction[]> {
  const apiKey = getCfbdApiKey()
  if (!apiKey) return []

  const cacheKey = `cfbd-returning-prod-${year}-${team || 'all'}`

  const result = await getCachedOrFetch<CFBReturningProduction[]>(cacheKey, ONE_DAY, async () => {
    let url = `${CFBD_BASE}/player/returning?year=${year}`
    if (team) url += `&team=${encodeURIComponent(team)}`

    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' },
    })
    assertCfbdAvailable(response)
    if (!response.ok) return []

    const data = await response.json()
    return data.map((r: any) => ({
      team: r.team || '',
      conference: r.conference ?? null,
      season: r.season || year,
      totalPPA: r.totalPPA ?? null,
      totalPassingPPA: r.totalPassingPPA ?? null,
      totalRushingPPA: r.totalRushingPPA ?? null,
      totalReceivingPPA: r.totalReceivingPPA ?? null,
      percentPPA: r.percentPPA ?? null,
      percentPassingPPA: r.percentPassingPPA ?? null,
      percentRushingPPA: r.percentRushingPPA ?? null,
      percentReceivingPPA: r.percentReceivingPPA ?? null,
      usage: r.usage ?? null,
      passingUsage: r.passingUsage ?? null,
      rushingUsage: r.rushingUsage ?? null,
      receivingUsage: r.receivingUsage ?? null,
    }))
  })

  return result || []
}

// ──────────────────────────────────────────────────────────────────
// CFBD v2: Player Usage & PPA
// ──────────────────────────────────────────────────────────────────

export interface CFBPlayerUsage {
  season: number
  id: number | null
  name: string
  position: string
  team: string
  conference: string | null
  upiOverall: number | null
  upiPass: number | null
  upiRush: number | null
}

export async function getCFBPlayerUsage(year: number, team?: string, position?: string): Promise<CFBPlayerUsage[]> {
  const apiKey = getCfbdApiKey()
  if (!apiKey) return []

  const cacheKey = `cfbd-player-usage-${year}-${team || 'all'}-${position || 'all'}`

  const result = await getCachedOrFetch<CFBPlayerUsage[]>(cacheKey, ONE_DAY, async () => {
    let url = `${CFBD_BASE}/player/usage?year=${year}`
    if (team) url += `&team=${encodeURIComponent(team)}`
    if (position) url += `&position=${encodeURIComponent(position)}`

    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' },
    })
    assertCfbdAvailable(response)
    if (!response.ok) return []

    const data = await response.json()
    return data.map((u: any) => ({
      season: u.season || year,
      id: u.id ?? null,
      name: u.name || '',
      position: u.position || '',
      team: u.team || '',
      conference: u.conference ?? null,
      upiOverall: u.usage?.overall ?? null,
      upiPass: u.usage?.pass ?? null,
      upiRush: u.usage?.rush ?? null,
    }))
  })

  return result || []
}

export interface CFBPlayerPPA {
  season: number
  id: number | null
  name: string
  position: string
  team: string
  conference: string | null
  countablePlays: number | null
  averagePPAAll: number | null
  averagePPAPass: number | null
  averagePPARush: number | null
  totalPPAAll: number | null
  totalPPAPass: number | null
  totalPPARush: number | null
}

export async function getCFBPlayerPPA(year: number, team?: string, position?: string): Promise<CFBPlayerPPA[]> {
  const apiKey = getCfbdApiKey()
  if (!apiKey) return []

  const cacheKey = `cfbd-player-ppa-${year}-${team || 'all'}-${position || 'all'}`

  const result = await getCachedOrFetch<CFBPlayerPPA[]>(cacheKey, ONE_DAY, async () => {
    let url = `${CFBD_BASE}/ppa/players/season?year=${year}`
    if (team) url += `&team=${encodeURIComponent(team)}`
    if (position) url += `&position=${encodeURIComponent(position)}`

    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' },
    })
    assertCfbdAvailable(response)
    if (!response.ok) return []

    const data = await response.json()
    return data.map((p: any) => ({
      season: p.season || year,
      id: p.id ?? null,
      name: p.name || '',
      position: p.position || '',
      team: p.team || '',
      conference: p.conference ?? null,
      countablePlays: p.countablePlays ?? null,
      averagePPAAll: p.averagePPA?.all ?? null,
      averagePPAPass: p.averagePPA?.pass ?? null,
      averagePPARush: p.averagePPA?.rush ?? null,
      totalPPAAll: p.totalPPA?.all ?? null,
      totalPPAPass: p.totalPPA?.pass ?? null,
      totalPPARush: p.totalPPA?.rush ?? null,
    }))
  })

  return result || []
}

// ──────────────────────────────────────────────────────────────────
// CFBD v2: SP+ Team Ratings
// ──────────────────────────────────────────────────────────────────

export interface CFBTeamSPRating {
  year: number
  team: string
  conference: string | null
  rating: number | null
  ranking: number | null
  offenseRating: number | null
  offenseRanking: number | null
  defenseRating: number | null
  defenseRanking: number | null
}

export async function getCFBSPRatings(year: number, team?: string): Promise<CFBTeamSPRating[]> {
  const apiKey = getCfbdApiKey()
  if (!apiKey) return []

  const cacheKey = `cfbd-sp-ratings-${year}-${team || 'all'}`

  const result = await getCachedOrFetch<CFBTeamSPRating[]>(cacheKey, THIRTY_DAYS, async () => {
    let url = `${CFBD_BASE}/ratings/sp?year=${year}`
    if (team) url += `&team=${encodeURIComponent(team)}`

    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' },
    })
    assertCfbdAvailable(response)
    if (!response.ok) return []

    const data = await response.json()
    return data.map((r: any) => ({
      year: r.year || year,
      team: r.team || '',
      conference: r.conference ?? null,
      rating: r.rating ?? null,
      ranking: r.ranking ?? null,
      offenseRating: r.offense?.rating ?? null,
      offenseRanking: r.offense?.ranking ?? null,
      defenseRating: r.defense?.rating ?? null,
      defenseRanking: r.defense?.ranking ?? null,
    }))
  })

  return result || []
}

// ──────────────────────────────────────────────────────────────────
// CFBD v2: WEPA (Adjusted Metrics)
// ──────────────────────────────────────────────────────────────────

export interface CFBPlayerWEPA {
  season: number
  playerId: number | null
  playerName: string
  team: string
  position: string | null
  weightedEPA: number | null
  plays: number | null
  epaPerPlay: number | null
}

export async function getCFBPlayerWEPAPassing(year: number, team?: string): Promise<CFBPlayerWEPA[]> {
  const apiKey = getCfbdApiKey()
  if (!apiKey) return []

  const cacheKey = `cfbd-wepa-passing-${year}-${team || 'all'}`

  const result = await getCachedOrFetch<CFBPlayerWEPA[]>(cacheKey, ONE_DAY, async () => {
    let url = `${CFBD_BASE}/wepa/players/passing?year=${year}`
    if (team) url += `&team=${encodeURIComponent(team)}`

    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' },
    })
    assertCfbdAvailable(response)
    if (!response.ok) return []

    const data = await response.json()
    return data.map((w: any) => ({
      season: w.season || year,
      playerId: w.playerId ?? w.id ?? null,
      playerName: w.playerName ?? w.player ?? w.name ?? '',
      team: w.team || '',
      position: w.position ?? 'QB',
      weightedEPA: w.weightedEPA ?? w.wepa ?? null,
      plays: w.plays ?? w.attempts ?? null,
      epaPerPlay: w.epaPerPlay ?? (w.weightedEPA && w.plays ? w.weightedEPA / w.plays : null),
    }))
  })

  return result || []
}

export async function getCFBPlayerWEPARushing(year: number, team?: string): Promise<CFBPlayerWEPA[]> {
  const apiKey = getCfbdApiKey()
  if (!apiKey) return []

  const cacheKey = `cfbd-wepa-rushing-${year}-${team || 'all'}`

  const result = await getCachedOrFetch<CFBPlayerWEPA[]>(cacheKey, ONE_DAY, async () => {
    let url = `${CFBD_BASE}/wepa/players/rushing?year=${year}`
    if (team) url += `&team=${encodeURIComponent(team)}`

    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' },
    })
    assertCfbdAvailable(response)
    if (!response.ok) return []

    const data = await response.json()
    return data.map((w: any) => ({
      season: w.season || year,
      playerId: w.playerId ?? w.id ?? null,
      playerName: w.playerName ?? w.player ?? w.name ?? '',
      team: w.team || '',
      position: w.position ?? null,
      weightedEPA: w.weightedEPA ?? w.wepa ?? null,
      plays: w.plays ?? w.carries ?? null,
      epaPerPlay: w.epaPerPlay ?? (w.weightedEPA && w.plays ? w.weightedEPA / w.plays : null),
    }))
  })

  return result || []
}

export interface CFBTeamDirectoryEntry {
  /** ESPN team id — CFBD sources its ids from ESPN. */
  id: number
  school: string
  mascot: string | null
  abbreviation: string | null
  alternateNames: string[] | null
  conference: string | null
  classification: string | null
  logo: string | null
}

/**
 * CFBD's full team directory — every division, with the alias forms needed to
 * resolve a team name that arrived from some other feed.
 *
 * Lives HERE because this module is the allowlisted CFBD adapter: every export
 * is a live fetch and its only runtime importers are ingestion modules. Putting
 * the call in the ingestion module instead would have introduced a second CFBD
 * client and taken the provider from zero DB-first violations to one.
 *
 * 🛑 THROWS ON A NON-2xx RATHER THAN RETURNING []. An empty directory is
 * indistinguishable from "college football has no teams", and a caller that
 * rebuilt its index from it would silently stop resolving every team. That is
 * the 429-read-as-no-players failure this file already guards against with
 * `assertCfbdAvailable`; the same reasoning applies to the whole payload.
 */
export async function getCFBTeamDirectory(): Promise<CFBTeamDirectoryEntry[]> {
  const apiKey = getCfbdApiKey()
  if (!apiKey) return []

  const directory = await getCachedOrFetch<CFBTeamDirectoryEntry[]>('cfbd-team-directory', THIRTY_DAYS, async () => {
    const response = await fetch(`${CFBD_BASE}/teams`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    })
    assertCfbdAvailable(response)
    if (!response.ok) {
      throw new Error(`CFBD /teams responded ${response.status}`)
    }

    const data = await response.json()
    if (!Array.isArray(data)) throw new Error('CFBD /teams returned a non-array payload')

    return data
      .filter((r: any) => typeof r?.id === 'number' && r?.school)
      .map((r: any) => ({
        id: r.id as number,
        school: String(r.school),
        mascot: r.mascot ?? null,
        abbreviation: r.abbreviation ?? null,
        alternateNames: Array.isArray(r.alternateNames) ? r.alternateNames : null,
        conference: r.conference ?? null,
        classification: r.classification ?? null,
        logo: Array.isArray(r.logos) && r.logos.length > 0 ? r.logos[0] : null,
      }))
  })

  /*
   * `getCachedOrFetch` widens to `T | null`. Coercing that to [] would hand the
   * caller an empty directory, which reads as "college football has no teams"
   * and would silently stop every team from resolving. Unknown must stay
   * unknown.
   */
  if (!directory) throw new Error('CFBD team directory unavailable')
  return directory
}

// ──────────────────────────────────────────────────────────────────
// CFBD v2: Passing detail — air yards, ADOT, pass location, YAC
//
// Added 2026-08-30, the day CFBD published five passing endpoints that split
// passing production into WHERE the ball was thrown and WHAT HAPPENED AFTER IT
// ARRIVED. For devy that is the difference between a QB whose yardage is his
// own and one whose yardage is his slot receiver's: two passers with identical
// `passingYards` can sit five air yards apart in ADOT, and only one of them is
// making the throws that translate.
//
// ⚠ COVERAGE IS PARTIAL AND THE PROVIDER SAYS SO. CFBD's own note: 2025 is
// partial "with richer detail concentrated later in the season", 2026 onward
// "mostly complete as games are played, though individual games and fields can
// still have gaps". So every aggregate here carries its own denominator —
// `airYardsAttempts` is the number of attempts that actually HAD an air-yard
// value, not the passer's attempt total. A caller that divides by `attempts`
// instead is computing an ADOT diluted by every throw the feed never measured,
// and it will be wrong in the direction that looks plausible: too low, smoothly,
// for exactly the players with the least data. Never substitute one for the
// other.
//
// ⚠ THE FIELD NAMES BELOW ARE MAPPED DEFENSIVELY, NOT FROM A CAPTURED FIXTURE.
// The announcement names the METRICS; it does not publish the JSON keys, this
// repo has no `contracts/collegefootballdata/` to read a shape out of, and the
// CFBD key has been over its monthly quota since 2026-08-25 — so there was no
// honest way to observe one. Each field therefore accepts the plausible
// spellings (`airYards` / `air_yards` / `totalAirYards`) and falls through to
// null rather than 0. A key we guessed wrong yields null, which every consumer
// below treats as "not measured"; guessing wrong toward 0 would publish a
// fabricated ADOT of zero for the whole board. When a real payload is first
// seen, tighten these to the observed keys and delete the aliases.
// ──────────────────────────────────────────────────────────────────

/** First present, finite number among `keys`; null when none is usable. */
function pickNumber(row: any, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = row?.[k]
    if (typeof v === 'number' && Number.isFinite(v)) return v
    // CFBD occasionally serialises aggregates as strings; "" and "NA" must not
    // become 0.
    if (typeof v === 'string' && v.trim() !== '') {
      const n = Number(v)
      if (Number.isFinite(n)) return n
    }
  }
  return null
}

function pickInt(row: any, ...keys: string[]): number | null {
  const n = pickNumber(row, ...keys)
  return n == null ? null : Math.round(n)
}

/**
 * The short/deep × left/middle/right grid, as far as the feed provides it.
 *
 * Kept as a nested record rather than eighteen flat columns: CFBD says location
 * is present "when provided in the play data", so most cells are absent for
 * most passers, and a sparse grid is honest about that in a way a wall of null
 * columns is not.
 */
export interface CFBPassLocationSplit {
  attempts: number | null
  completions: number | null
  yards: number | null
  touchdowns: number | null
  interceptions: number | null
}

export type CFBPassDepth = 'short' | 'deep'
export type CFBPassDirection = 'left' | 'middle' | 'right'

export type CFBPassLocationGrid = Partial<
  Record<CFBPassDepth, Partial<Record<CFBPassDirection, CFBPassLocationSplit>>>
>

const PASS_DEPTHS: CFBPassDepth[] = ['short', 'deep']
const PASS_DIRECTIONS: CFBPassDirection[] = ['left', 'middle', 'right']

/**
 * Read a location grid out of whichever shape the payload uses.
 *
 * Two are plausible from the announcement's wording ("short or deep, and left,
 * middle, or right"): nested (`locations.short.left`) or flat-keyed
 * (`locations["short_left"]`). Both are accepted; anything else yields an empty
 * grid, which reads as "no location detail" — the correct answer for a passer
 * whose plays carried none.
 */
function readPassLocations(raw: any): CFBPassLocationGrid {
  const src = raw?.locations ?? raw?.passLocations ?? raw?.pass_locations ?? raw
  if (!src || typeof src !== 'object') return {}

  const grid: CFBPassLocationGrid = {}
  for (const depth of PASS_DEPTHS) {
    for (const dir of PASS_DIRECTIONS) {
      const cell =
        src?.[depth]?.[dir] ??
        src?.[`${depth}_${dir}`] ??
        src?.[`${depth}${dir[0].toUpperCase()}${dir.slice(1)}`]
      if (!cell || typeof cell !== 'object') continue

      const split: CFBPassLocationSplit = {
        attempts: pickInt(cell, 'attempts', 'att', 'plays'),
        completions: pickInt(cell, 'completions', 'comp', 'completed'),
        yards: pickNumber(cell, 'yards', 'yds', 'passingYards'),
        touchdowns: pickInt(cell, 'touchdowns', 'td', 'tds'),
        interceptions: pickInt(cell, 'interceptions', 'int', 'ints'),
      }
      // A cell of nothing but nulls is noise — the grid is meant to be sparse.
      if (Object.values(split).every((v) => v == null)) continue

      grid[depth] = { ...(grid[depth] ?? {}), [dir]: split }
    }
  }
  return grid
}

/** Season or game passing profile for one passer. */
export interface CFBPassingProfile {
  season: number
  /** Present only on the per-game endpoint. */
  week: number | null
  gameId: number | null
  playerId: number | null
  playerName: string
  team: string
  conference: string | null
  /** Total attempts the passer threw, per the feed. */
  attempts: number | null
  completions: number | null
  /** Summed air yards across attempts that HAD an air-yard value. */
  airYards: number | null
  /**
   * Average depth of target.
   *
   * Taken from the feed when it supplies one and derived only from
   * `airYards / airYardsAttempts` otherwise — never from `attempts`. See the
   * coverage warning at the top of this section.
   */
  adot: number | null
  /** ⚠ ADOT's denominator. NOT `attempts`. Null when the feed omits it. */
  airYardsAttempts: number | null
  /** Yards gained after the catch, summed over completions that carried it. */
  yardsAfterCatch: number | null
  /** YAC's denominator — completions with a YAC value. NOT `completions`. */
  yacCompletions: number | null
  locations: CFBPassLocationGrid
}

function toPassingProfile(p: any, fallbackSeason: number): CFBPassingProfile {
  const airYards = pickNumber(p, 'airYards', 'air_yards', 'totalAirYards', 'total_air_yards')
  const airYardsAttempts = pickInt(
    p,
    'airYardsAttempts',
    'air_yards_attempts',
    'attemptsWithAirYards',
    'airYardsCount',
    'countableAttempts',
  )
  const feedAdot = pickNumber(p, 'adot', 'averageDepthOfTarget', 'average_depth_of_target', 'avgAirYards')

  return {
    season: pickInt(p, 'season', 'year') ?? fallbackSeason,
    week: pickInt(p, 'week'),
    gameId: pickInt(p, 'gameId', 'game_id'),
    playerId: pickInt(p, 'playerId', 'player_id', 'athleteId', 'id'),
    playerName: String(p?.player ?? p?.playerName ?? p?.name ?? '').trim(),
    team: String(p?.team ?? p?.school ?? '').trim(),
    conference: p?.conference ?? null,
    attempts: pickInt(p, 'attempts', 'att', 'passAttempts'),
    completions: pickInt(p, 'completions', 'comp', 'completedPasses'),
    airYards,
    // Derive ONLY over the measured denominator. `airYards / attempts` would be
    // an ADOT silently deflated by every unmeasured throw.
    adot:
      feedAdot ??
      (airYards != null && airYardsAttempts != null && airYardsAttempts > 0
        ? airYards / airYardsAttempts
        : null),
    airYardsAttempts,
    yardsAfterCatch: pickNumber(p, 'yardsAfterCatch', 'yards_after_catch', 'yac', 'totalYac'),
    yacCompletions: pickInt(p, 'yacCompletions', 'yac_completions', 'completionsWithYac', 'yacCount'),
    locations: readPassLocations(p),
  }
}

/**
 * Passer season summaries — `/passing/players/season`.
 *
 * The endpoint this whole section exists for: one row per passer per season,
 * which is the grain `DevyPlayer` stores at.
 */
export async function getCFBPassingPlayerSeason(year: number, team?: string): Promise<CFBPassingProfile[]> {
  const apiKey = getCfbdApiKey()
  if (!apiKey) return []

  const cacheKey = `cfbd-passing-players-season-${year}-${team || 'all'}`

  const result = await getCachedOrFetch<CFBPassingProfile[]>(cacheKey, ONE_DAY, async () => {
    let url = `${CFBD_BASE}/passing/players/season?year=${year}`
    if (team) url += `&team=${encodeURIComponent(team)}`

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    })
    assertCfbdAvailable(response)
    if (!response.ok) return []

    const data = await response.json()
    if (!Array.isArray(data)) return []
    return data.map((p: any) => toPassingProfile(p, year))
  })

  return result || []
}

/** Passer game summaries — `/passing/players/games`. */
export async function getCFBPassingPlayerGames(
  year: number,
  options?: { team?: string; week?: number },
): Promise<CFBPassingProfile[]> {
  const apiKey = getCfbdApiKey()
  if (!apiKey) return []

  const cacheKey = `cfbd-passing-players-games-${year}-${options?.team || 'all'}-${options?.week ?? 'all'}`

  const result = await getCachedOrFetch<CFBPassingProfile[]>(cacheKey, ONE_DAY, async () => {
    let url = `${CFBD_BASE}/passing/players/games?year=${year}`
    if (options?.team) url += `&team=${encodeURIComponent(options.team)}`
    if (options?.week != null) url += `&week=${options.week}`

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    })
    assertCfbdAvailable(response)
    if (!response.ok) return []

    const data = await response.json()
    if (!Array.isArray(data)) return []
    return data.map((p: any) => toPassingProfile(p, year))
  })

  return result || []
}

/**
 * Team passing summary, one side of the ball.
 *
 * ⚠ OFFENSE AND DEFENSE ARRIVE IN THE SAME RESPONSE and mean opposite things.
 * A team's defensive ADOT is how deep opponents threw AGAINST it; storing it
 * beside the offensive figure without the label would make a good pass defence
 * read as a vertical passing attack.
 */
export interface CFBTeamPassingSummary extends CFBPassingProfile {
  unit: 'offense' | 'defense'
}

function splitTeamUnits(data: any[], fallbackSeason: number): CFBTeamPassingSummary[] {
  const out: CFBTeamPassingSummary[] = []
  for (const row of data) {
    // Two shapes are plausible: a `unit`/`side` discriminator on a flat row, or
    // nested `offense`/`defense` objects on one row per team.
    const declared = String(row?.unit ?? row?.side ?? '').toLowerCase()
    if (declared === 'offense' || declared === 'defense') {
      out.push({ ...toPassingProfile(row, fallbackSeason), unit: declared })
      continue
    }
    for (const unit of ['offense', 'defense'] as const) {
      const nested = row?.[unit]
      if (!nested || typeof nested !== 'object') continue
      out.push({ ...toPassingProfile({ ...row, ...nested }, fallbackSeason), unit })
    }
  }
  return out
}

/** Team season passing summaries — `/passing/teams/season`. Offense and defense. */
export async function getCFBPassingTeamSeason(year: number, team?: string): Promise<CFBTeamPassingSummary[]> {
  const apiKey = getCfbdApiKey()
  if (!apiKey) return []

  const cacheKey = `cfbd-passing-teams-season-${year}-${team || 'all'}`

  const result = await getCachedOrFetch<CFBTeamPassingSummary[]>(cacheKey, ONE_DAY, async () => {
    let url = `${CFBD_BASE}/passing/teams/season?year=${year}`
    if (team) url += `&team=${encodeURIComponent(team)}`

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    })
    assertCfbdAvailable(response)
    if (!response.ok) return []

    const data = await response.json()
    if (!Array.isArray(data)) return []
    return splitTeamUnits(data, year)
  })

  return result || []
}

/** Team game passing summaries — `/passing/teams/games`. Offense and defense. */
export async function getCFBPassingTeamGames(
  year: number,
  options?: { team?: string; week?: number },
): Promise<CFBTeamPassingSummary[]> {
  const apiKey = getCfbdApiKey()
  if (!apiKey) return []

  const cacheKey = `cfbd-passing-teams-games-${year}-${options?.team || 'all'}-${options?.week ?? 'all'}`

  const result = await getCachedOrFetch<CFBTeamPassingSummary[]>(cacheKey, ONE_DAY, async () => {
    let url = `${CFBD_BASE}/passing/teams/games?year=${year}`
    if (options?.team) url += `&team=${encodeURIComponent(options.team)}`
    if (options?.week != null) url += `&week=${options.week}`

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    })
    assertCfbdAvailable(response)
    if (!response.ok) return []

    const data = await response.json()
    if (!Array.isArray(data)) return []
    return splitTeamUnits(data, year)
  })

  return result || []
}

/** One passing attempt — `/passing/plays`. */
export interface CFBPassingPlay {
  id: number | null
  season: number
  week: number | null
  gameId: number | null
  offense: string
  defense: string
  passerId: number | null
  passer: string
  receiverId: number | null
  receiver: string | null
  /** Negative for a throw behind the line of scrimmage. */
  airYards: number | null
  yardsAfterCatch: number | null
  yards: number | null
  completion: boolean | null
  touchdown: boolean | null
  interception: boolean | null
  depth: CFBPassDepth | null
  direction: CFBPassDirection | null
  down: number | null
  distance: number | null
}

/**
 * Individual attempts.
 *
 * ⚠ NOT INGESTED, AND DELIBERATELY SO. This is play grain: a single team-season
 * is several hundred attempts and a season-wide pull is six figures of rows.
 * There is no table at that grain in this schema, the devy board reasons at
 * season grain, and pulling it on the shared cron budget would spend the CFBD
 * monthly allowance on rows nothing reads. It is exposed because the season and
 * game aggregates cannot answer a question about ONE throw — a scouting or
 * research surface that needs that should call this narrowly, per team and
 * week, and say why.
 */
export async function getCFBPassingPlays(
  year: number,
  options?: { team?: string; week?: number },
): Promise<CFBPassingPlay[]> {
  const apiKey = getCfbdApiKey()
  if (!apiKey) return []

  const cacheKey = `cfbd-passing-plays-${year}-${options?.team || 'all'}-${options?.week ?? 'all'}`

  const result = await getCachedOrFetch<CFBPassingPlay[]>(cacheKey, ONE_DAY, async () => {
    let url = `${CFBD_BASE}/passing/plays?year=${year}`
    if (options?.team) url += `&team=${encodeURIComponent(options.team)}`
    if (options?.week != null) url += `&week=${options.week}`

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    })
    assertCfbdAvailable(response)
    if (!response.ok) return []

    const data = await response.json()
    if (!Array.isArray(data)) return []

    return data.map((p: any) => {
      const depth = String(p?.depth ?? p?.passDepth ?? '').toLowerCase()
      const direction = String(p?.direction ?? p?.passDirection ?? '').toLowerCase()
      return {
        id: pickInt(p, 'id', 'playId'),
        season: pickInt(p, 'season', 'year') ?? year,
        week: pickInt(p, 'week'),
        gameId: pickInt(p, 'gameId', 'game_id'),
        offense: String(p?.offense ?? p?.team ?? '').trim(),
        defense: String(p?.defense ?? p?.opponent ?? '').trim(),
        passerId: pickInt(p, 'passerId', 'passer_id'),
        passer: String(p?.passer ?? p?.passerName ?? '').trim(),
        receiverId: pickInt(p, 'receiverId', 'receiver_id'),
        receiver: p?.receiver ? String(p.receiver).trim() : null,
        // `pickNumber` on purpose: a throw behind the line has NEGATIVE air
        // yards, which is a real measurement and must survive.
        airYards: pickNumber(p, 'airYards', 'air_yards'),
        yardsAfterCatch: pickNumber(p, 'yardsAfterCatch', 'yards_after_catch', 'yac'),
        yards: pickNumber(p, 'yards', 'yardsGained', 'yards_gained'),
        completion: typeof p?.completion === 'boolean' ? p.completion : null,
        touchdown: typeof p?.touchdown === 'boolean' ? p.touchdown : null,
        interception: typeof p?.interception === 'boolean' ? p.interception : null,
        depth: depth === 'short' || depth === 'deep' ? depth : null,
        direction:
          direction === 'left' || direction === 'middle' || direction === 'right' ? direction : null,
        down: pickInt(p, 'down'),
        distance: pickInt(p, 'distance', 'yardsToGoal'),
      }
    })
  })

  return result || []
}
