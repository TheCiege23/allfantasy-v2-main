/**
 * Survivor Exile Island: create/link exile league, enroll eliminated (PROMPT 346). Deterministic.
 */

import { prisma } from '@/lib/prisma'
import { getSurvivorConfig } from './SurvivorLeagueConfig'
import { appendSurvivorAudit } from './SurvivorAuditLog'

/**
 * Ensure Exile Island league exists and is linked. Creates a new League row for exile if needed.
 */
export async function getOrCreateExileLeague(
  mainLeagueId: string,
  options?: { sport?: string; name?: string }
): Promise<{ exileLeagueId: string; created: boolean }> {
  const config = await getSurvivorConfig(mainLeagueId)
  if (!config) throw new Error('Not a Survivor league')

  const existing = await prisma.survivorExileLeague.findUnique({
    where: { mainLeagueId },
  })
  if (existing) return { exileLeagueId: existing.exileLeagueId, created: false }

  const main = await prisma.league.findUnique({
    where: { id: mainLeagueId },
    select: { userId: true, sport: true, name: true, scoring: true, season: true, leagueSize: true },
  })
  if (!main) throw new Error('Main league not found')

  const exileLeague = await prisma.league.create({
    data: {
      userId: main.userId,
      platform: 'manual',
      platformLeagueId: `exile-${mainLeagueId}-${Date.now()}`,
      name: options?.name ?? `Exile Island: ${main.name ?? 'Survivor'}`,
      sport: (options?.sport ?? main.sport) as any,
      season: main.season,
      leagueVariant: 'survivor_exile',
      leagueSize: main.leagueSize ?? 20,
      scoring: main.scoring ?? undefined,
      isDynasty: false,
    },
  })

  await prisma.survivorExileLeague.create({
    data: {
      mainLeagueId,
      configId: config.configId,
      exileLeagueId: exileLeague.id,
    },
  })

  return { exileLeagueId: exileLeague.id, created: true }
}

/**
 * Enroll eliminated roster into Exile. Creates a roster in the exile league for the same user.
 */
export async function enrollInExile(
  mainLeagueId: string,
  rosterId: string,
  platformUserId: string
): Promise<{ ok: boolean; exileRosterId?: string; error?: string }> {
  const config = await getSurvivorConfig(mainLeagueId)
  if (!config) return { ok: false, error: 'Not a Survivor league' }

  const { exileLeagueId } = await getOrCreateExileLeague(mainLeagueId)

  const existing = await prisma.roster.findFirst({
    where: { leagueId: exileLeagueId, platformUserId },
  })
  if (existing) {
    await appendSurvivorAudit(mainLeagueId, config.configId, 'exile_enrolled', {
      rosterId,
      exileRosterId: existing.id,
    })
    return { ok: true, exileRosterId: existing.id }
  }

  const exileRoster = await prisma.roster.create({
    data: {
      leagueId: exileLeagueId,
      platformUserId,
      playerData: {},
    },
  })
  await appendSurvivorAudit(mainLeagueId, config.configId, 'exile_enrolled', {
    rosterId,
    exileRosterId: exileRoster.id,
  })
  return { ok: true, exileRosterId: exileRoster.id }
}

/**
 * Get exile league id for main league.
 */
export async function getExileLeagueId(mainLeagueId: string): Promise<string | null> {
  const row = await prisma.survivorExileLeague.findUnique({
    where: { mainLeagueId },
    select: { exileLeagueId: true },
  })
  return row?.exileLeagueId ?? null
}

/**
 * If the commissioner (Boss) outscores every exile team for the given week,
 * reset all exile token balances to zero and write an audit entry.
 */
