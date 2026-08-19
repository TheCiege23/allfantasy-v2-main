/**
 * GET/PUT: League Dues Tracker — commissioner-only edits, all members can view.
 * Stores dues config in League.settings.dues_tracker JSON.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { notifyCommissionerChange } from '@/lib/commissioner/CommissionerChangeNotifier'

export const dynamic = 'force-dynamic'

interface DuesEntry {
  teamId: string
  paid: boolean
  paidSeasons: number[] // For dynasty/C2C/devy — seasons paid for
  paidAt: string | null
}

interface DuesConfig {
  enabled: boolean
  amount: number | null
  currency: string
  paymentLink: string | null // FanCred or LeagueSafe URL
  paymentProvider: 'fancred' | 'leaguesafe' | 'other' | null
  entries: DuesEntry[]
  lastUpdatedAt: string | null
  lastUpdatedBy: string | null
}

function defaultDuesConfig(): DuesConfig {
  return {
    enabled: false,
    amount: null,
    currency: 'USD',
    paymentLink: null,
    paymentProvider: null,
    entries: [],
    lastUpdatedAt: null,
    lastUpdatedBy: null,
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await params
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      userId: true, sport: true, season: true, settings: true,
      leagueVariant: true, isDynasty: true,
      teams: { select: { id: true, teamName: true, ownerName: true, avatarUrl: true } },
    },
  })
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const settings = (league.settings as Record<string, unknown>) ?? {}
  const config: DuesConfig = (settings.dues_tracker as DuesConfig) ?? defaultDuesConfig()
  const leagueType = (settings.league_type as string) ?? (settings.leagueType as string) ?? ''
  const isMultiSeason = league.isDynasty
    || leagueType.toLowerCase().includes('dynasty')
    || leagueType.toLowerCase().includes('c2c')
    || leagueType.toLowerCase().includes('devy')
    || leagueType.toLowerCase().includes('keeper')
    || (league.leagueVariant ?? '').toLowerCase().includes('dynasty')
    || (league.leagueVariant ?? '').toLowerCase().includes('c2c')
    || (league.leagueVariant ?? '').toLowerCase().includes('devy')

  return NextResponse.json({
    config,
    isCommissioner: league.userId === session.user.id,
    teams: league.teams,
    currentSeason: league.season,
    isMultiSeason,
    sport: league.sport,
  })
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await params
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { userId: true, settings: true },
  })
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (league.userId !== session.user.id) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const currentSettings = (league.settings as Record<string, unknown>) ?? {}
  const existing = (currentSettings.dues_tracker as DuesConfig) ?? defaultDuesConfig()

  const updated: DuesConfig = {
    enabled: typeof body.enabled === 'boolean' ? body.enabled : existing.enabled,
    amount: typeof body.amount === 'number' ? body.amount : existing.amount,
    currency: typeof body.currency === 'string' ? body.currency : existing.currency,
    paymentLink: typeof body.paymentLink === 'string' ? body.paymentLink : existing.paymentLink,
    paymentProvider: body.paymentProvider ?? existing.paymentProvider,
    entries: Array.isArray(body.entries) ? body.entries : existing.entries,
    lastUpdatedAt: new Date().toISOString(),
    lastUpdatedBy: session.user.id,
  }

  await prisma.league.update({
    where: { id: leagueId },
    data: { settings: toPrismaJsonInput({ ...currentSettings, dues_tracker: updated }) },
  })

  // Notify league chat of dues changes
  const changes: { field: string; oldValue: string; newValue: string }[] = []
  if (existing.enabled !== updated.enabled) {
    changes.push({ field: 'Dues Tracking', oldValue: existing.enabled ? 'On' : 'Off', newValue: updated.enabled ? 'On' : 'Off' })
  }
  if (existing.amount !== updated.amount) {
    changes.push({ field: 'Dues Amount', oldValue: existing.amount ? `$${existing.amount}` : '(none)', newValue: updated.amount ? `$${updated.amount}` : '(none)' })
  }
  // Check for payment status changes
  const oldPaidIds = new Set(existing.entries.filter(e => e.paid).map(e => e.teamId))
  const newPaidIds = new Set(updated.entries.filter(e => e.paid).map(e => e.teamId))
  const newlyPaid = updated.entries.filter(e => e.paid && !oldPaidIds.has(e.teamId))
  if (newlyPaid.length > 0) {
    changes.push({ field: 'Dues Paid', oldValue: '', newValue: `${newlyPaid.length} member(s) marked as paid` })
  }
  if (changes.length > 0) {
    await notifyCommissionerChange(leagueId, session.user.id, 'League Dues Tracker', changes).catch(() => {})
  }

  return NextResponse.json({ ok: true, config: updated })
}
