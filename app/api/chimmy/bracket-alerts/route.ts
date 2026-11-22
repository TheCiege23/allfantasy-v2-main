import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getBracketChangeAlertsEnabled, setBracketChangeAlertsEnabled, type BracketAlertFormat } from '@/lib/chimmy/bracketChangeAlerts'

export const dynamic = 'force-dynamic'

const selection = z.object({
  format: z.enum(['tournament', 'world_cup', 'playoff']),
  entryId: z.string().min(1).max(128),
})

async function verifiedSelection(format: BracketAlertFormat, entryId: string, userId: string) {
  const where = { id: entryId, userId }
  if (format === 'tournament') return Boolean(await prisma.bracketEntry.findFirst({ where, select: { id: true } }))
  if (format === 'world_cup') return Boolean(await prisma.worldCupBracketEntry.findFirst({ where, select: { id: true } }))
  return Boolean(await prisma.playoffBracketEntry.findFirst({ where, select: { id: true } }))
}

async function userId() {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  return session?.user?.id ?? null
}

export async function GET(req: NextRequest) {
  const caller = await userId()
  if (!caller) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  const parsed = selection.safeParse(Object.fromEntries(req.nextUrl.searchParams))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid bracket entry' }, { status: 400 })
  const { format, entryId } = parsed.data
  if (!(await verifiedSelection(format, entryId, caller))) return NextResponse.json({ error: 'Bracket entry not found' }, { status: 404 })
  const enabled = await getBracketChangeAlertsEnabled(caller, format, entryId)
  return NextResponse.json({ enabled }, { headers: { 'Cache-Control': 'private, no-store' } })
}

export async function POST(req: NextRequest) {
  const caller = await userId()
  if (!caller) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  const parsed = selection.extend({ enabled: z.boolean() }).safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid alert setting' }, { status: 400 })
  const { format, entryId, enabled } = parsed.data
  if (!(await verifiedSelection(format, entryId, caller))) return NextResponse.json({ error: 'Bracket entry not found' }, { status: 404 })
  await setBracketChangeAlertsEnabled(caller, format, entryId, enabled)
  return NextResponse.json({ enabled }, { headers: { 'Cache-Control': 'private, no-store' } })
}
