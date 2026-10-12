import { isNativePlatform } from '@/lib/dashboard/platform-label'
import { scoreExileWeek } from './exileEngine'
/**
 * Exile Team Draft — waiver-based claims for exile-side "real-world team" drafting.
 *
 * Backs the new exile_team_claims / exile_team_rosters tables via raw SQL until
 * the Prisma client is regenerated. All writes are defensive so a missing table
 * (fresh dev db) never takes down automation.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { keyPositionForSport } from './constants'
import { logSurvivorAuditEntry } from './auditEntry'

type PendingClaim = {
  id: string
  league_id: string
  user_id: string
  real_player_id: string
  week: number | null
  priority: number
}

type ExileRosterRow = {
  id: string
  league_id: string
  user_id: string
  real_team_id: string
  real_player_ids: string[] | null
}

function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

let ensureClaimWeekColumnPromise: Promise<void> | null = null

async function ensureExileClaimWeekColumn(): Promise<void> {
  if (!ensureClaimWeekColumnPromise) {
    ensureClaimWeekColumnPromise = prisma.$executeRawUnsafe(
      `ALTER TABLE exile_team_claims ADD COLUMN IF NOT EXISTS week INTEGER`,
    )
      .then(() => {})
      .catch(() => {})
  }
  await ensureClaimWeekColumnPromise
}

/** Submit a waiver-style claim for an exile-team draft target. */
export async function submitExileTeamClaim(params: {
  leagueId: string
  userId: string
  realPlayerId: string
  week: number
  priority?: number
}): Promise<{ ok: boolean; claimId?: string; error?: string }> {
  const { leagueId, userId, realPlayerId } = params
  const priority =
    typeof params.priority === 'number' && Number.isFinite(params.priority)
      ? Math.trunc(params.priority)
      : 100
  const week =
    Number.isInteger(params.week) && params.week >= 1
      ? Math.trunc(params.week)
      : null
  if (week == null) {
    return { ok: false, error: 'week must be a positive integer' }
  }
  try {
    await ensureExileClaimWeekColumn()
    // Use parameterized $queryRaw so no user-controlled value is interpolated.
    const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      INSERT INTO exile_team_claims (league_id, user_id, real_player_id, week, priority, status)
      VALUES (${leagueId}, ${userId}, ${realPlayerId}, ${week}, ${priority}, 'pending')
      RETURNING id
    `)
    return { ok: true, claimId: rows?.[0]?.id }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }
  }
}

/**
 * Process pending claims for a league in priority order. If a claimed player
 * plays the sport's key position, award their entire real-world team to the
 * claimant and strip that team from other exile rosters.
 */
export async function processExileTeamClaims(
  leagueId: string,
  week?: number,
): Promise<{ ok: boolean; processed: number; error?: string }> {
  const normalizedWeek =
    typeof week === 'number' && Number.isFinite(week) ? Math.trunc(week) : null
  try {
    await ensureExileClaimWeekColumn()
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { sport: true },
    })
    const keyPos = keyPositionForSport(league?.sport ?? null).code
    const weekClause =
      normalizedWeek != null && normalizedWeek > 0
        ? ` AND (week IS NULL OR week = ${normalizedWeek})`
        : ''

    const claims = await prisma.$queryRawUnsafe<PendingClaim[]>(
      `SELECT id, league_id, user_id, real_player_id, week, priority
       FROM exile_team_claims
       WHERE league_id = ${quote(leagueId)} AND status = 'pending'${weekClause}
       ORDER BY priority ASC, submitted_at ASC`,
    )
    if (!claims || claims.length === 0) return { ok: true, processed: 0 }

    let processed = 0
    for (const claim of claims) {
      try {
        const player = await prisma.player.findUnique({
          where: { id: claim.real_player_id },
          select: { id: true, team: true, position: true },
        })
        if (!player || !player.team) {
          await prisma.$executeRawUnsafe(
            `UPDATE exile_team_claims
             SET status = 'rejected', processed_at = now()
             WHERE id = ${quote(claim.id)}`,
          )
          continue
        }

        const isAnchor =
          typeof player.position === 'string' &&
          player.position.toUpperCase() === keyPos.toUpperCase()

        // Award the individual player to the claimant's roster row for this team.
        const existing = await prisma.$queryRawUnsafe<ExileRosterRow[]>(
          `SELECT id, league_id, user_id, real_team_id, real_player_ids
           FROM exile_team_rosters
           WHERE league_id = ${quote(leagueId)}
             AND user_id = ${quote(claim.user_id)}
             AND real_team_id = ${quote(player.team)}
           LIMIT 1`,
        )

        if (existing && existing.length > 0) {
          await prisma.$executeRawUnsafe(
            `UPDATE exile_team_rosters
             SET real_player_ids =
               CASE WHEN ${quote(player.id)} = ANY(real_player_ids)
                 THEN real_player_ids
                 ELSE array_append(real_player_ids, ${quote(player.id)})
               END
             WHERE id = ${quote(existing[0].id)}`,
          )
        } else {
          await prisma.$executeRawUnsafe(
            `INSERT INTO exile_team_rosters (league_id, user_id, real_team_id, real_player_ids)
             VALUES (${quote(leagueId)}, ${quote(claim.user_id)}, ${quote(player.team)}, ARRAY[${quote(player.id)}]::text[])`,
          )
        }

        // Anchor claim: assign the whole real team to this user and strip from others.
        if (isAnchor) {
          const teammates = await prisma.player.findMany({
            where: { team: player.team },
            select: { id: true },
          })
          const ids = teammates.map((p) => p.id)
          if (ids.length > 0) {
            const arrayLit = `ARRAY[${ids.map(quote).join(',')}]::text[]`
            await prisma.$executeRawUnsafe(
              `UPDATE exile_team_rosters
               SET real_player_ids = ${arrayLit}
               WHERE league_id = ${quote(leagueId)}
                 AND user_id = ${quote(claim.user_id)}
                 AND real_team_id = ${quote(player.team)}`,
            )
            // Remove those players from every other exile roster in this league.
            await prisma.$executeRawUnsafe(
              `UPDATE exile_team_rosters
               SET real_player_ids = ARRAY(
                 SELECT UNNEST(real_player_ids) EXCEPT SELECT UNNEST(${arrayLit})
               )
               WHERE league_id = ${quote(leagueId)}
                 AND user_id <> ${quote(claim.user_id)}`,
            )
          }
          await logSurvivorAuditEntry({
            leagueId,
            week: claim.week ?? normalizedWeek ?? null,
            category: 'exile',
            action: 'EXILE_TEAM_ANCHOR_AWARDED',
            targetUserId: claim.user_id,
            data: {
              realPlayerId: player.id,
              realTeamId: player.team,
              keyPosition: keyPos,
            },
            isVisibleToPublic: false,
          }).catch(() => {})
        }

        await prisma.$executeRawUnsafe(
          `UPDATE exile_team_claims
           SET status = 'processed', processed_at = now()
           WHERE id = ${quote(claim.id)}`,
        )
        processed++
      } catch {
        await prisma.$executeRawUnsafe(
          `UPDATE exile_team_claims
           SET status = 'failed', processed_at = now()
           WHERE id = ${quote(claim.id)}`,
        ).catch(() => {})
      }
    }
    return { ok: true, processed }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, processed: 0, error: msg }
  }
}

/**
 * Return the set of real-world team IDs already assigned to an exile
 * roster in a league. This is NOT a list of available teams — the
 * authoritative team catalog lives in the sport feed, not in this
 * service. Callers diff this "taken" set against their own catalog to
 * render the available list. Exposed as both a Set-returning helper
 * and a typed result for the API route.
 */
export async function getTakenExileTeamIds(leagueId: string): Promise<Set<string>> {
  try {
    const rows = await prisma.$queryRawUnsafe<{ real_team_id: string }[]>(
      `SELECT DISTINCT real_team_id FROM exile_team_rosters WHERE league_id = ${quote(leagueId)}`,
    )
    return new Set((rows ?? []).map((r) => r.real_team_id))
  } catch {
    return new Set()
  }
}

/**
 * API-shaped result for the `available_teams` intent. Returns the
 * `takenTeamIds` array only — the client merges this with its sport
 * catalog to render the available list. The old name
 * `getAvailableTeamsForExile` was misleading (it returned taken, not
 * available) so callers should use this shape.
 */
export async function getExileTeamDraftStatus(
  leagueId: string,
  _week: number,
  _sport: string,
): Promise<{ takenTeamIds: string[] }> {
  const taken = await getTakenExileTeamIds(leagueId)
  return { takenTeamIds: Array.from(taken) }
}

/** Return all exile-team roster rows owned by a user in a league. */
export async function getExileRoster(
  leagueId: string,
  userId: string,
): Promise<{ realTeamId: string; realPlayerIds: string[] }[]> {
  try {
    const rows = await prisma.$queryRawUnsafe<ExileRosterRow[]>(
      `SELECT id, league_id, user_id, real_team_id, real_player_ids
       FROM exile_team_rosters
       WHERE league_id = ${quote(leagueId)} AND user_id = ${quote(userId)}`,
    )
    return (rows ?? []).map((r) => ({
      realTeamId: r.real_team_id,
      realPlayerIds: r.real_player_ids ?? [],
    }))
  } catch {
    return []
  }
}

/**
 * Award the weekly exile-team token to the top-scoring exile team. If the
 * commissioner (Boss) scored highest, all exile-team tokens reset to zero.
 */
export async function awardWeeklyExileTeamToken(
  leagueId: string,
): Promise<{ ok: boolean; winnerUserId?: string; bossReset?: boolean; error?: string }> {
  try {
    const island = await prisma.exileIsland.findUnique({ where: { leagueId } })
    if (!island) return { ok: true }

    // League has no dedicated commissionerUserId column — `userId` is the
    // owner/commissioner on this model.
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { userId: true, platform: true },
    }).catch(() => null)
    if (league && isNativePlatform(league.platform)) {
      await scoreExileWeek(leagueId, island.currentWeek)
      return { ok: true }
    }
    const commissionerUserId = league?.userId ?? null

    const entries = await prisma.exileWeeklyEntry.findMany({
      where: { exileId: island.id, week: island.currentWeek },
      select: { userId: true, weeklyScore: true },
    })
    if (entries.length === 0) return { ok: true }

    let top: { userId: string; weeklyScore: number } | null = null
    for (const e of entries) {
      if (!top || e.weeklyScore > top.weeklyScore) top = e
    }
    if (!top) return { ok: true }

    if (commissionerUserId && top.userId === commissionerUserId) {
      await prisma.survivorPlayer.updateMany({
        where: { leagueId, playerState: 'exile' },
        data: { tokenBalance: 0 },
      })
      await logSurvivorAuditEntry({
        leagueId,
        week: island.currentWeek,
        category: 'token',
        action: 'EXILE_TEAM_BOSS_RESET',
        data: { bossUserId: commissionerUserId, week: island.currentWeek },
        isVisibleToPublic: false,
      }).catch(() => {})
      return { ok: true, bossReset: true }
    }

    await prisma.survivorPlayer.updateMany({
      where: { leagueId, userId: top.userId },
      data: { tokenBalance: { increment: 1 } },
    })
    await logSurvivorAuditEntry({
      leagueId,
      week: island.currentWeek,
      category: 'token',
      action: 'EXILE_TEAM_WEEKLY_TOKEN',
      targetUserId: top.userId,
      data: { userId: top.userId, week: island.currentWeek, delta: 1 },
      isVisibleToPublic: false,
    }).catch(() => {})
    return { ok: true, winnerUserId: top.userId }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }
  }
}
