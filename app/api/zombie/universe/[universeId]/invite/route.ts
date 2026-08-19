import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { randomInviteCode } from '@/lib/draft/pick-order'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Universe-scoped invite codes for 3-/6-league zombie universes. The code is
 * stored on ZombieUniverse.settings.inviteToken (no schema migration needed) and
 * the public landing page at `/zombie/join/[code]` lets the recipient pick which
 * feeder league to join — solving the audit gap where each league had its own
 * invite link but no universe-wide entry point existed.
 */
async function loadUniverseForCommissioner(universeId: string, userId: string) {
  const universe = await prisma.zombieUniverse.findUnique({
    where: { id: universeId },
    select: { id: true, name: true, sport: true, settings: true, commissionedByUserId: true, createdByUserId: true },
  })
  if (!universe) return { error: 'Not found', status: 404 as const }
  const ownerId = universe.commissionedByUserId ?? universe.createdByUserId ?? null
  if (!ownerId || ownerId !== userId) {
    return { error: 'Commissioner only', status: 403 as const }
  }
  return { universe }
}

/** GET → return current invite (or null if none exists yet) plus the public URL. */
export async function GET(_req: Request, { params }: { params: Promise<{ universeId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { universeId } = await params
  const result = await loadUniverseForCommissioner(universeId, session.user.id)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })

  const settings = (result.universe.settings as Record<string, unknown> | null) ?? {}
  const token = typeof settings.inviteToken === 'string' ? settings.inviteToken : null
  return NextResponse.json({
    universeId: result.universe.id,
    inviteToken: token,
    inviteUrl: token ? `/zombie/join/${token}` : null,
  })
}

/** POST → generate a fresh invite token (overwrites any existing). */
export async function POST(_req: Request, { params }: { params: Promise<{ universeId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { universeId } = await params
  const result = await loadUniverseForCommissioner(universeId, session.user.id)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })

  const settings = (result.universe.settings as Record<string, unknown> | null) ?? {}
  const token = randomInviteCode()
  await prisma.zombieUniverse.update({
    where: { id: universeId },
    data: { settings: toPrismaJsonInput({ ...settings, inviteToken: token }) },
  })
  return NextResponse.json({
    universeId: result.universe.id,
    inviteToken: token,
    inviteUrl: `/zombie/join/${token}`,
  })
}

/** DELETE → revoke the universe invite token. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ universeId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { universeId } = await params
  const result = await loadUniverseForCommissioner(universeId, session.user.id)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })

  const settings = { ...((result.universe.settings as Record<string, unknown> | null) ?? {}) }
  delete settings.inviteToken
  await prisma.zombieUniverse.update({
    where: { id: universeId },
    data: { settings: toPrismaJsonInput(settings) },
  })
  return NextResponse.json({ ok: true, revoked: true })
}
