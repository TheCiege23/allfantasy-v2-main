import { getServedOrigin } from '@/lib/http/served-origin'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertCommissioner } from '@/lib/commissioner/permissions'
import { getLeagueRole } from '@/lib/league/permissions'
import { isAdminEmailAllowed, isAdminRole } from '@/lib/adminAuth'
import {
  buildFantasyInviteLink,
  generateInviteToken,
  getDefaultFantasyInviteExpiry,
} from '@/lib/league-invite'

type SessionUser = {
  id?: string
  role?: string | null
  email?: string | null
}

function resolveCreatedByRole(user: SessionUser): string {
  if (isAdminRole(user.role) || isAdminEmailAllowed(user.email)) return 'ADMIN'
  if (user.role && String(user.role).trim()) return String(user.role).toUpperCase()
  return 'COMMISSIONER'
}

function isAdminUser(user: SessionUser): boolean {
  return isAdminRole(user.role) || isAdminEmailAllowed(user.email)
}

async function canManageInviteBypass(leagueId: string, user: SessionUser): Promise<boolean> {
  if (!user.id) return false
  if (isAdminUser(user)) return true

  const role = await getLeagueRole(leagueId, user.id)
  if (role === 'commissioner' || role === 'co_commissioner') return true
  if (role !== 'member') return false

  const redraftSettings = await prisma.redraftLeagueExtendedSettings.findUnique({
    where: { leagueId },
    select: { allowMemberInviteRankBypass: true },
  })
  return Boolean(redraftSettings?.allowMemberInviteRankBypass)
}

async function upsertLeagueInvite(input: {
  leagueId: string
  inviteCode: string
  createdByUserId: string
  createdByRole?: string | null
  inviteExpiresAt: string | null
  bypassRankGate: boolean
}) {
  const expiresAt = input.inviteExpiresAt ? new Date(input.inviteExpiresAt) : null

  await prisma.leagueInvite.upsert({
    where: { token: input.inviteCode },
    create: {
      leagueId: input.leagueId,
      token: input.inviteCode,
      createdBy: input.createdByUserId,
      createdByRole: input.createdByRole ?? null,
      expiresAt,
      bypassRankGate: input.bypassRankGate,
      isActive: true,
    },
    update: {
      leagueId: input.leagueId,
      createdBy: input.createdByUserId,
      createdByRole: input.createdByRole ?? null,
      expiresAt,
      bypassRankGate: input.bypassRankGate,
      isActive: true,
    },
  })
}

function getBaseUrl(req?: NextRequest): string {
  // Config-derived, never the Host / X-Forwarded-Host header, which the caller
  // controls — see lib/http/served-origin.ts.
  return getServedOrigin(req)
}

function normalizeInviteExpiry(raw: unknown): string | null {
  if (raw instanceof Date) return raw.toISOString()
  if (typeof raw === 'string' && raw.trim()) {
    const parsed = new Date(raw)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  }
  return null
}

function getInviteExpired(inviteExpiresAt: string | null): boolean {
  if (!inviteExpiresAt) return false
  const parsed = new Date(inviteExpiresAt)
  return !Number.isNaN(parsed.getTime()) && parsed.getTime() < Date.now()
}

async function ensureLeagueInvite(
  leagueId: string,
  settings: Record<string, unknown>,
  baseUrl: string,
  options?: { expiresInDays?: number }
): Promise<{ inviteCode: string; joinUrl: string; inviteLink: string; inviteExpiresAt: string | null; inviteExpired: boolean }> {
  const existingCode = typeof settings.inviteCode === 'string' && settings.inviteCode.trim()
    ? settings.inviteCode.trim()
    : null
  const inviteCode = existingCode ?? generateInviteToken(8)
  const existingExpiry = normalizeInviteExpiry(settings.inviteExpiresAt)
  const inviteExpiresAt = existingExpiry ?? getDefaultFantasyInviteExpiry(options?.expiresInDays)
  const joinUrl = buildFantasyInviteLink(inviteCode, baseUrl)
  const inviteLink = joinUrl

  if (!existingCode || !existingExpiry || settings.inviteLink !== inviteLink) {
    await prisma.league.update({
      where: { id: leagueId },
      data: {
        settings: { ...settings, inviteCode, inviteLink, inviteExpiresAt },
      },
    })
  }

  return {
    inviteCode,
    joinUrl,
    inviteLink,
    inviteExpiresAt,
    inviteExpired: getInviteExpired(inviteExpiresAt),
  }
}

