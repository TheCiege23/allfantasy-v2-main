import { prisma } from './prisma'
import { normalizeTeamAbbrev, normalizePosition, normalizePlayerName, playerNamesMatch } from './team-abbrev'
import { fetchFantasyCalcValues, type FantasyCalcPlayer } from '@/lib/player-valuations/canonicalPlayerValuations'
import { findMultiADP, getConsensusADP, type ADPConsensus } from './multi-platform-adp'
import { getTeamLogoUrl as resolveTeamLogoUrl } from './player-media-urls'

export interface UnifiedPlayer {
  canonicalId: string
  canonicalName: string
  position: string | null
  currentTeam: string | null
  dob: string | null
  status: string | null
  sleeperId: string | null
  fantasyCalcId: string | null
  rollingInsightsId: string | null
  apiSportsId: string | null
  imageUrl: string | null
  teamLogoUrl: string | null
  stats: UnifiedPlayerStats | null
  valuation: UnifiedValuation | null
}

export interface UnifiedPlayerStats {
  season: string
  gamesPlayed: number | null
  passingYards: number | null
  passingTds: number | null
  rushingYards: number | null
  rushingTds: number | null
  receptions: number | null
  receivingYards: number | null
  receivingTds: number | null
  fantasyPoints: number | null
  source: string
}

export interface MultiPlatformADPData {
  consensusADP: number | null
  platformCount: number
  adpSpread: number | null
  tier: string | null
  redraft: {
    fantrax: number | null
    sleeper: number | null
    espn: number | null
    mfl: number | null
    nffc: number | null
  }
  dynastyADP: number | null
  dynasty2QBADP: number | null
  aav: number | null
  health: { status: string | null; injury: string | null } | null
}

export interface UnifiedValuation {
  dynastyValue: number
  redraftValue: number | null
  overallRank: number
  positionRank: number
  trend30Day: number
  source: string
  multiPlatformADP?: MultiPlatformADPData | null
}

const SLEEPER_HEADSHOT_BASE = 'https://sleepercdn.com/content/nfl/players/thumb'

function getImageUrl(sleeperId: string | null): string | null {
  if (!sleeperId) return null
  return `${SLEEPER_HEADSHOT_BASE}/${sleeperId}.jpg`
}

function getTeamLogoUrl(team: string | null): string | null {
  if (!team) return null
  const normalized = normalizeTeamAbbrev(team)
  if (!normalized) return null
  return resolveTeamLogoUrl(normalized, 'nfl')
}

export async function lookupBySleeperId(sleeperId: string): Promise<UnifiedPlayer | null> {
  const identity = await prisma.playerIdentityMap.findUnique({
    where: { sleeperId },
  })

  if (!identity) return null

  return buildUnifiedPlayer(identity)
}

function disambiguateCandidate(
  candidates: Array<{ id: string; canonicalName: string; position: string | null; currentTeam: string | null; dob: string | null; status: string | null; sleeperId: string | null; fantasyCalcId: string | null; rollingInsightsId: string | null; apiSportsId: string | null; mflId: string | null }>,
  position?: string,
  team?: string,
  dob?: string
): { candidate: typeof candidates[0]; confident: boolean } {
  if (candidates.length === 1) {
    return { candidate: candidates[0], confident: true }
  }

  let best = candidates[0]
  let bestScore = -1
  let tiedCount = 0

  for (const c of candidates) {
    let score = 0

    if (position && c.position) {
      if (normalizePosition(c.position) === normalizePosition(position)) score += 5
      else score -= 3
    }

    if (team && c.currentTeam) {
      if (normalizeTeamAbbrev(c.currentTeam) === normalizeTeamAbbrev(team)) score += 4
    }

    if (dob && c.dob) {
      if (c.dob === dob) score += 10
      else score -= 5
    }

    if (c.sleeperId) score += 1
    if (c.fantasyCalcId) score += 1
    if (c.rollingInsightsId) score += 1

    if (score > bestScore) {
      bestScore = score
      best = c
      tiedCount = 1
    } else if (score === bestScore) {
      tiedCount++
    }
  }

  const confident = tiedCount === 1 && bestScore >= 3

  if (!confident) {
    console.warn(
      `[UnifiedPlayer] Ambiguous match for "${best.canonicalName}" (${candidates.length} candidates, best score: ${bestScore}, tied: ${tiedCount}). ` +
      `Using best guess: ${best.canonicalName} ${best.position || '??'} ${best.currentTeam || '??'}. ` +
      `Provide position+team for deterministic resolution.`
    )
  }

  return { candidate: best, confident }
}

