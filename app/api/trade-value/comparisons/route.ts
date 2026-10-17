import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { genericComparisonSchema, type GenericComparison } from '@/lib/trade-value/genericComparison'

export const dynamic = 'force-dynamic'

const saveSchema = z.object({ snapshots: z.array(genericComparisonSchema).min(1).max(30) })

async function userId(): Promise<string | null> {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  return session?.user?.id ?? null
}

async function list(user: string): Promise<GenericComparison[]> {
  const rows = await prisma.genericTradeComparison.findMany({
    where: { userId: user },
    select: { sourceId: true, snapshot: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 30,
  })
  return rows.flatMap((row) => {
    const parsed = genericComparisonSchema.omit({ id: true }).safeParse(row.snapshot)
    return parsed.success ? [{ ...parsed.data, id: row.sourceId }] : []
  })
}

export async function GET(req: Request) {
  const user = await userId()
  if (!user) return NextResponse.json({ error: 'Sign in to view saved comparisons.' }, { status: 401 })
  if (!rateLimit(`trade-comparisons-read:${user}:${getClientIp(req)}`, 60, 60_000).success) {
    return NextResponse.json({ error: 'Try again shortly.' }, { status: 429 })
  }
  try {
    return NextResponse.json({ snapshots: await list(user) })
  } catch (error) {
    console.error('[trade-value/comparisons GET]', error)
    return NextResponse.json({ error: 'Saved comparisons are unavailable right now.' }, { status: 503 })
  }
}

export async function POST(req: Request) {
  const user = await userId()
  if (!user) return NextResponse.json({ error: 'Sign in to save comparisons.' }, { status: 401 })
  if (!rateLimit(`trade-comparisons-write:${user}:${getClientIp(req)}`, 12, 60_000).success) {
    return NextResponse.json({ error: 'Too many saves. Try again shortly.' }, { status: 429 })
  }
  if (Number(req.headers.get('content-length') ?? 0) > 120_000) {
    return NextResponse.json({ error: 'Comparison is too large.' }, { status: 413 })
  }
  const raw = await req.text().catch(() => '')
  if (raw.length > 120_000) return NextResponse.json({ error: 'Comparison is too large.' }, { status: 413 })
  let input: unknown
  try { input = JSON.parse(raw) } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }) }
  const parsed = saveSchema.safeParse(input)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid comparison.' }, { status: 400 })
  try {
    // Old device snapshots arrive newest-first; insert oldest first to preserve their ordering.
    for (const item of [...parsed.data.snapshots].reverse()) {
      const { id, ...snapshot } = item
      await prisma.genericTradeComparison.upsert({
        where: { userId_sourceId: { userId: user, sourceId: id } },
        create: { userId: user, sourceId: id, snapshot: snapshot as Prisma.InputJsonValue, createdAt: new Date(item.at) },
        update: {},
      })
    }
    const stale = await prisma.genericTradeComparison.findMany({
      where: { userId: user },
      select: { id: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: 30,
    })
    if (stale.length) await prisma.genericTradeComparison.deleteMany({ where: { userId: user, id: { in: stale.map((row) => row.id) } } })
    return NextResponse.json({ snapshots: await list(user) })
  } catch (error) {
    console.error('[trade-value/comparisons POST]', error)
    return NextResponse.json({ error: 'Could not save comparisons right now.' }, { status: 503 })
  }
}

export async function DELETE(req: Request) {
  const user = await userId()
  if (!user) return NextResponse.json({ error: 'Sign in to remove comparisons.' }, { status: 401 })
  if (!rateLimit(`trade-comparisons-delete:${user}:${getClientIp(req)}`, 20, 60_000).success) {
    return NextResponse.json({ error: 'Try again shortly.' }, { status: 429 })
  }
  const id = new URL(req.url).searchParams.get('id')
  if (!id || id.length > 100) return NextResponse.json({ error: 'Invalid comparison ID.' }, { status: 400 })
  try {
    await prisma.genericTradeComparison.deleteMany({ where: { userId: user, sourceId: id } })
    return NextResponse.json({ snapshots: await list(user) })
  } catch (error) {
    console.error('[trade-value/comparisons DELETE]', error)
    return NextResponse.json({ error: 'Could not remove this comparison right now.' }, { status: 503 })
  }
}