/** GET: return current invite code/link from settings. POST: regenerate and store in settings. */
export async function GET(
  _req: NextRequest,
  { params }: { params: { leagueId: string } }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: SessionUser } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await assertCommissioner(params.leagueId, userId)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const league = await prisma.league.findUnique({
    where: { id: params.leagueId },
    select: { settings: true, name: true },
  })
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })

  const settings = (league.settings as Record<string, unknown>) || {}
  const invite = await ensureLeagueInvite(params.leagueId, settings, getBaseUrl())
  return NextResponse.json({
    inviteCode: invite.inviteCode,
    inviteLink: invite.inviteLink,
    joinUrl: invite.joinUrl,
    inviteExpiresAt: invite.inviteExpiresAt,
    inviteExpired: invite.inviteExpired,
  })
}

export async function POST(
  req: NextRequest,
  { params }: { params: { leagueId: string } }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: SessionUser } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const bypassRankGate = body?.bypassRankGate === true
  const regenerate = body?.regenerate !== false
  const expiresInDays =
    typeof body?.expiresInDays === 'number' && Number.isFinite(body.expiresInDays)
      ? Math.max(1, Math.min(90, Math.trunc(body.expiresInDays)))
      : undefined

  if (bypassRankGate) {
    const canBypass = await canManageInviteBypass(params.leagueId, session?.user ?? {})
    if (!canBypass) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  } else {
    try {
      await assertCommissioner(params.leagueId, userId)
    } catch {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const league = await prisma.league.findUnique({
    where: { id: params.leagueId },
    select: { settings: true },
  })
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })

  const settings = (league.settings as Record<string, unknown>) || {}
  const inviteCode = regenerate
    ? generateInviteToken(8)
    : (typeof settings.inviteCode === 'string' && settings.inviteCode.trim() ? settings.inviteCode.trim() : generateInviteToken(8))
  const inviteExpiresAt = getDefaultFantasyInviteExpiry(expiresInDays)
  const joinUrl = buildFantasyInviteLink(inviteCode, getBaseUrl(req))
  const inviteLink = joinUrl

  const updated = await prisma.league.update({
    where: { id: params.leagueId },
    data: {
      settings: { ...settings, inviteCode, inviteLink, inviteExpiresAt },
    },
    select: { id: true, settings: true },
  })
  const s = (updated.settings as Record<string, unknown>) || {}
  const normalizedExpiresAt = normalizeInviteExpiry(s.inviteExpiresAt)

  const persistedInviteCode =
    typeof s.inviteCode === 'string' && s.inviteCode.trim() ? s.inviteCode.trim() : inviteCode

  await upsertLeagueInvite({
    leagueId: params.leagueId,
    inviteCode: persistedInviteCode,
    createdByUserId: userId,
    createdByRole: bypassRankGate ? 'COMMISSIONER' : resolveCreatedByRole(session?.user ?? {}),
    inviteExpiresAt: normalizedExpiresAt,
    bypassRankGate,
  })

  return NextResponse.json({
    status: 'ok',
    inviteCode: s.inviteCode,
    inviteLink: s.inviteLink,
    joinUrl,
    inviteExpiresAt: normalizedExpiresAt,
    inviteExpired: getInviteExpired(normalizedExpiresAt),
    bypassRankGate,
  })
}
