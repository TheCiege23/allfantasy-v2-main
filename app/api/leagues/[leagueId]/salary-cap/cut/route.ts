/**
 * POST: Cut/release player — apply dead money (commissioner or owner). PROMPT 339.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { isSalaryCapLeague, getSalaryCapConfig } from '@/lib/salary-cap/SalaryCapLeagueConfig'
import { applyCut } from '@/lib/salary-cap/DeadMoneyService'
import { getOrCreateLedger } from '@/lib/salary-cap/CapCalculationService'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const isCap = await isSalaryCapLeague(leagueId)
  if (!isCap) return NextResponse.json({ error: 'Not a salary cap league' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const contractId = body.contractId
  if (!contractId) return NextResponse.json({ error: 'Body must include contractId' }, { status: 400 })
  const capYear = Number(body.capYear ?? new Date().getFullYear())
  if (!Number.isInteger(capYear)) return NextResponse.json({ error: 'Invalid capYear' }, { status: 400 })

  const result = await applyCut(leagueId, String(contractId), capYear, userId)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status ?? 400 })

  const config = await getSalaryCapConfig(leagueId)
  if (config) {
    const { prisma } = await import('@/lib/prisma')
    const contract = await prisma.playerContract.findUnique({ where: { id: contractId }, select: { rosterId: true } })
    if (contract) await getOrCreateLedger(config, contract.rosterId, capYear)
  }
  return NextResponse.json({ ok: true })
}
