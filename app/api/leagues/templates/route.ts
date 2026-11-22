/**
 * GET  /api/leagues/templates — list current user's templates (?scope=public: the shared library)
 * POST /api/leagues/templates — create template (body: name, description?, payload)
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import type { LeagueTemplatePayload } from '@/lib/league-templates/types'
import { listPublicTemplates } from '@/lib/rule-templates/templateService'

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  // ?scope=public — the shared library (lib/rule-templates). Readable signed out: it lists names,
  // tags and use counts only, never a payload.
  if (req.nextUrl.searchParams.get('scope') === 'public') {
    const sp = req.nextUrl.searchParams
    const templates = await listPublicTemplates(session?.user?.id ?? null, {
      sport: sp.get('sport'),
      sort: sp.get('sort') === 'new' ? 'new' : 'popular',
    })
    return NextResponse.json({ templates })
  }
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const list = await (prisma as any).leagueTemplate.findMany({
    where: { userId: session.user.id },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, name: true, description: true, payload: true, createdAt: true, updatedAt: true },
  })
  return NextResponse.json({ templates: list })
}

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { name?: string; description?: string; payload?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name || name.length > 120) {
    return NextResponse.json({ error: 'Name is required (max 120 characters)' }, { status: 400 })
  }

  const description =
    body.description !== undefined && body.description !== null
      ? String(body.description).trim().slice(0, 500)
      : null

  const payload = body.payload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return NextResponse.json({ error: 'payload must be an object (wizard state)' }, { status: 400 })
  }

  const template = await (prisma as any).leagueTemplate.create({
    data: {
      userId: session.user.id,
      name,
      description: description || undefined,
      // Sharing state is written only by the share toggle and use counting, never by a raw payload.
      payload: { ...(payload as Record<string, unknown>), share: { public: false, uses: 0, usedBy: [] } } as unknown as LeagueTemplatePayload,
    },
    select: { id: true, name: true, description: true, payload: true, createdAt: true, updatedAt: true },
  })
  return NextResponse.json(template)
}
