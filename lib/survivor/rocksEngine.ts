/**
 * Go to Rocks engine for Survivor League tiebreaker resolution.
 *
 * When a Elimination Council vote results in a tie and the configured tie rule
 * includes "rocks", eligible non-tied, non-immune players draw rocks.
 * One player is randomly eliminated via seeded RNG for auditability.
 */

import { prisma } from '@/lib/prisma'

export interface RocksDrawResult {
  councilId: string
  tiedRosterIds: string[]
  eligibleDrawerIds: string[]
  eliminatedRosterId: string
  eliminatedName: string
  seed: string
  drawOrder: Array<{ rosterId: string; displayName: string; drewPurpleRock: boolean }>
}

/**
 * Seeded deterministic RNG for auditable rock draws.
 * Same seed always produces same elimination — commissioners can verify.
 */
function seededRandom(seed: string): () => number {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i)
    hash = ((hash << 5) - hash + char) | 0
  }
  return () => {
    hash = (hash * 1664525 + 1013904223) | 0
    return ((hash >>> 0) / 0xffffffff)
  }
}

/**
 * Determine which rosters are eligible to draw rocks.
 * Rules: attending council, NOT immune, NOT one of the tied players.
 */
export async function getRocksEligibleRosterIds(
  councilId: string,
  tiedRosterIds: string[],
): Promise<string[]> {
  const council = await (prisma as any).survivorTribalCouncil.findUnique({
    where: { id: councilId },
    include: { votes: true },
  })
  if (!council) return []

  // Get all rosters that voted (i.e., attending council)
  const voterRosterIds = [...new Set(council.votes.map((v: any) => v.voterRosterId))] as string[]

  // Get immune rosters from SurvivorPlayer
  const immunePlayers = await (prisma as any).survivorPlayer.findMany({
    where: {
      leagueId: council.leagueId,
      hasImmunityThisWeek: true,
    },
    select: { id: true },
  })
  const immuneIds = new Set(immunePlayers.map((p: any) => p.id))
  const tiedSet = new Set(tiedRosterIds)

  return voterRosterIds.filter(
    (id) => !tiedSet.has(id) && !immuneIds.has(id)
  )
}

/**
 * Execute the rocks draw. One eligible, non-tied, non-immune player
 * is eliminated. Uses seeded RNG so the result is reproducible.
 */
export async function executeRocksDraw(
  councilId: string,
  seed?: string,
): Promise<RocksDrawResult | null> {
  const council = await (prisma as any).survivorTribalCouncil.findUnique({
    where: { id: councilId },
  })
  if (!council || !council.isTie) return null

  const tiedRosterIds = council.tiePlayerIds as string[]
  if (!tiedRosterIds.length) return null

  const eligibleIds = await getRocksEligibleRosterIds(councilId, tiedRosterIds)
  if (!eligibleIds.length) {
    // Edge case: no eligible drawers (all immune/tied). Fall back to tied players.
    // In real Survivor, this forces a consensus or commissioner decision.
    return null
  }

  // Get display names
  const players = await (prisma as any).survivorPlayer.findMany({
    where: { id: { in: eligibleIds }, leagueId: council.leagueId },
    select: { id: true, displayName: true },
  })
  const nameMap = new Map<string, string>(players.map((p: any) => [p.id, p.displayName ?? 'Unknown']))

  // Generate seed if not provided
  const drawSeed = seed ?? `rocks-${councilId}-${Date.now()}`
  const rng = seededRandom(drawSeed)

  // Shuffle eligible drawers
  const shuffled = [...eligibleIds]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!]
  }

  // First in shuffled order draws the purple rock (eliminated)
  const eliminatedRosterId = shuffled[0]!
  const eliminatedName = nameMap.get(eliminatedRosterId) ?? 'Unknown'

  const drawOrder = shuffled.map((id, index) => ({
    rosterId: id,
    displayName: nameMap.get(id) ?? 'Unknown',
    drewPurpleRock: index === 0,
  }))

  // Update the council record
  await (prisma as any).survivorTribalCouncil.update({
    where: { id: councilId },
    data: {
      tiePhase: 'rocks_resolved',
      rockDrawerUserId: eliminatedRosterId,
      eliminatedRosterId,
      eliminatedName,
      closedAt: new Date(),
      status: 'completed',
      auditLog: {
        ...(typeof council.auditLog === 'object' && council.auditLog != null ? council.auditLog : {}),
        rocksDraw: {
          seed: drawSeed,
          tiedRosterIds,
          eligibleDrawerIds: eligibleIds,
          eliminatedRosterId,
          drawOrder,
          executedAt: new Date().toISOString(),
        },
      },
    },
  })

  // Create audit entry
  await (prisma as any).survivorAuditEntry.create({
    data: {
      leagueId: council.leagueId,
      week: council.week,
      category: 'tribal_council',
      action: 'rocks_draw',
      targetUserId: eliminatedRosterId,
      data: {
        councilId,
        seed: drawSeed,
        tiedRosterIds,
        eligibleDrawerIds: eligibleIds,
        eliminatedRosterId,
        drawOrder,
      },
      isVisibleToCommissioner: true,
      isVisibleToPublic: false,
      isRevealablePostSeason: true,
    },
  })

  return {
    councilId,
    tiedRosterIds,
    eligibleDrawerIds: eligibleIds,
    eliminatedRosterId,
    eliminatedName,
    seed: drawSeed,
    drawOrder,
  }
}

/**
 * Check if a council should go to rocks based on league config.
 */
export async function shouldGoToRocks(leagueId: string): Promise<boolean> {
  const league = await (prisma as any).league.findUnique({
    where: { id: leagueId },
    select: { survivorTieRule: true, survivorRocksEnabled: true },
  })
  if (!league) return false
  return (
    league.survivorRocksEnabled === true &&
    (league.survivorTieRule === 'rocks' || league.survivorTieRule === 'revote_then_rocks')
  )
}
