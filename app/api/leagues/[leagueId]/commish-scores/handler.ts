/**
 * /api/leagues/[leagueId]/commish-scores — "Edit Matchup Scores" for native leagues.
 *
 * GET   ?week=N → the season's editable weeks and week N's matchups with both scores.
 * PATCH { week, scores: [{ matchupId, homeScore, awayScore? }] } → writes the scores, then rebuilds
 *       every record (W/L/T, points for/against, streak, seeds, median game) from the matchup rows.
 *
 * Commish or co-commish. Only COMPLETED regular-season weeks: `1 <= week < currentWeek` and below the
 * playoff start (playoff weeks live in RedraftPlayoffMatchup, not here).
 *
 * ⚠ Edited rows are written `status: 'final'`. That is the flag the score-sync cron and the week
 * finalizer honour, so a past final week is never re-scored from stats behind the commish's back.
 * A commish who later runs a stat re-score for that week (live-scoring `recalculate_week`) replaces
 * these edits on purpose; each edit is stamped in `lineupSnapshots.commissionerEdit` and the audit log.
 *
 * ⚠ `updateStandings` rebuilds cumulatively over `week <= throughWeek`, so it is called with the
 * latest completed week — passing the edited week would drop every later week from the totals.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { Prisma } from '@prisma/client'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getLeagueRole, isCommissionerRole } from '@/lib/league/permissions'
import { updateStandings } from '@/lib/redraft/standingsEngine'
import { editableWeeks } from '@/lib/redraft/completedWeeks'
import { logAction } from '@/server/services/auditService'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ leagueId: string }> | { leagueId: string } }
export const MAX_SCORE = 9999

async function authorize(ctx: Ctx): Promise<{ leagueId: string; userId: string } | NextResponse> {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const leagueId = ((await ctx.params)?.leagueId ?? '').trim()
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
  if (!isCommissionerRole(await getLeagueRole(leagueId, userId))) {
    return NextResponse.json({ error: 'Only the commish or a co-commish can edit scores.' }, { status: 403 })
  }
  return { leagueId, userId }
}

async function loadSeason(leagueId: string) {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { season: true } })
  const select = { id: true, season: true, currentWeek: true, playoffStartWeek: true } as const
  return (
    (league?.season != null
      ? await prisma.redraftSeason.findFirst({ where: { leagueId, season: league.season }, select })
      : null) ??
    (await prisma.redraftSeason.findFirst({ where: { leagueId }, orderBy: { season: 'desc' }, select }))
  )
}

/** Completed regular-season weeks, newest first (lib/redraft/completedWeeks.ts). Re-exported for tests. */
export { editableWeeks }

function round2(n: number) {
  return Math.round(n * 100) / 100
}

/** A score is a finite number from 0 to MAX_SCORE; stored to 2 decimals. Exported for tests. */
export function parseScore(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 && n <= MAX_SCORE ? round2(n) : null
}

