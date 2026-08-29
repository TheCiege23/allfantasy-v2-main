import fs from 'fs'
import path from 'path'
import { normalizePlayerName } from './team-abbrev'

export interface MultiPlatformADP {
  rank: number
  name: string
  team: string
  position: string
  redraft: {
    fantrax: number | null
    sleeper: number | null
    espn: number | null
    mfl: number | null
    nffc: number | null
  }
  twoQB: {
    sleeper: number | null
  }
  dynasty: {
    sleeper: number | null
  }
  dynasty2QB: {
    sleeper: number | null
  }
  aav: {
    mfl: number | null
    espn: number | null
  }
  health: {
    status: string | null
    injury: string | null
  }
  consensus: number | null
  platformCount: number
  adpSpread: number | null
}

export type ADPFormat = 'redraft' | 'dynasty' | 'dynasty-2qb' | '2qb'

export interface ADPConsensus {
  rank: number
  name: string
  team: string
  position: string
  format: ADPFormat
  consensusADP: number
  platformCount: number
  spread: number
  tier: string
  bestPlatformADP: number
  worstPlatformADP: number
  dynastyADP: number | null
  dynasty2QBADP: number | null
  aav: number | null
  healthStatus: string | null
  injury: string | null
}

let cache: MultiPlatformADP[] | null = null

function parseNum(val: string): number | null {
  if (!val || val === '-' || val.trim() === '') return null
  const num = parseFloat(val.replace(/[^\d.]/g, ''))
  return isNaN(num) ? null : num
}

function parseCSVLine(line: string): string[] {
  const values: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"' && !inQuotes) {
      inQuotes = true
    } else if (char === '"' && inQuotes) {
      inQuotes = false
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  values.push(current.trim())
  return values
}

