import 'server-only'

import { prisma } from '@/lib/prisma'
import { resolveLeagueMembership } from '@/lib/league-access'

/**
 * THE COMMISSIONER'S VIEW — everyone's league, not just yours.
 *
 * ⚠ GATED ON `resolveLeagueMembership`, THE ONE PREDICATE. This block exposes
 * OTHER managers' FAAB, waiver priority and draft participation, so the gate is
 * the whole security surface. Four different commissioner predicates exist in
 * this codebase and they disagree; using any of the others here would eventually
 * hand one manager a view of everybody else's league position. Non-commissioners
 * get null, not a filtered block.
 *
 * ⚠ IT INFORMS, IT DOES NOT INSTRUCT. Per the confirmed product direction a
 * commissioner asks Chimmy what the league looks like — health, who is active,
 * how trades have gone, where waivers stand, what the draft options are — and
 * decides for themselves. Chimmy does not tell a commissioner to veto, remove,
 * pause, or discipline anyone.
 *
 * ⚠ UNCLAIMED IS NOT INACTIVE. 984 of 1,078 league_teams rows carry no
 * `claimedByUserId` (measured 2026-08-25) because imported leagues do not claim
 * teams — it says nothing about whether a manager is engaged. Reporting it as
 * inactivity would tell a commissioner that 91% of their league has checked out,
 * which is false and actionable in the worst way. This block reads DRAFT
 * PARTICIPATION for activity instead, and states the caveat out loud.
 */

/** A full league fits; beyond this the prompt is being abused. */
const MAX_TEAMS = 20

type RosterRow = {
  ownerId: string
  ownerName: string
  teamName: string | null
  faabBalance: number | null
  waiverPriority: number
  wins: number
  losses: number
}

/**
 * League-wide facts for a commissioner. Returns null for anyone who is not one,
 * and for a league we cannot read.
 */
export async function buildCommissionerContext(
  leagueId: string,
  userId: string,
): Promise<string | null> {
  if (!leagueId || !userId) return null

  // The gate. Everything below is other people's data.
  let isCommissioner = false
  try {
    const membership = await resolveLeagueMembership(leagueId, userId)
    if (!membership.ok) return null
    isCommissioner = membership.access.isCommissioner
  } catch {
    return null
  }
  if (!isCommissioner) return null

  const lines: string[] = [
    'COMMISSIONER VIEW (this user runs this league, so league-wide facts are in scope).',
  ]

  // ── League health ──────────────────────────────────────────────────────────
  try {
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { name: true, leagueSize: true, lastSyncedAt: true, status: true, platform: true },
    })
    if (league) {
      lines.push(
        `League: ${league.name ?? leagueId} (${league.platform}${league.leagueSize ? `, ${league.leagueSize} teams` : ''}${league.status ? `, status ${league.status}` : ''}).`,
      )
      lines.push(
        league.lastSyncedAt
          ? `Last synced ${league.lastSyncedAt.toISOString()}.`
          : 'NEVER SYNCED — say so if asked about data freshness; anything below may be incomplete.',
      )
    }
  } catch {
    /* the rest still stands */
  }

  // ── Everyone's waiver standing ─────────────────────────────────────────────
  let rosters: RosterRow[] = []
  try {
    const season = await prisma.redraftSeason.findFirst({
      where: { leagueId },
      orderBy: { season: 'desc' },
      select: { id: true },
    })
    if (season) {
      rosters = (await prisma.redraftRoster.findMany({
        where: { seasonId: season.id },
        take: MAX_TEAMS,
        select: {
          ownerId: true,
          ownerName: true,
          teamName: true,
          faabBalance: true,
          waiverPriority: true,
          wins: true,
          losses: true,
        },
      })) as unknown as RosterRow[]
    }
  } catch {
    rosters = []
  }

  if (rosters.length > 0) {
    lines.push(
      `Waiver standing, all ${rosters.length} teams: ${rosters
        .map(
          (r) =>
            `${r.teamName ?? r.ownerName} (FAAB ${r.faabBalance ?? 'n/a'}, priority ${r.waiverPriority})`,
        )
        .join('; ')}.`,
    )
  }

  // ── Activity, read from the draft rather than from claims ──────────────────
  try {
    const session = await prisma.draftSession.findUnique({
      where: { leagueId },
      select: { id: true, status: true, draftType: true, rounds: true, teamCount: true, timerSeconds: true },
    })
    if (session) {
      lines.push(
        `Draft: ${session.status}, ${session.draftType}, ${session.rounds} rounds, ${session.teamCount} teams${session.timerSeconds ? `, ${session.timerSeconds}s per pick` : ''}.`,
      )
      if (session.status === 'pre_draft') {
        lines.push(
          'Draft has not started. Scheduling options a commissioner can ask about: pick timer length, rounds, draft type, third-round reversal, and the slot order. Present these as OPTIONS and their trade-offs, never as what they should choose.',
        )
      } else {
        const picks = await prisma.draftPick.groupBy({
          by: ['rosterId'],
          where: { sessionId: session.id },
          _count: { rosterId: true },
        })
        if (picks.length > 0) {
          const counts = picks
            .map((p) => `${p.rosterId}: ${p._count.rosterId}`)
            .join(', ')
          lines.push(`Picks made per roster (activity signal): ${counts}.`)
          lines.push(
            'A roster with noticeably fewer picks than the others may be autodrafting or absent — say that it LOOKS that way and why, never that they are inactive as fact.',
          )
        }
      }
    }
  } catch {
    /* non-fatal */
  }

  // ── How trades have gone ───────────────────────────────────────────────────
  try {
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { platformLeagueId: true },
    })
    if (league?.platformLeagueId) {
      const histories = await prisma.leagueTradeHistory.findMany({
        where: { sleeperLeagueId: league.platformLeagueId },
        select: { id: true },
      })
      if (histories.length > 0) {
        const tradeCount = await prisma.leagueTrade.count({
          where: { historyId: { in: histories.map((h) => h.id) } },
        })
        lines.push(
          `Trade volume on file: ${tradeCount} recorded trades (completed, from the platform — NOT proposals awaiting review).`,
        )
        lines.push(
          'No trade VALUES are stored for these, so do not grade them or say who won. There is no pending-trade queue to review.',
        )
      }
    }
  } catch {
    /* non-fatal */
  }

  /*
   * The two rules that decide whether this block helps or harms.
   */
  lines.push(
    'CAVEAT ON ACTIVITY: most teams in imported leagues are UNCLAIMED in our data, which reflects how import works and NOT whether a manager is engaged. Never report unclaimed teams as inactive managers.',
  )
  lines.push(
    'RULES: answer what the league looks like and what the options are. Do NOT tell the commissioner to veto, reverse, remove, replace, pause or discipline anyone, and do NOT recommend a punishment. AllFantasy changes nothing on the platform — point them at their platform to act.',
  )

  return lines.join('\n')
}
