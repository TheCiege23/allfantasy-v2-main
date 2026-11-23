import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { commissionerAccessResponse } from '@/lib/league/commissionerAccess'
import { importCarriesNoWaiverBudget, WAIVER_BUDGET_SET_KEY } from '@/lib/trade-value-console/league-loader'

/**
 * PUT /api/leagues/[leagueId]/waiver-budget — `{ waiverBudget: number }`. Sets an imported league's waiver budget,
 * the number the trade grader prices budget moves against.
 *
 * Only for platforms whose import carries no budget (Fantrax, Yahoo): there the number exists nowhere else, so the
 * commissioner states it here. Every other platform's import writes the budget the platform reports, and a value
 * typed here would be overwritten on the next sync; native leagues set it in their own waiver settings.
 *
 * The save stamps `settings[WAIVER_BUDGET_SET_KEY]`, which is what lets the grader trust a deliberate 100 — the column
 * default — on these platforms (`waiverBudgetOnFile`).
 */

// Not exported: a route module may export only its handlers and Next.js config.
const MAX_WAIVER_BUDGET = 10_000_000

export async function PUT(req: NextRequest, props: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await props.params
  const session = await getServerSession(authOptions)
  const userId = (session?.user as { id?: string } | undefined)?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // League setup: the head commissioner, or a co-commissioner granted it — the same rule as the waiver settings save.
  const refused = await commissionerAccessResponse(leagueId, userId, 'league')
  if (refused) return refused

  const body = (await req.json().catch(() => null)) as { waiverBudget?: unknown } | null
  const raw = body?.waiverBudget
  const amount = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : Number.NaN
  if (!Number.isInteger(amount) || amount < 1 || amount > MAX_WAIVER_BUDGET) {
    return NextResponse.json({ error: 'Enter the budget as a whole number of at least 1.' }, { status: 400 })
  }

  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { platform: true, settings: true } })
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })
  if (!importCarriesNoWaiverBudget(league.platform)) {
    return NextResponse.json({ error: 'This league’s waiver budget comes from its platform or its own waiver settings, not from here.' }, { status: 409 })
  }

  const settings =
    league.settings && typeof league.settings === 'object' && !Array.isArray(league.settings) ? (league.settings as Record<string, unknown>) : {}
  await prisma.league.update({
    where: { id: leagueId },
    data: { waiverBudget: amount, settings: { ...settings, [WAIVER_BUDGET_SET_KEY]: new Date().toISOString() } },
  })
  return NextResponse.json({ waiverBudget: amount })
}