export async function lookupByName(
  name: string,
  position?: string,
  team?: string,
  dob?: string
): Promise<UnifiedPlayer | null> {
  const normalized = normalizePlayerName(name)

  const candidates = await prisma.playerIdentityMap.findMany({
    where: { normalizedName: normalized, sport: 'NFL' },
  })

  if (candidates.length === 0) return null

  const { candidate } = disambiguateCandidate(candidates, position, team, dob)
  return buildUnifiedPlayer(candidate)
}

export async function lookupBySleeperIds(sleeperIds: string[]): Promise<Map<string, UnifiedPlayer>> {
  const identities = await prisma.playerIdentityMap.findMany({
    where: { sleeperId: { in: sleeperIds } },
  })

  const result = new Map<string, UnifiedPlayer>()
  for (const identity of identities) {
    if (identity.sleeperId) {
      result.set(identity.sleeperId, await buildUnifiedPlayer(identity))
    }
  }

  return result
}

export async function lookupByNames(
  names: Array<{ name: string; position?: string; team?: string }>
): Promise<Map<string, UnifiedPlayer>> {
  const normalizedNames = [...new Set(names.map(n => normalizePlayerName(n.name)))]

  const candidates = await prisma.playerIdentityMap.findMany({
    where: { normalizedName: { in: normalizedNames }, sport: 'NFL' },
  })

  const candidatesByName = new Map<string, typeof candidates>()
  for (const c of candidates) {
    const existing = candidatesByName.get(c.normalizedName) || []
    existing.push(c)
    candidatesByName.set(c.normalizedName, existing)
  }

  const result = new Map<string, UnifiedPlayer>()

  for (const input of names) {
    const normalized = normalizePlayerName(input.name)
    const matches = candidatesByName.get(normalized)
    if (!matches || matches.length === 0) continue

    const lookupKey = input.position
      ? `${input.name}|${input.position}|${input.team || ''}`
      : input.name

    if (result.has(lookupKey)) continue

    const { candidate } = disambiguateCandidate(matches, input.position, input.team)
    const player = await buildUnifiedPlayer(candidate)
    result.set(input.name, player)

    if (lookupKey !== input.name) {
      result.set(lookupKey, player)
    }
  }

  return result
}

async function buildUnifiedPlayer(identity: {
  id: string
  canonicalName: string
  position: string | null
  currentTeam: string | null
  dob: string | null
  status: string | null
  sleeperId: string | null
  fantasyCalcId: string | null
  rollingInsightsId: string | null
  apiSportsId: string | null
  mflId: string | null
}): Promise<UnifiedPlayer> {
  let stats: UnifiedPlayerStats | null = null

  if (identity.rollingInsightsId) {
    const seasonStats = await prisma.playerSeasonStats.findFirst({
      where: {
        playerId: identity.rollingInsightsId,
        sport: 'NFL',
        source: 'rolling_insights',
      },
      orderBy: { season: 'desc' },
    })

    if (seasonStats?.stats && typeof seasonStats.stats === 'object') {
      const d = seasonStats.stats as Record<string, number | null>
      stats = {
        season: seasonStats.season,
        gamesPlayed: d.games_played ?? null,
        passingYards: d.passing_yards ?? null,
        passingTds: d.passing_touchdowns ?? null,
        rushingYards: d.rushing_yards ?? null,
        rushingTds: d.rushing_touchdowns ?? null,
        receptions: d.receptions ?? null,
        receivingYards: d.receiving_yards ?? null,
        receivingTds: d.receiving_touchdowns ?? null,
        fantasyPoints: d.DK_fantasy_points ?? null,
        source: 'rolling_insights',
      }
    }
  }

  return {
    canonicalId: identity.id,
    canonicalName: identity.canonicalName,
    position: identity.position,
    currentTeam: identity.currentTeam ? normalizeTeamAbbrev(identity.currentTeam) : null,
    dob: identity.dob,
    status: identity.status,
    sleeperId: identity.sleeperId,
    fantasyCalcId: identity.fantasyCalcId,
    rollingInsightsId: identity.rollingInsightsId,
    apiSportsId: identity.apiSportsId,
    imageUrl: getImageUrl(identity.sleeperId),
    teamLogoUrl: getTeamLogoUrl(identity.currentTeam),
    stats,
    valuation: null,
  }
}

