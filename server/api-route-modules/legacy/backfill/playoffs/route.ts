import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getLeagueInfo, getLeagueRosters } from '@/lib/sleeper-client'
import { requireLegacySleeperIdentity } from '@/lib/legacy/requireLegacySleeperIdentity'

function safeNum(v: unknown, fallback = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}
function jitter(minMs = 250, maxMs = 500) {
  const ms = Math.floor(minMs + Math.random() * (maxMs - minMs + 1))
  return new Promise((r) => setTimeout(r, ms))
}
async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, idx: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = []
  let i = 0
  const runners = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (i < items.length) {
      const idx = i++
      results[idx] = await worker(items[idx], idx)
    }
  })
  await Promise.all(runners)
  return results
}

export const POST = withApiUsage({ endpoint: "/api/legacy/backfill/playoffs", tool: "LegacyBackfillPlayoffs" })(async (request: NextRequest) => {
  const body = await request.json().catch(() => ({}))
  // A backfill WRITE keyed on the username — previously anyone could trigger a playoff
  // backfill against any account by naming it.
  const gate = await requireLegacySleeperIdentity(request, {
    requestedUsername: String(body?.sleeper_username ?? '').trim() || null,
    rateLimit: { action: 'backfill_playoffs', maxRequests: 5, windowMs: 60_000 },
  })
  if (!gate.ok) return gate.response

  const uname = gate.identity.sleeperUsername.toLowerCase()

  const legacyUser = await prisma.legacyUser.findFirst({
    where: { sleeperUsername: uname },
    select: {
      id: true,
      sleeperUsername: true,
      sleeperUserId: true,
    },
  })
  if (!legacyUser) {
    return NextResponse.json({ error: 'Legacy user not found. Run import first.' }, { status: 404 })
  }

  const leagues = await prisma.legacyLeague.findMany({
    where: { userId: legacyUser.id },
    include: { rosters: true },
    orderBy: [{ season: 'desc' }],
  })

  const tasks = leagues
    .map((lg) => {
      const myRoster =
        lg.rosters.find((r) => r.isOwner) ||
        lg.rosters.find((r) => r.ownerId === legacyUser.sleeperUserId) ||
        lg.rosters[0] ||
        null
      if (!myRoster) return null

      const needsLeaguePlayoffTeams = lg.playoffTeams == null || lg.playoffTeams <= 0
      const needsRosterSeed = myRoster.playoffSeed == null || myRoster.playoffSeed <= 0
      const needsStanding = myRoster.finalStanding == null

      if (!needsLeaguePlayoffTeams && !needsRosterSeed && !needsStanding) return null

      return {
        leagueDbId: lg.id,
        sleeperLeagueId: lg.sleeperLeagueId,
        legacyRosterId: myRoster.id,
        currentRank: myRoster.rank,
        isChampion: !!myRoster.isChampion,
        leaguePlayoffTeams: lg.playoffTeams ?? null,
      }
    })
    .filter(Boolean) as Array<{
    leagueDbId: string
    sleeperLeagueId: string
    legacyRosterId: string
    currentRank: number | null
    isChampion: boolean
    leaguePlayoffTeams: number | null
  }>

  const errors: Array<{ sleeperLeagueId: string; error: string }> = []
  let updatedRosters = 0
  let updatedLeagues = 0

  await runWithConcurrency(tasks, 3, async (t) => {
    try {
      await jitter(250, 500)

      let playoffTeams: number | null = t.leaguePlayoffTeams
      if (playoffTeams == null || playoffTeams <= 0) {
        const leagueMeta = await getLeagueInfo(t.sleeperLeagueId)

        const pt = safeNum(leagueMeta?.settings?.playoff_teams, 0)
        playoffTeams = pt > 0 ? pt : null

        if (playoffTeams != null) {
          await prisma.legacyLeague.update({
            where: { id: t.leagueDbId },
            data: { playoffTeams },
          })
          updatedLeagues++
        }
      }

      const rosters = await getLeagueRosters(t.sleeperLeagueId)

      const myRoster = rosters.find(
        (r) => {
          const coOwners = Array.isArray((r as any).co_owners) ? (r as any).co_owners.map(String) : []
          return String(r.owner_id || '') === legacyUser.sleeperUserId || coOwners.includes(legacyUser.sleeperUserId)
        }
      )
      if (!myRoster) {
        return { ok: false, reason: 'owner_not_found' as const }
      }

      const settings = (myRoster as any).settings || {}

      const playoffSeedRaw = settings.playoff_seed ?? settings.seed ?? null
      let playoffSeed = playoffSeedRaw != null ? safeNum(playoffSeedRaw, 0) || null : null

      const rankRaw = settings.rank ?? settings.final_rank ?? settings.final_rank_decimal ?? null
      const rank =
        rankRaw != null
          ? safeNum(rankRaw, 0) || null
          : (t.currentRank != null ? safeNum(t.currentRank, 0) : null)

      const finalStanding = t.isChampion ? 1 : rank

      if (playoffSeed == null && playoffTeams != null && playoffTeams > 0 && finalStanding != null && finalStanding > 0) {
        if (finalStanding <= playoffTeams) playoffSeed = finalStanding
      }

      await prisma.legacyRoster.update({
        where: { id: t.legacyRosterId },
        data: {
          ownerId: String((myRoster as any).owner_id || ''),
          isOwner: true,
          rosterId: safeNum((myRoster as any).roster_id, 0),
          playoffSeed,
          rank,
          finalStanding,
        },
      })

      updatedRosters++
      return { ok: true as const }
    } catch (e: any) {
      errors.push({
        sleeperLeagueId: t.sleeperLeagueId,
        error: String(e?.message ?? e ?? 'unknown error'),
      })
      return { ok: false as const, reason: 'error' as const }
    }
  })

  return NextResponse.json({
    success: true,
    sleeper_username: legacyUser.sleeperUsername,
    leagues_scanned: leagues.length,
    leagues_needing_backfill: tasks.length,
    leagues_updated: updatedLeagues,
    rosters_updated: updatedRosters,
    errors_count: errors.length,
    errors: errors.slice(0, 25),
    note: 'Backfill updates LegacyLeague.playoffTeams and roster playoffSeed/finalStanding. Reload AF Legacy after running.',
  })
})
