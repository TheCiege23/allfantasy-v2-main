/**
 * GET /api/leagues/[leagueId]/draft/[draftId]/validate-pre-draft
 *
 * Pre-draft validation report for commissioner UI (`PreDraftWizard`).
 */

import { assertCommissionerAccess } from '@/lib/league/commissionerAccess'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { DraftValidationOrchestrator } from '@/lib/draft/validation/DraftValidationOrchestrator'
import { prisma } from '@/lib/prisma'

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ leagueId: string; draftId: string }> },
) {
  try {
    const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { leagueId, draftId } = await ctx.params

    if (!leagueId || !draftId) {
      return NextResponse.json({ error: 'Missing leagueId or draftId' }, { status: 400 })
    }

    try {
      await assertCommissionerAccess(leagueId, userId, 'view')
    } catch {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const draftSession = await prisma.draftSession.findUnique({
      where: { id: draftId },
      select: { leagueId: true },
    })
    if (!draftSession || draftSession.leagueId !== leagueId) {
      return NextResponse.json({ error: 'Draft session not found' }, { status: 404 })
    }

    const report = await DraftValidationOrchestrator.validateDraft(leagueId, draftId)

    return NextResponse.json(report)
  } catch (err) {
    console.error('[validate-pre-draft] error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Validation failed' },
      { status: 500 },
    )
  }
}