export function loadMultiPlatformADP(): MultiPlatformADP[] {
  if (cache) return cache

  const candidates = [
    path.join(process.cwd(), 'data', 'nfl-adp-multiplatform.csv'),
    path.join(__dirname, '..', 'data', 'nfl-adp-multiplatform.csv'),
    path.join(__dirname, '..', '..', 'data', 'nfl-adp-multiplatform.csv'),
  ]
  const csvPath = candidates.find(p => fs.existsSync(p)) || candidates[0]
  if (!fs.existsSync(csvPath)) {
    console.warn('[MULTI-ADP] CSV not found, tried:', candidates.join(', '))
    return []
  }

  const content = fs.readFileSync(csvPath, 'utf-8')
    .replace(/^\uFEFF/, '')
  const lines = content.split('\n').filter(l => l.trim())

  if (lines.length < 3) return []

  const players: MultiPlatformADP[] = []

  for (let i = 2; i < lines.length; i++) {
    const vals = parseCSVLine(lines[i])
    if (vals.length < 12) continue

    const rankStr = vals[0]?.replace(/^T/, '') || ''
    const rank = parseInt(rankStr) || 9999
    const name = vals[1] || ''
    const team = vals[2] || ''
    const pos = vals[3] || ''

    if (!name) continue

    const fantrax = parseNum(vals[4])
    const sleeperRedraft = parseNum(vals[5])
    const espnRedraft = parseNum(vals[6])
    const mflRedraft = parseNum(vals[7])
    const nffc = parseNum(vals[8])
    const sleeper2QB = parseNum(vals[9])
    const sleeperDynasty = parseNum(vals[10])
    const sleeperDynasty2QB = parseNum(vals[11])
    const mflAAV = parseNum(vals[12])
    const espnAAV = parseNum(vals[13])
    const healthStatus = vals[14]?.trim() || null
    const injury = vals[15]?.trim() || null

    const redraftValues = [fantrax, sleeperRedraft, espnRedraft, mflRedraft, nffc].filter(v => v !== null) as number[]
    const platformCount = redraftValues.length
    const consensus = platformCount > 0 ? redraftValues.reduce((a, b) => a + b, 0) / platformCount : null
    const spread = platformCount >= 2
      ? Math.max(...redraftValues) - Math.min(...redraftValues)
      : null

    players.push({
      rank,
      name,
      team,
      position: pos,
      redraft: { fantrax, sleeper: sleeperRedraft, espn: espnRedraft, mfl: mflRedraft, nffc },
      twoQB: { sleeper: sleeper2QB },
      dynasty: { sleeper: sleeperDynasty },
      dynasty2QB: { sleeper: sleeperDynasty2QB },
      aav: { mfl: mflAAV, espn: espnAAV },
      health: { status: healthStatus, injury },
      consensus,
      platformCount,
      adpSpread: spread,
    })
  }

  /*
   * 🛑 A COLUMN WITH ONE DISTINCT VALUE IS NOT A RANKING, AND AVERAGING IT RUINS THE BOARD.
   *
   * The CSV's `ESPN` column is the literal string "170.00" on all 2,544 rows that carry a
   * value — Ja'Marr Chase, the consensus 1.01, is "170.00" like everyone else. It is a
   * broken export, not a slow one.
   *
   * Because `consensus` is the MEAN of the five redraft columns, one constant at 170 drags
   * every good player toward it. Measured against production before this guard:
   *
   *     Ja'Marr Chase     true 1.68  ->  35.34        Bijan Robinson  3.08 -> 36.47
   *     Justin Jefferson  true 6.14  ->  38.91        every top player +32 to +34
   *
   *     11 of the true top 12 rendered outside round 1
   *     37 players truly inside pick 48 rendered outside it
   *
   * and `adpSpread` became a constant ~168.9, so the confidence signal died with it. The
   * stored rows carry the fingerprint: consensus 34.89-35.28 at providerCount 5.
   *
   * ⚠ THE READ-TIME SENTINEL FILTER CANNOT FIX THIS, which is why the guard belongs here.
   * `sentinelValues` in lib/adp/resolveAdp.ts drops rows whose value IS the sentinel (170)
   * and is right to exist — but a contaminated MEAN is 35.11, not 170, so it sails through
   * every filter looking like an ordinary draft position.
   *
   * Detected rather than hardcoded, for the same reason SENTINEL_SHARE is derived: name the
   * PROPERTY that makes a column useless, not the column that happens to have it today. If
   * the export is repaired the source returns on its own; if a different column breaks the
   * same way, it is caught without a code change.
   */
  const REDRAFT_SOURCES = ['fantrax', 'sleeper', 'espn', 'mfl', 'nffc'] as const
  const degenerate = new Set<string>()
  for (const src of REDRAFT_SOURCES) {
    const seen = new Set<number>()
    for (const p of players) {
      const v = p.redraft[src]
      if (v !== null) seen.add(v)
      if (seen.size > 1) break
    }
    // One distinct value across the whole board (or none at all) carries no ordering.
    if (seen.size <= 1) degenerate.add(src)
  }

  if (degenerate.size > 0) {
    console.warn(
      `[MULTI-ADP] Ignoring degenerate redraft column(s) — a single distinct value across ` +
        `${players.length} players is a placeholder, not an ADP: ${[...degenerate].join(', ')}`,
    )
    for (const p of players) {
      for (const src of degenerate) {
        ;(p.redraft as Record<string, number | null>)[src] = null
      }
      // Recompute from the surviving columns so consensus and spread never saw the constant.
      const vals = REDRAFT_SOURCES.map((s) => p.redraft[s]).filter((v): v is number => v !== null)
      p.platformCount = vals.length
      p.consensus = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null
      p.adpSpread = vals.length >= 2 ? Math.max(...vals) - Math.min(...vals) : null
    }
  }

  cache = players
  console.log(`[MULTI-ADP] Loaded ${players.length} players from multi-platform CSV`)
  return players
}

const nameIndex = new Map<string, MultiPlatformADP[]>()

function ensureNameIndex() {
  if (nameIndex.size > 0) return
  const players = loadMultiPlatformADP()
  for (const p of players) {
    const key = normalizePlayerName(p.name)
    const existing = nameIndex.get(key) || []
    existing.push(p)
    nameIndex.set(key, existing)
  }
}

export function findMultiADP(name: string, position?: string, team?: string): MultiPlatformADP | null {
  ensureNameIndex()
  const key = normalizePlayerName(name)
  const candidates = nameIndex.get(key)
  if (!candidates || candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0]

  if (position) {
    const posMatch = candidates.find(c => c.position === position)
    if (posMatch) return posMatch
  }
  if (team) {
    const teamMatch = candidates.find(c => c.team === team)
    if (teamMatch) return teamMatch
  }
  return candidates[0]
}