export async function enrichWithValuation(
  player: UnifiedPlayer,
  fcPlayers?: FantasyCalcPlayer[]
): Promise<UnifiedPlayer> {
  if (!fcPlayers) {
    try {
      fcPlayers = await fetchFantasyCalcValues({ isDynasty: true, numQbs: 2, numTeams: 12, ppr: 1 })
    } catch {
      return player
    }
  }

  let match: FantasyCalcPlayer | undefined

  if (player.sleeperId) {
    match = fcPlayers.find(p => p.player.sleeperId === player.sleeperId)
  }

  if (!match) {
    const normalized = normalizePlayerName(player.canonicalName)
    match = fcPlayers.find(p => normalizePlayerName(p.player.name) === normalized)
  }

  if (!match && player.position && player.currentTeam) {
    match = fcPlayers.find(p => {
      if (!playerNamesMatch(p.player.name, player.canonicalName)) return false
      if (normalizePosition(p.player.position) !== normalizePosition(player.position)) return false
      return true
    })
  }

  const multiADP = buildMultiPlatformADPData(player.canonicalName, player.position || undefined, player.currentTeam || undefined)

  if (match) {
    return {
      ...player,
      valuation: {
        dynastyValue: match.value,
        redraftValue: match.redraftValue || null,
        overallRank: match.overallRank,
        positionRank: match.positionRank,
        trend30Day: match.trend30Day,
        source: 'fantasycalc',
        multiPlatformADP: multiADP,
      },
    }
  }

  if (multiADP) {
    return {
      ...player,
      valuation: {
        dynastyValue: 0,
        redraftValue: null,
        overallRank: multiADP.consensusADP ?? 9999,
        positionRank: 0,
        trend30Day: 0,
        source: 'multi-platform-adp',
        multiPlatformADP: multiADP,
      },
    }
  }

  return player
}

function buildMultiPlatformADPData(name: string, position?: string, team?: string): MultiPlatformADPData | null {
  const entry = findMultiADP(name, position, team)
  if (!entry) return null

  const consensus = getConsensusADP(name, position, team)

  return {
    consensusADP: entry.consensus,
    platformCount: entry.platformCount,
    adpSpread: entry.adpSpread,
    tier: consensus?.tier ?? null,
    redraft: entry.redraft,
    dynastyADP: entry.dynasty.sleeper,
    dynasty2QBADP: entry.dynasty2QB.sleeper,
    aav: entry.aav.mfl ?? entry.aav.espn ?? null,
    health: entry.health.status || entry.health.injury ? entry.health : null,
  }
}

export async function syncIdentityMap(): Promise<{ created: number; updated: number; matched: number }> {
  let created = 0
  let updated = 0
  let matched = 0

  const fcPlayers = await fetchFantasyCalcValues({ isDynasty: true, numQbs: 2, numTeams: 12, ppr: 1 })

  for (const fc of fcPlayers) {
    const sleeperId = fc.player.sleeperId || null
    const canonicalName = fc.player.name
    const normalized = normalizePlayerName(canonicalName)
    const position = normalizePosition(fc.player.position)
    const team = normalizeTeamAbbrev(fc.player.maybeTeam)
    const dob = fc.player.maybeBirthday || null

    let existing = sleeperId
      ? await prisma.playerIdentityMap.findUnique({ where: { sleeperId } })
      : null

    if (!existing) {
      const nameMatches = await prisma.playerIdentityMap.findMany({
        where: { normalizedName: normalized, sport: 'NFL' },
      })

      if (nameMatches.length === 1) {
        existing = nameMatches[0]
      } else if (nameMatches.length > 1) {
        existing = nameMatches.find(m => {
          const posMatch = !position || !m.position || normalizePosition(m.position) === position
          const teamMatch = !team || !m.currentTeam || normalizeTeamAbbrev(m.currentTeam) === team
          const dobMatch = !dob || !m.dob || m.dob === dob
          return posMatch && teamMatch && (dob ? dobMatch : true)
        }) || null
        if (!existing) {
          console.warn(`[IdentitySync] Multiple matches for "${canonicalName}" but no confident match. Skipping auto-link.`)
        }
      }
    }

    const espnId = fc.player.espnId || null
    const fleaflickerId = fc.player.fleaflickerId || null

    if (existing) {
      await prisma.playerIdentityMap.update({
        where: { id: existing.id },
        data: {
          canonicalName,
          normalizedName: normalized,
          position: position || existing.position,
          currentTeam: team || existing.currentTeam,
          dob: dob || existing.dob,
          fantasyCalcId: String(fc.player.id),
          sleeperId: sleeperId || existing.sleeperId,
          mflId: fc.player.mflId || existing.mflId,
          espnId: espnId || existing.espnId,
          fleaflickerId: fleaflickerId || existing.fleaflickerId,
          status: existing.status,
          lastSyncedAt: new Date(),
        },
      })
      updated++
    } else {
      await prisma.playerIdentityMap.create({
        data: {
          canonicalName,
          normalizedName: normalized,
          position,
          currentTeam: team,
          dob,
          sleeperId,
          fantasyCalcId: String(fc.player.id),
          mflId: fc.player.mflId || null,
          espnId,
          fleaflickerId,
          sport: 'NFL',
          lastSyncedAt: new Date(),
        },
      })
      created++
    }
  }

  const riPlayers = await prisma.sportsPlayer.findMany({
    where: { sport: 'NFL', source: 'rolling_insights' },
    select: {
      externalId: true,
      name: true,
      position: true,
      team: true,
      sleeperId: true,
      dob: true,
      status: true,
    },
  })

  for (const ri of riPlayers) {
    const normalized = normalizePlayerName(ri.name)
    const position = normalizePosition(ri.position)
    const team = normalizeTeamAbbrev(ri.team)

    let identity = ri.sleeperId
      ? await prisma.playerIdentityMap.findUnique({ where: { sleeperId: ri.sleeperId } })
      : null

    if (!identity) {
      const nameMatches = await prisma.playerIdentityMap.findMany({
        where: { normalizedName: normalized, sport: 'NFL' },
      })

      identity = nameMatches.find(m => {
        if (position && m.position && normalizePosition(m.position) !== position) return false
        if (team && m.currentTeam && normalizeTeamAbbrev(m.currentTeam) !== team) return false
        return true
      }) || (nameMatches.length === 1 ? nameMatches[0] : null)
    }

    if (identity) {
      await prisma.playerIdentityMap.update({
        where: { id: identity.id },
        data: {
          rollingInsightsId: ri.externalId,
          sleeperId: ri.sleeperId || identity.sleeperId,
          status: ri.status || identity.status,
          dob: ri.dob || identity.dob,
          currentTeam: team || identity.currentTeam,
          lastSyncedAt: new Date(),
        },
      })
      matched++
    }
  }

  return { created, updated, matched }
}