export async function applyBossScoringReset(
  leagueId: string,
  week: number,
): Promise<{ ok: boolean; reset: boolean; error?: string }> {
  try {
    const config = await getSurvivorConfig(leagueId)
    if (!config) return { ok: false, reset: false, error: 'Not a Survivor league' }

    // League.userId is the owner/commissioner — no dedicated commissionerUserId column.
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { userId: true },
    })
    const bossUserId = league?.userId ?? null
    if (!bossUserId) return { ok: true, reset: false }

    const island = await prisma.exileIsland.findUnique({ where: { leagueId } })
    if (!island) return { ok: true, reset: false }

    const entries = await prisma.exileWeeklyEntry.findMany({
      where: { exileId: island.id, week },
      select: { userId: true, weeklyScore: true },
    })

    // Boss weekly score: top SurvivorPlayer.weeklyScore for commissioner if tracked,
    // otherwise we take the commissioner's exile entry (pre-elimination case) or 0.
    const bossEntry = entries.find((e) => e.userId === bossUserId)
    const bossScore = bossEntry?.weeklyScore ?? 0

    const exileMax = entries
      .filter((e) => e.userId !== bossUserId)
      .reduce((max, e) => (e.weeklyScore > max ? e.weeklyScore : max), -Infinity)

    if (!Number.isFinite(exileMax) || bossScore <= exileMax) {
      return { ok: true, reset: false }
    }

    await prisma.survivorPlayer.updateMany({
      where: { leagueId, playerState: 'exile' },
      data: { tokenBalance: 0 },
    })
    await appendSurvivorAudit(leagueId, config.configId, 'token_reset' as any, {
      bossWon: true,
      week,
      bossUserId,
      bossScore,
      exileMax,
    })
    return { ok: true, reset: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, reset: false, error: msg }
  }
}

/**
 * Pick the single exile user to return using this tiebreaker cascade:
 *   1) highest current token balance
 *   2) most lifetime tokens earned
 *   3) highest single-week exile score
 *   4) earliest elimination (longest in exile)
 *   5) seeded random (stable on leagueId)
 */
export async function resolveExileReturn(leagueId: string): Promise<string | null> {
  try {
    const players = await prisma.survivorPlayer.findMany({
      where: { leagueId, playerState: 'exile' },
      select: {
        userId: true,
        tokenBalance: true,
        totalTokensEarned: true,
        eliminatedWeek: true,
      },
    })
    if (players.length === 0) return null

    const island = await prisma.exileIsland.findUnique({ where: { leagueId } })
    const entries = island
      ? await prisma.exileWeeklyEntry.findMany({
          where: { exileId: island.id },
          select: { userId: true, weeklyScore: true },
        })
      : []
    const bestWeekByUser = new Map<string, number>()
    for (const e of entries) {
      const prev = bestWeekByUser.get(e.userId) ?? -Infinity
      if (e.weeklyScore > prev) bestWeekByUser.set(e.userId, e.weeklyScore)
    }

    const enriched = players.map((p) => ({
      userId: p.userId,
      tokens: p.tokenBalance ?? 0,
      lifetime: p.totalTokensEarned ?? 0,
      bestWeek: bestWeekByUser.get(p.userId) ?? -Infinity,
      // Earlier eliminations => smaller week number => comes first (longest exile).
      eliminatedWeek: p.eliminatedWeek ?? Number.POSITIVE_INFINITY,
    }))

    // Seeded tiebreaker: deterministic per leagueId.
    let seed = 0
    for (let i = 0; i < leagueId.length; i++) seed = (seed * 31 + leagueId.charCodeAt(i)) >>> 0
    enriched.sort((a, b) => {
      if (b.tokens !== a.tokens) return b.tokens - a.tokens
      if (b.lifetime !== a.lifetime) return b.lifetime - a.lifetime
      if (b.bestWeek !== a.bestWeek) return b.bestWeek - a.bestWeek
      if (a.eliminatedWeek !== b.eliminatedWeek) return a.eliminatedWeek - b.eliminatedWeek
      // Deterministic pseudo-random by userId + seed
      const ha = hashWithSeed(a.userId, seed)
      const hb = hashWithSeed(b.userId, seed)
      return ha - hb
    })

    return enriched[0]?.userId ?? null
  } catch {
    return null
  }
}

function hashWithSeed(input: string, seed: number): number {
  let h = seed
  for (let i = 0; i < input.length; i++) {
    h = (h * 16777619) ^ input.charCodeAt(i)
    h = h >>> 0
  }
  return h
}
