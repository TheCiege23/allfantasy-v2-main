import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { requireCommissionerOnly } from '@/lib/league/permissions'
import { generateRulesDocument, getRulesDocAsHtml, getRulesDocAsText } from '@/lib/zombie/rulesDocGenerator'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const leagueId = searchParams?.get('leagueId')
  const format = searchParams?.get('format') ?? 'html'
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  try {
    await requireCommissionerOnly(leagueId, session.user.id)
  } catch (denied) {
    if (denied instanceof Response) return denied
    throw denied
  }
  const z = await prisma.zombieLeague.findUnique({ where: { leagueId } })
  if (!z) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const latest = await prisma.zombieRulesDocument.findFirst({
    where: { leagueId: z.id },
    orderBy: { version: 'desc' },
  })
  const doc = latest && latest.sectionSerums.includes('Serums to revive:')
    ? latest : await generateRulesDocument(z.id)

  if (format === 'text') {
    return new NextResponse(getRulesDocAsText(doc), {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }
  return new NextResponse(getRulesDocAsHtml(doc), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

export async function POST(req: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const leagueId = typeof body.leagueId === 'string' ? body.leagueId : null
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  await requireCommissionerOnly(leagueId, session.user.id)
  const z = await prisma.zombieLeague.findUnique({ where: { leagueId } })
  if (!z) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const doc = await generateRulesDocument(z.id)
  return NextResponse.json({ ok: true, id: doc.id, version: doc.version })
}

