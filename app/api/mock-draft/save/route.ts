import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { toPrismaJsonInput } from '@/lib/prisma-json'

/**
 * Save or update mock draft results (e.g. after completion or pause).
 * Body: { draftId?, results, metadata? }
 * If draftId is provided and belongs to user, update. Otherwise create new (requires leagueId or metadata for sandbox).
 */
export async function POST(req: NextRequest) {
  try {
    const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const { draftId, results, metadata } = body as {
      draftId?: string
      results: unknown[]
      metadata?: Record<string, unknown>
    }

    if (!Array.isArray(results)) {
      return NextResponse.json({ error: 'results must be an array' }, { status: 400 })
    }

    if (draftId) {
      const existing = await prisma.mockDraft.findFirst({
        where: { id: draftId, userId: session.user.id },
      })
      if (existing) {
        const updated = await prisma.mockDraft.update({
          where: { id: draftId },
          data: {
            results: toPrismaJsonInput(results),
            ...(metadata != null && { metadata: toPrismaJsonInput(metadata) }),
          },
          select: { id: true, updatedAt: true },
        })
        return NextResponse.json({ status: 'ok', draftId: updated.id, updatedAt: updated.updatedAt })
      }
    }

    const leagueId = (body.leagueId as string) ?? null
    const rounds = Math.max(1, Number(body.rounds) || 15)

    const created = await (prisma as any).mockDraft.create({
      data: {
        leagueId: leagueId || undefined,
        userId: session.user.id,
        rounds,
        results: toPrismaJsonInput(results),
        proposals: toPrismaJsonInput(body.proposals ?? []),
        metadata:
          metadata != null
            ? toPrismaJsonInput(metadata)
            : body.sport
              ? toPrismaJsonInput({ sport: body.sport, leagueType: body.leagueType, draftType: body.draftType, aiEnabled: body.aiEnabled })
              : undefined,
      },
      select: { id: true, createdAt: true },
    })

    return NextResponse.json({ status: 'ok', draftId: created.id, createdAt: created.createdAt })
  } catch (err: any) {
    console.error('[mock-draft/save] Error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
