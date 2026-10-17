/**
 * /api/leagues/[leagueId]/commish-waivers — "Edit Waiver": each team's FAAB left and claim priority.
 *
 * GET   → `{ teams: [{ rosterId, name, faabRemaining, waiverPriority }], faabBudget }`
 * PATCH → `{ updates: [{ rosterId, faabRemaining?, waiverPriority? }] }`
 *
 * Writes `Roster.faabRemaining` / `Roster.waiverPriority` — the two columns the claim engine
 * (lib/waiver-wire/process-engine.ts) reads. Commish or co-commish only; every change is written to
 * the league audit log with before/after values.
 *
 * ⚠ Priorities must stay a PERMUTATION of 1..N. The engine moves a winning claimant to the back by
 * taking max(priority)+1, so duplicate or gapped priorities would make claim order ambiguous. A patch
 * that touches any priority is validated against the whole league's resulting order.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getLeagueRole, isCommissionerRole } from '@/lib/league/permissions'
import { buildRosterLabelMap } from '@/lib/scoring-engine/resolveTeamLabels'
import { logAction } from '@/server/services/auditService'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ leagueId: string }> | { leagueId: string } }
type Update = { rosterId: string; faabRemaining?: number; waiverPriority?: number }

async function authorize(ctx: Ctx): Promise<{ leagueId: string; userId: string } | NextResponse> {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const leagueId = ((await ctx.params)?.leagueId ?? '').trim()
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
  if (!isCommissionerRole(await getLeagueRole(leagueId, userId))) {
    return NextResponse.json({ error: 'Only the commish or a co-commish can edit waivers.' }, { status: 403 })
  }
  return { leagueId, userId }
}

async function snapshot(leagueId: string) {
  const [league, rosters, labels] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: { waiverBudget: true } }),
    prisma.roster.findMany({
      where: { leagueId },
      select: { id: true, faabRemaining: true, waiverPriority: true },
    }),
    buildRosterLabelMap(leagueId),
  ])
  const teams = rosters
    .map((r) => ({
      rosterId: r.id,
      name: labels.get(r.id) ?? `Team ${r.id.slice(0, 6)}`,
      faabRemaining: r.faabRemaining,
      waiverPriority: r.waiverPriority,
    }))
    .sort((a, b) => (a.waiverPriority ?? 999) - (b.waiverPriority ?? 999) || a.name.localeCompare(b.name))
  return { teams, faabBudget: league?.waiverBudget ?? null }
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const auth = await authorize(ctx)
  if (auth instanceof NextResponse) return auth
  return NextResponse.json(await snapshot(auth.leagueId))
}

/** Pure validation, exported for tests: returns an error string or null. */
export function validateWaiverUpdates(
  updates: Update[],
  current: Array<{ id: string; waiverPriority: number | null }>,
  faabBudget: number | null,
): string | null {
  const ids = new Set(current.map((r) => r.id))
  const seen = new Set<string>()
  for (const u of updates) {
    if (!ids.has(u.rosterId)) return 'Unknown team in update'
    if (seen.has(u.rosterId)) return 'A team appears twice in one update'
    seen.add(u.rosterId)
    if (u.faabRemaining !== undefined) {
      if (!Number.isInteger(u.faabRemaining) || u.faabRemaining < 0) return 'FAAB must be a whole number of 0 or more'
      if (faabBudget != null && u.faabRemaining > faabBudget) return `FAAB cannot exceed the league budget (${faabBudget})`
    }
    if (u.waiverPriority !== undefined && (!Number.isInteger(u.waiverPriority) || u.waiverPriority < 1)) {
      return 'Waiver priority must be a whole number of 1 or more'
    }
  }
  if (updates.some((u) => u.waiverPriority !== undefined)) {
    const byId = new Map(updates.map((u) => [u.rosterId, u.waiverPriority]))
    const order = current.map((r) => byId.get(r.id) ?? r.waiverPriority)
    const n = current.length
    const valid = order.every((p) => p != null) && new Set(order).size === n && order.every((p) => (p as number) >= 1 && (p as number) <= n)
    if (!valid) return `Waiver priorities must use each number from 1 to ${n} exactly once`
  }
  return null
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const auth = await authorize(ctx)
  if (auth instanceof NextResponse) return auth
  const { leagueId, userId } = auth

  const body = (await req.json().catch(() => ({}))) as { updates?: unknown }
  if (!Array.isArray(body.updates) || body.updates.length === 0) {
    return NextResponse.json({ error: 'updates required' }, { status: 400 })
  }
  const updates: Update[] = body.updates.map((u) => {
    const r = (u ?? {}) as Record<string, unknown>
    return {
      rosterId: String(r.rosterId ?? ''),
      ...(r.faabRemaining !== undefined ? { faabRemaining: Number(r.faabRemaining) } : {}),
      ...(r.waiverPriority !== undefined ? { waiverPriority: Number(r.waiverPriority) } : {}),
    }
  })

  const [league, current] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: { waiverBudget: true } }),
    prisma.roster.findMany({ where: { leagueId }, select: { id: true, faabRemaining: true, waiverPriority: true } }),
  ])
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })

  const error = validateWaiverUpdates(updates, current, league.waiverBudget ?? null)
  if (error) return NextResponse.json({ error }, { status: 400 })

  const before = new Map(current.map((r) => [r.id, r]))
  await prisma.$transaction(
    updates.map((u) =>
      prisma.roster.update({
        where: { id: u.rosterId },
        data: {
          ...(u.faabRemaining !== undefined ? { faabRemaining: u.faabRemaining } : {}),
          ...(u.waiverPriority !== undefined ? { waiverPriority: u.waiverPriority } : {}),
        },
      }),
    ),
  )

  await logAction({
    leagueId,
    userId,
    actionType: 'commish_edit_waivers',
    entityType: 'roster',
    beforeState: updates.map((u) => ({
      rosterId: u.rosterId,
      faabRemaining: before.get(u.rosterId)?.faabRemaining ?? null,
      waiverPriority: before.get(u.rosterId)?.waiverPriority ?? null,
    })),
    afterState: updates,
  }).catch(() => undefined)

  return NextResponse.json(await snapshot(leagueId))
}