export function buildPlayerContextForAI(players: UnifiedPlayer[]): string {
  if (players.length === 0) return ''

  const lines = players.map(p => {
    const parts = [`${p.canonicalName}`]
    if (p.position) parts.push(`(${p.position})`)
    if (p.currentTeam) parts.push(`- ${p.currentTeam}`)
    if (p.status && p.status !== 'Active') parts.push(`[${p.status}]`)

    if (p.stats) {
      const statParts: string[] = []
      statParts.push(`${p.stats.season} season`)
      if (p.stats.gamesPlayed) statParts.push(`${p.stats.gamesPlayed}G`)
      if (p.position === 'QB') {
        if (p.stats.passingYards) statParts.push(`${p.stats.passingYards}pass yds`)
        if (p.stats.passingTds) statParts.push(`${p.stats.passingTds}pass TD`)
      }
      if (['RB', 'WR', 'TE'].includes(p.position || '')) {
        if (p.stats.receptions) statParts.push(`${p.stats.receptions}rec`)
        if (p.stats.receivingYards) statParts.push(`${p.stats.receivingYards}rec yds`)
        if (p.stats.receivingTds) statParts.push(`${p.stats.receivingTds}rec TD`)
      }
      if (['RB'].includes(p.position || '')) {
        if (p.stats.rushingYards) statParts.push(`${p.stats.rushingYards}rush yds`)
        if (p.stats.rushingTds) statParts.push(`${p.stats.rushingTds}rush TD`)
      }
      if (p.stats.fantasyPoints) statParts.push(`${p.stats.fantasyPoints}fpts`)
      parts.push(`| Stats: ${statParts.join(', ')}`)
    }

    if (p.valuation) {
      parts.push(`| Value: ${p.valuation.dynastyValue} (rank #${p.valuation.overallRank})`)
      if (p.valuation.trend30Day) {
        const arrow = p.valuation.trend30Day > 0 ? '↑' : '↓'
        parts.push(`${arrow}${Math.abs(p.valuation.trend30Day)} 30d`)
      }
      if (p.valuation.multiPlatformADP) {
        const mp = p.valuation.multiPlatformADP
        if (mp.consensusADP !== null) {
          parts.push(`| ConsensusADP: ${mp.consensusADP.toFixed(1)} (${mp.platformCount} platforms, spread: ${mp.adpSpread?.toFixed(1) ?? '?'})`)
        }
        if (mp.tier) parts.push(`[${mp.tier}]`)
        if (mp.dynastyADP !== null) parts.push(`DynADP: ${mp.dynastyADP.toFixed(1)}`)
        if (mp.aav !== null) parts.push(`AAV: $${mp.aav.toFixed(2)}`)
        if (mp.health?.injury) parts.push(`⚠ ${mp.health.status || ''} ${mp.health.injury}`.trim())
      }
    }

    return parts.join(' ')
  })

  return `## VERIFIED PLAYER DATA (Use ONLY this data — do not hallucinate stats)\n${lines.join('\n')}`
}
