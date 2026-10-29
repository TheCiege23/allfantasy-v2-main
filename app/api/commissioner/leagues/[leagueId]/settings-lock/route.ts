import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getLeagueRole, isCommissionerRole, requireCommissionerRole } from '@/lib/league/permissions'
import { LOCK_GROUPS, LOCK_GROUP_LABELS, type LockGroup } from '@/lib/league/settingsLock'
import { readLockView, setLockedGroups, startUnlockVote } from '@/lib/league/settingsLockService'

export const dynamic = 'force-dynamic'

/**
 * Settings lock (docs/AF_COMMISSIONER_SETTINGS_SPEC.md §2.1, Free).
 *
 *   GET                          the lock, for anyone in the league — what is locked is the league's business
 *   PUT  { groups }              set the locked areas (commissioners). Removing one once the season
 *                                is under way is refused with 409: that takes a vote
 *   POST { group, days, reason } start a league vote to unlock one area (commissioners)
 */

type Ctx = { params: Promise<{ leagueId: string }> }

async function sessionUserId(): Promise<string | null> {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  return session?.user?.id ?? null
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const userId = await sessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await ctx.params
  const role = await getLeagueRole(leagueId, userId)
  if (!role) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const view = await readLockView(leagueId)
  if (!view) return NextResponse.json({ error: 'League not found' }, { status: 404 })
  return NextResponse.json({ ...view, canEdit: isCommissionerRole(role) })
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const userId = await sessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await ctx.params
  try {
    await requireCommissionerRole(leagueId, userId)
  } catch (e) {
    if (e instanceof Response) return e
    throw e
  }
  const body = (await req.json().catch(() => null)) as { groups?: unknown } | null
  const raw = body?.groups
  if (!Array.isArray(raw) || !raw.every((g) => (LOCK_GROUPS as readonly unknown[]).includes(g))) {
    return NextResponse.json({ error: `groups must be a list of: ${LOCK_GROUPS.join(', ')}` }, { status: 400 })
  }
  const r = await setLockedGroups(leagueId, userId, raw as LockGroup[])
  if (!r.ok && r.error === 'vote_required') {
    const names = (r.groups ?? []).map((g) => LOCK_GROUP_LABELS[g].label.toLowerCase()).join(' and ')
    return NextResponse.json(
      { error: `The season is under way, so ${names} can only be unlocked by a league vote.`, code: 'vote_required', groups: r.groups },
      { status: 409 },
    )
  }
  if (!r.ok) return NextResponse.json({ error: 'League not found' }, { status: 404 })
  return NextResponse.json({ groups: r.groups })
}

const VOTE_ERRORS: Record<string, [string, number]> = {
  not_locked: ['That area is not locked right now.', 409],
  already_voting: ['A vote to unlock that area is already open.', 409],
  bad_days: ['Voting can stay open for 1, 2, 3, 5 or 7 days.', 400],
  poll_failed: ['The vote could not be posted to league chat. Try again.', 502],
  not_found: ['League not found', 404],
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const userId = await sessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await ctx.params
  try {
    await requireCommissionerRole(leagueId, userId)
  } catch (e) {
    if (e instanceof Response) return e
    throw e
  }
  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>
  const r = await startUnlockVote(leagueId, userId, body)
  if (!r.ok) {
    const [error, status] = VOTE_ERRORS[r.error] ?? ['Could not start the vote', 500]
    return NextResponse.json({ error, code: r.error }, { status })
  }
  return NextResponse.json({ vote: r.vote })
}