async function weekPayload(seasonId: string, week: number) {
  const rows = await prisma.redraftMatchup.findMany({
    where: { seasonId, week, isMedianMatchup: false },
    select: {
      id: true,
      homeRosterId: true,
      awayRosterId: true,
      homeScore: true,
      awayScore: true,
      status: true,
      lineupSnapshots: true,
    },
    orderBy: { id: 'asc' },
  })
  const ids = [...new Set(rows.flatMap((r) => [r.homeRosterId, r.awayRosterId].filter(Boolean) as string[]))]
  const rosters = await prisma.redraftRoster.findMany({
    where: { id: { in: ids } },
    select: { id: true, teamName: true, ownerName: true, wins: true, losses: true, ties: true },
  })
  const byId = new Map(rosters.map((r) => [r.id, r]))
  const team = (id: string | null) => {
    if (!id) return null
    const r = byId.get(id)
    return {
      rosterId: id,
      name: r?.teamName?.trim() || r?.ownerName?.trim() || `Team ${id.slice(0, 6)}`,
      record: r ? `${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ''}` : '',
    }
  }
  return rows.map((r) => {
    const snap = (r.lineupSnapshots ?? {}) as Record<string, unknown>
    return {
      matchupId: r.id,
      home: team(r.homeRosterId),
      away: team(r.awayRosterId),
      homeScore: r.homeScore,
      awayScore: r.awayRosterId ? r.awayScore : null,
      status: r.status,
      editedByCommish: Boolean(snap.commissionerEdit),
    }
  })
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const auth = await authorize(ctx)
  if (auth instanceof NextResponse) return auth
  const season = await loadSeason(auth.leagueId)
  if (!season) return NextResponse.json({ error: 'This league has no AllFantasy season to edit.' }, { status: 404 })

  const weeks = editableWeeks(season.currentWeek, season.playoffStartWeek)
  const asked = Number(new URL(req.url).searchParams.get('week'))
  const week = weeks.includes(asked) ? asked : (weeks[0] ?? null)
  return NextResponse.json({
    season: season.season,
    currentWeek: season.currentWeek,
    weeks,
    week,
    matchups: week == null ? [] : await weekPayload(season.id, week),
  })
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const auth = await authorize(ctx)
  if (auth instanceof NextResponse) return auth
  const { leagueId, userId } = auth

  const season = await loadSeason(leagueId)
  if (!season) return NextResponse.json({ error: 'This league has no AllFantasy season to edit.' }, { status: 404 })

  const body = (await req.json().catch(() => ({}))) as { week?: unknown; scores?: unknown }
  const week = Number(body.week)
  if (!editableWeeks(season.currentWeek, season.playoffStartWeek).includes(week)) {
    return NextResponse.json({ error: 'Only completed regular-season weeks can be edited.' }, { status: 400 })
  }
  if (!Array.isArray(body.scores) || body.scores.length === 0) {
    return NextResponse.json({ error: 'scores required' }, { status: 400 })
  }

  const rows = await prisma.redraftMatchup.findMany({
    where: { seasonId: season.id, week, isMedianMatchup: false },
    select: { id: true, awayRosterId: true, homeScore: true, awayScore: true, status: true, lineupSnapshots: true },
  })
  const byId = new Map(rows.map((r) => [r.id, r]))

  const edits: Array<{ id: string; homeScore: number; awayScore: number | null }> = []
  const seen = new Set<string>()
  for (const raw of body.scores) {
    const s = (raw ?? {}) as Record<string, unknown>
    const id = String(s.matchupId ?? '')
    const row = byId.get(id)
    if (!row) return NextResponse.json({ error: 'A matchup is not in this week.' }, { status: 400 })
    if (seen.has(id)) return NextResponse.json({ error: 'A matchup appears twice.' }, { status: 400 })
    seen.add(id)
    const home = parseScore(s.homeScore)
    const away = row.awayRosterId ? parseScore(s.awayScore) : null
    if (home == null || (row.awayRosterId && away == null)) {
      return NextResponse.json({ error: `Scores must be numbers from 0 to ${MAX_SCORE}.` }, { status: 400 })
    }
    edits.push({ id, homeScore: home, awayScore: away })
  }

  const now = new Date().toISOString()
  await prisma.$transaction(
    edits.map((e) => {
      const before = byId.get(e.id)!
      const snap = (before.lineupSnapshots ?? {}) as Record<string, unknown>
      return prisma.redraftMatchup.update({
        where: { id: e.id },
        data: {
          homeScore: e.homeScore,
          ...(e.awayScore != null ? { awayScore: e.awayScore } : {}),
          status: 'final',
          lineupSnapshots: {
            ...snap,
            commissionerEdit: {
              by: userId,
              at: now,
              before: { homeScore: before.homeScore, awayScore: before.awayScore, status: before.status },
            },
          } as Prisma.InputJsonValue,
        },
      })
    }),
  )

  // Rebuild through the latest completed week (cumulative), never just the edited one.
  const throughWeek = Math.max(week, season.currentWeek - 1)
  const standings = await updateStandings(season.id, throughWeek)

  await logAction({
    leagueId,
    userId,
    actionType: 'commish_edit_matchup_scores',
    entityType: 'redraft_matchup',
    entityId: `${season.id}:${week}`,
    beforeState: edits.map((e) => ({
      matchupId: e.id,
      homeScore: byId.get(e.id)!.homeScore,
      awayScore: byId.get(e.id)!.awayRosterId ? byId.get(e.id)!.awayScore : null,
    })),
    afterState: edits.map((e) => ({ matchupId: e.id, homeScore: e.homeScore, awayScore: e.awayScore })),
    metadata: { week, throughWeek, rostersUpdated: standings.rostersUpdated },
  }).catch(() => undefined)

  return NextResponse.json({
    ok: true,
    week,
    recalculatedThroughWeek: throughWeek,
    matchups: await weekPayload(season.id, week),
  })
}
