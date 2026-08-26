// CFB Player Data - Integrates with CollegeFootballData.com API for devy player info
import { prisma } from '@/lib/prisma'
import { getCfbdApiKey } from '@/lib/cfbd-env'

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
  devyValue: number
  projectedNFLValue: number | null
  draftEligibleYear: number
  projectedRound: number | null
  trend: 'rising' | 'falling' | 'stable'
  notes: string | null
}

const CFBD_BASE = 'https://api.collegefootballdata.com'

/**
 * Statuses that are NEVER a legitimately empty result.
 *
 * Every fetcher below answers `!response.ok` with `return []`, which makes
 * "your key is out of quota" indistinguishable from "this team has no players".
 * That is not hypothetical: on 2026-08-25 the key was returning
 * `429 {"message":"Monthly call quota exceeded."}` for every endpoint, and the
 * roster ingest reported `playersUpserted: 0, errors: 0` — a clean, healthy-
 * looking zero for a provider that was answering nothing at all. The devy pool
 * had been quietly filling with nothing on that basis.
 *
 * 401/403 (bad or revoked key) and 429 (quota/rate) all mean "we did not get an
 * answer". Throwing lets the per-team try/catch in lib/devy-classification.ts
 * record a real error, so the cron's summary says what happened. A 404 or a
 * genuine empty array still falls through to the existing `[]`, because those
 * really can mean no data.
 *
 * Deliberately never includes the response body or URL in the message — the
 * CFBD key travels in an Authorization header, but the query string can carry
 * identifying params and this string reaches logs.
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

export async function getCFBDraftPicks(year: number, college?: string): Promise<CFBDraftPick[]> {
  const apiKey = getCfbdApiKey()
  if (!apiKey) return []

  try {
    let url = `${CFBD_BASE}/draft/picks?year=${year}`
    if (college) url += `&college=${encodeURIComponent(college)}`

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
      },
    })

    assertCfbdAvailable(response)
    if (!response.ok) {
      console.error('[CFBD] Draft picks fetch failed:', response.status)
      return []
    }

    const data = await response.json()
    return data.map((p: any) => ({
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
    }))
  } catch (error) {
    // A quota/credential refusal is not "no data" — let it out so the caller
    // records a real error instead of an empty, healthy-looking result.
    if (error instanceof CfbdUnavailableError) throw error
    console.error('[CFBD] Draft picks error:', String(error))
    return []
  }
}

export async function getCFBTeamRoster(team: string, year?: number): Promise<CFBPlayer[]> {
  const apiKey = getCfbdApiKey()
  if (!apiKey) return []

  try {
    const rosterYear = year || new Date().getFullYear()
    const response = await fetch(
      `${CFBD_BASE}/roster?team=${encodeURIComponent(team)}&year=${rosterYear}`,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json',
        },
      }
    )

    assertCfbdAvailable(response)
    if (!response.ok) return []

    const data = await response.json()
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
  } catch (error) {
    // A quota/credential refusal is not "no data" — let it out so the caller
    // records a real error instead of an empty, healthy-looking result.
    if (error instanceof CfbdUnavailableError) throw error
    console.error('CFBD roster error:', error)
    return []
  }
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
    // Same reason as the fetchers above: a quota/credential refusal must not be
    // laundered into `null` and read downstream as "this endpoint has nothing".
    // Nothing is written to the cache on this path, so a refusal never poisons
    // the cached value either.
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
