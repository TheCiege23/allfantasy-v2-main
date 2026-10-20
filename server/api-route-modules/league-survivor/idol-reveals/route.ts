/**
 * GET/POST: the viewer's own unread idol reveals (owner's call, 2026-10-20: a popup on the next
 * league load for any private idol DM). A reveal is the private Chimmy message written when an idol
 * reached this manager — found in the draft, seeded after it, or arrived with a player. Owner-only:
 * the rows are already scoped to `visibleToUserId`; nothing here can read another manager's.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'

export const dynamic = 'force-dynamic'

export type SurvivorIdolReveal = {
  messageId: string
  idolId: string | null
  playerId: string | null
  playerName: string | null
  playerImageUrl: string | null
  idolTypeId: string | null
  idolLabel: string | null
  idolDescription: string | null
  expiryText: string | null
  foundInDraft: boolean
  message: string
  createdAt: string
}

type Meta = Record<string, unknown>

function meta(value: unknown): Meta {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Meta : {}
}

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null)

export function projectIdolReveal(row: { id: string; message: string; createdAt: Date; metadata: unknown }): SurvivorIdolReveal {
  const m = meta(row.metadata)
  return {
    messageId: row.id,
    idolId: text(m.idolId), playerId: text(m.playerId), playerName: text(m.playerName), playerImageUrl: text(m.playerImageUrl),
    idolTypeId: text(m.idolTypeId), idolLabel: text(m.idolLabel), idolDescription: text(m.idolDescription), expiryText: text(m.expiryText),
    foundInDraft: m.foundInDraft === true,
    message: row.message,
    createdAt: row.createdAt.toISOString(),
  }
}

async function sessionUserId(): Promise<string | null> {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  return session?.user?.id ?? null
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const userId = await sessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
  if (!(await canAccessLeagueDraft(leagueId, userId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const rows = await prisma.leagueChatMessage.findMany({
    where: { leagueId, isPrivate: true, visibleToUserId: userId, messageSubtype: 'chimmy_private' },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { id: true, message: true, createdAt: true, metadata: true },
  })
  const reveals = rows
    .filter(row => { const m = meta(row.metadata); return m.survivorIdolReveal === true && !m.acknowledgedAt })
    .map(projectIdolReveal)
    .reverse()
  return NextResponse.json({ reveals }, { headers: { 'Cache-Control': 'no-store' } })
}

/** Acknowledge one reveal (the modal's "Got it"); the DM stays in the Chimmy thread. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const userId = await sessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await ctx.params
  const body = await req.json().catch(() => null) as { messageId?: unknown } | null
  const messageId = typeof body?.messageId === 'string' ? body.messageId : ''
  if (!leagueId || !messageId) return NextResponse.json({ error: 'messageId required' }, { status: 400 })
  const row = await prisma.leagueChatMessage.findFirst({ where: { id: messageId, leagueId, isPrivate: true, visibleToUserId: userId }, select: { id: true, metadata: true } })
  if (!row || meta(row.metadata).survivorIdolReveal !== true) return NextResponse.json({ error: 'Reveal not found' }, { status: 404 })
  await prisma.leagueChatMessage.update({ where: { id: row.id }, data: { metadata: { ...meta(row.metadata), acknowledgedAt: new Date().toISOString() } } })
  return NextResponse.json({ ok: true })
}