export function getConsensusADP(name: string, position?: string, team?: string, format: ADPFormat = 'redraft'): ADPConsensus | null {
  const entry = findMultiADP(name, position, team)
  if (!entry) return null

  let primaryADP: number | null
  let values: number[]
  let platformCount: number
  let spread: number

  if (format === 'dynasty') {
    primaryADP = entry.dynasty.sleeper
    values = primaryADP !== null ? [primaryADP] : []
    platformCount = primaryADP !== null ? 1 : 0
    spread = 0
  } else if (format === 'dynasty-2qb') {
    primaryADP = entry.dynasty2QB.sleeper
    values = primaryADP !== null ? [primaryADP] : []
    platformCount = primaryADP !== null ? 1 : 0
    spread = 0
  } else if (format === '2qb') {
    primaryADP = entry.twoQB.sleeper
    values = primaryADP !== null ? [primaryADP] : []
    platformCount = primaryADP !== null ? 1 : 0
    spread = 0
  } else {
    values = [
      entry.redraft.fantrax,
      entry.redraft.sleeper,
      entry.redraft.espn,
      entry.redraft.mfl,
      entry.redraft.nffc,
    ].filter(v => v !== null) as number[]
    platformCount = values.length
    primaryADP = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null
    spread = values.length >= 2 ? Math.max(...values) - Math.min(...values) : 0
  }

  const bestADP = values.length > 0 ? Math.min(...values) : 9999
  const worstADP = values.length > 0 ? Math.max(...values) : 9999
  const consensusValue = primaryADP ?? entry.consensus ?? 9999

  let tier = 'Undrafted'
  if (consensusValue < 9999) {
    if (consensusValue <= 12) tier = 'Elite (Round 1)'
    else if (consensusValue <= 24) tier = 'Tier 1 (Round 2)'
    else if (consensusValue <= 48) tier = 'Tier 2 (Rounds 3-4)'
    else if (consensusValue <= 72) tier = 'Tier 3 (Rounds 5-6)'
    else if (consensusValue <= 120) tier = 'Tier 4 (Rounds 7-10)'
    else if (consensusValue <= 180) tier = 'Tier 5 (Rounds 11-15)'
    else tier = 'Late Round / Bench'
  }

  const aav = entry.aav.mfl ?? entry.aav.espn ?? null

  return {
    rank: entry.rank,
    name: entry.name,
    team: entry.team,
    position: entry.position,
    format,
    consensusADP: consensusValue,
    platformCount,
    spread,
    tier,
    bestPlatformADP: bestADP,
    worstPlatformADP: worstADP,
    dynastyADP: entry.dynasty.sleeper,
    dynasty2QBADP: entry.dynasty2QB.sleeper,
    aav,
    healthStatus: entry.health.status,
    injury: entry.health.injury,
  }
}

export function getMultiPlatformADPForPlatform(
  name: string,
  platform: 'fantrax' | 'sleeper' | 'espn' | 'mfl' | 'nffc',
  position?: string,
  team?: string
): number | null {
  const entry = findMultiADP(name, position, team)
  if (!entry) return null
  return entry.redraft[platform]
}

export function getDynastyADP(
  name: string,
  is2QB: boolean = false,
  position?: string,
  team?: string
): number | null {
  const entry = findMultiADP(name, position, team)
  if (!entry) return null
  return is2QB ? entry.dynasty2QB.sleeper : entry.dynasty.sleeper
}

export function getHealthReport(name: string, position?: string, team?: string): { status: string | null; injury: string | null } | null {
  const entry = findMultiADP(name, position, team)
  if (!entry) return null
  if (!entry.health.status && !entry.health.injury) return null
  return entry.health
}

export function getTopPlayers(limit: number = 100, position?: string): ADPConsensus[] {
  const players = loadMultiPlatformADP()
  let filtered = players.filter(p => p.consensus !== null)
  if (position) {
    filtered = filtered.filter(p => p.position === position)
  }
  filtered.sort((a, b) => (a.consensus ?? 9999) - (b.consensus ?? 9999))
  return filtered.slice(0, limit).map(p => getConsensusADP(p.name, p.position, p.team)!)
}

export function getADPDisagreements(minSpread: number = 30): ADPConsensus[] {
  const players = loadMultiPlatformADP()
  return players
    .filter(p => (p.adpSpread ?? 0) >= minSpread && p.platformCount >= 3)
    .sort((a, b) => (b.adpSpread ?? 0) - (a.adpSpread ?? 0))
    .map(p => getConsensusADP(p.name, p.position, p.team)!)
}

export function clearMultiADPCache(): void {
  cache = null
  nameIndex.clear()
}
