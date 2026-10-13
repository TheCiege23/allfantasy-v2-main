/**
 * /api/leagues/[leagueId]/commish-lineup — the commish lineup editor.
 *
 * GET              → every team (to choose one).
 * GET ?rosterId=…  → that team's starting slots, players and current lineup for this week.
 * GET ?rosterId=…&week=N → that team's saved lineup for completed week N.
 * PUT { rosterId, lineup: { starters: [id|'' per slot], bench, ir, taxi, devy } } → saves it.
 * PUT { rosterId, week: N, lineup } → rewrites week N's lineup, re-scores its matchup and the standings.
 *
 * Commish or co-commish. The rules are in lib/league/commishLineupEdits.ts; the write is the lineup
 * engine's commish override, which keeps scoring in step, audits, and announces the change.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getLeagueRole, isCommissionerRole } from '@/lib/league/permissions'
import { buildRosterLabelMap } from '@/lib/scoring-engine/resolveTeamLabels'
import {
  CommishLineupError,
  RESERVE_SECTIONS,
  loadCommishLineup,
  loadCommishPastLineup,
  saveCommishLineup,
  saveCommishPastLineup,
  type CommishLineupInput,
} from '@/lib/league/commishLineupEdits'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ leagueId: string }> | { leagueId: string } }

async function authorize(ctx: Ctx): Promise<{ leagueId: string; userId: string } | NextResponse> {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const leagueId = ((await ctx.params)?.leagueId ?? '').trim()
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
  if (!isCommissionerRole(await getLeagueRole(leagueId, userId))) {
    return NextResponse.json({ error: 'Only the commish or a co-commish can edit lineups.' }, { status: 403 })
  }
  return { leagueId, userId }
}

/** Body → a typed lineup, or null when the shape is wrong. Exported for tests. */
export function parseCommishLineup(body: unknown): { rosterId: string; lineup: CommishLineupInput } | null {
  const b = (body ?? {}) as Record<string, unknown>
  const l = (b.lineup ?? null) as Record<string, unknown> | null
  if (typeof b.rosterId !== 'string' || !b.rosterId.trim() || !l || !Array.isArray(l.starters)) return null
  const ids = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean) : [])
  const lineup = {
    starters: l.starters.map((x) => (x == null ? '' : String(x).trim())),
    ...Object.fromEntries(RESERVE_SECTIONS.map((k) => [k, ids(l[k])])),
  } as CommishLineupInput
  return { rosterId: b.rosterId.trim(), lineup }
}

/** A past week from a query or body value: a positive whole number, or null for "this week". */
export function parseWeek(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null
  const n = Number(raw)
  return Number.isInteger(n) && n >= 1 ? n : null
}

function errorResponse(e: unknown) {
  if (e instanceof CommishLineupError) return NextResponse.json({ error: e.message }, { status: e.status })
  throw e
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const auth = await authorize(ctx)
  if (auth instanceof NextResponse) return auth
  const rosterId = new URL(req.url).searchParams.get('rosterId')?.trim()
  if (!rosterId) {
    const [rosters, labels] = await Promise.all([
      prisma.roster.findMany({ where: { leagueId: auth.leagueId }, select: { id: true } }),
      buildRosterLabelMap(auth.leagueId),
    ])
    const teams = rosters
      .map((r) => ({ rosterId: r.id, name: labels.get(r.id) ?? `Team ${r.id.slice(0, 6)}` }))
      .sort((a, b) => a.name.localeCompare(b.name))
    return NextResponse.json({ teams })
  }
  const week = parseWeek(new URL(req.url).searchParams.get('week'))
  try {
    return NextResponse.json(
      week != null ? await loadCommishPastLineup(auth.leagueId, rosterId, week) : await loadCommishLineup(auth.leagueId, rosterId),
    )
  } catch (e) {
    return errorResponse(e)
  }
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const auth = await authorize(ctx)
  if (auth instanceof NextResponse) return auth
  const body = await req.json().catch(() => null)
  const parsed = parseCommishLineup(body)
  if (!parsed) return NextResponse.json({ error: 'Unknown lineup.' }, { status: 400 })
  const week = parseWeek((body as Record<string, unknown> | null)?.week)
  try {
    const saved =
      week != null
        ? await saveCommishPastLineup({ leagueId: auth.leagueId, ...parsed, week, actorUserId: auth.userId })
        : await saveCommishLineup({ leagueId: auth.leagueId, ...parsed, actorUserId: auth.userId })
    return NextResponse.json({ ok: true, ...saved })
  } catch (e) {
    return errorResponse(e)
  }
}
