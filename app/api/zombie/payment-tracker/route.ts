import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getLeagueRole, requireCommissionerRole } from '@/lib/league/permissions'
import {
  mergeTrackerWithRosters,
  parsePaymentTrackerPrefs,
  type ZombiePaymentTrackerPrefs,
} from '@/lib/zombie/payment-tracker-types'

export const dynamic = 'force-dynamic'

async function requireLeagueMember(leagueId: string, userId: string) {
  const role = await getLeagueRole(leagueId, userId)
  if (!role) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return null
}

export async function GET(req: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const leagueId = searchParams.get('leagueId')
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  const gate = await requireLeagueMember(leagueId, userId)
  if (gate) return gate

  const z = await prisma.zombieLeague.findUnique({
    where: { leagueId },
    include: { paidConfig: true, level: true },
  })
  if (!z) return NextResponse.json({ error: 'Zombie league not found' }, { status: 404 })

  const rosters = await prisma.roster.findMany({
    where: { leagueId },
    select: { id: true, platformUserId: true, playerData: true },
  })

  const zTeams = await prisma.zombieLeagueTeam.findMany({
    where: { leagueId },
    select: {
      rosterId: true,
      displayName: true,
      fantasyTeamName: true,
    },
  })
  const teamByRoster = new Map(zTeams.map((t) => [t.rosterId, t]))

  const buyIn = z.paidConfig?.buyInAmount ?? z.buyInAmount ?? 0

  const rows = rosters.map((r) => {
    const zt = teamByRoster.get(r.id)
    const pd = r.playerData && typeof r.playerData === 'object' && !Array.isArray(r.playerData) ? r.playerData : {}
    const fromPd =
      typeof (pd as { teamName?: unknown }).teamName === 'string'
        ? (pd as { teamName: string }).teamName
        : typeof (pd as { displayName?: unknown }).displayName === 'string'
          ? (pd as { displayName: string }).displayName
          : null
    const displayName =
      zt?.fantasyTeamName?.trim() ||
      zt?.displayName?.trim() ||
      fromPd?.trim() ||
      'Manager'
    return {
      userId: r.platformUserId,
      rosterId: r.id,
      displayName,
      defaultExpected: typeof buyIn === 'number' ? buyIn : 0,
    }
  })

  const prefsRaw = z.commissionerUiPrefs
  const saved = parsePaymentTrackerPrefs(
    prefsRaw && typeof prefsRaw === 'object' && !Array.isArray(prefsRaw)
      ? (prefsRaw as Record<string, unknown>).paymentTracker
      : undefined,
  )

  const entries = mergeTrackerWithRosters({ saved, rows })
  const role = await getLeagueRole(leagueId, userId)
  const isStaff = role === 'commissioner' || role === 'co_commissioner'

  return NextResponse.json({
    isPaid: z.isPaid,
    buyInAmount: buyIn,
    tierLabel: z.level?.tierLabel ?? null,
    dueDate: saved.dueDate ?? null,
    entries: isStaff ? entries : entries.map((e) => ({ ...e, notes: null })),
    canEdit: isStaff,
  })
}

export async function PUT(req: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const leagueId = typeof body.leagueId === 'string' ? body.leagueId : null
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  try {
    await requireCommissionerRole(leagueId, userId, 'money')
  } catch (e) {
    if (e instanceof Response) return e
    throw e
  }

  const z = await prisma.zombieLeague.findUnique({ where: { leagueId } })
  if (!z) return NextResponse.json({ error: 'Zombie league not found' }, { status: 404 })

  if (!z.isPaid) {
    return NextResponse.json({ error: 'Payment tracker is only for paid leagues.' }, { status: 400 })
  }

  const dueDate =
    typeof body.dueDate === 'string' ? body.dueDate : body.dueDate === null ? null : undefined

  let entries: ZombiePaymentTrackerPrefs['entries'] | undefined
  if (Array.isArray(body.entries)) {
    entries = []
    for (const row of body.entries) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) continue
      const r = row as Record<string, unknown>
      const uid = typeof r.userId === 'string' ? r.userId : ''
      const rid = typeof r.rosterId === 'string' ? r.rosterId : ''
      if (!uid || !rid) continue
      const status =
        r.status === 'partial' || r.status === 'paid' || r.status === 'waived' ? r.status : 'unpaid'
      entries.push({
        userId: uid,
        rosterId: rid,
        displayName: typeof r.displayName === 'string' ? r.displayName : 'Manager',
        expectedAmount:
          typeof r.expectedAmount === 'number' && Number.isFinite(r.expectedAmount) ? r.expectedAmount : 0,
        amountPaid: typeof r.amountPaid === 'number' && Number.isFinite(r.amountPaid) ? r.amountPaid : 0,
        status,
        paidAt: typeof r.paidAt === 'string' ? r.paidAt : r.paidAt === null ? null : undefined,
        method: typeof r.method === 'string' ? r.method : r.method === null ? null : undefined,
        notes: typeof r.notes === 'string' ? r.notes : r.notes === null ? null : undefined,
        remindersSent:
          typeof r.remindersSent === 'number' && Number.isFinite(r.remindersSent)
            ? Math.max(0, r.remindersSent)
            : 0,
      })
    }
  }

  const cur =
    z.commissionerUiPrefs && typeof z.commissionerUiPrefs === 'object' && !Array.isArray(z.commissionerUiPrefs)
      ? (z.commissionerUiPrefs as Record<string, unknown>)
      : {}

  const nextTracker: ZombiePaymentTrackerPrefs = {
    dueDate: dueDate !== undefined ? dueDate : parsePaymentTrackerPrefs(cur.paymentTracker).dueDate,
    entries: entries ?? parsePaymentTrackerPrefs(cur.paymentTracker).entries,
  }

  const nextPrefs = { ...cur, paymentTracker: nextTracker }

  await prisma.zombieLeague.update({
    where: { id: z.id },
    data: { commissionerUiPrefs: nextPrefs as object },
  })

  return NextResponse.json({ ok: true, paymentTracker: nextTracker })
}
