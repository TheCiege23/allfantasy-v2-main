import { getServedOrigin } from '@/lib/http/served-origin'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertCommissioner } from '@/lib/commissioner/permissions'
import { isAdminEmailAllowed, isAdminRole } from '@/lib/adminAuth'
import {
  canManageClassExceptions,
  decideClassException,
  getClassGateSummary,
  type ClassDecision,
} from '@/lib/league-join/classExceptions'
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
export async function GET(_req: NextRequest, props: { params: Promise<{ leagueId: string }> }) {
  const params = await props.params
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
  const managerClass = await getClassGateSummary(params.leagueId).catch(() => null)
  return NextResponse.json({
    inviteCode: invite.inviteCode,
    inviteLink: invite.inviteLink,
    joinUrl: invite.joinUrl,
    inviteExpiresAt: invite.inviteExpiresAt,
    inviteExpired: invite.inviteExpired,
    managerClass,
  })
}

export async function POST(req: NextRequest, props: { params: Promise<{ leagueId: string }> }) {
  const params = await props.params
  const session = (await getServerSession(authOptions as any)) as { user?: SessionUser } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const regenerate = body?.regenerate !== false
  const expiresInDays =
    typeof body?.expiresInDays === 'number' && Number.isFinite(body.expiresInDays)
      ? Math.max(1, Math.min(90, Math.trunc(body.expiresInDays)))
      : undefined

  /*
   * ⚠ RETIRED 2026-10-01: `bypassRankGate` on the SHARED invite code let anyone
   * holding the code skip the level band. Exceptions are now per manager — see
   * PATCH below. Refused loudly rather than ignored, so a caller that still sends
   * it learns the link it shares is not an open door.
   */
  if (body?.bypassRankGate === true) {
    return NextResponse.json(
      {
        error: 'SHARED_BYPASS_RETIRED',
        message: 'Level exceptions are now granted to one manager at a time. Name the manager instead of opening the invite link to everyone.',
      },
      { status: 400 },
    )
  }

  try {
    await assertCommissioner(params.leagueId, userId)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
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
    createdByRole: resolveCreatedByRole(session?.user ?? {}),
    inviteExpiresAt: normalizedExpiresAt,
    bypassRankGate: false,
  })

  return NextResponse.json({
    status: 'ok',
    inviteCode: s.inviteCode,
    inviteLink: s.inviteLink,
    joinUrl,
    inviteExpiresAt: normalizedExpiresAt,
    inviteExpired: getInviteExpired(normalizedExpiresAt),
    bypassRankGate: false,
  })
}

const CLASS_ACTIONS: readonly ClassDecision[] = ['grant', 'approve', 'decline', 'revoke']

/**
 * PATCH: a commissioner decision on the ±2 manager-class band
 * (`lib/league-join/managerClass.ts`). On this path rather than a new route
 * because the app sits at the route ceiling (see GET /api/leagues/join).
 *
 * Body: { action: 'grant' | 'approve' | 'decline' | 'revoke', userId?: string, username?: string }
 *   grant    — let one named manager in from outside the band
 *   approve  — answer a pending request with yes (same effect as grant)
 *   decline  — answer a pending request with no
 *   revoke   — withdraw an exception (a manager already seated keeps the seat)
 *
 * Head commissioner, co-commissioner or admin. Returns the updated summary.
 */
export async function PATCH(req: NextRequest, props: { params: Promise<{ leagueId: string }> }) {
  const params = await props.params
  const session = (await getServerSession(authOptions as any)) as { user?: SessionUser } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!(await canManageClassExceptions(params.leagueId, session?.user ?? {}))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const action = CLASS_ACTIONS.find((a) => a === body?.action)
  if (!action) return NextResponse.json({ error: 'Unknown action' }, { status: 400 })

  const result = await decideClassException({
    leagueId: params.leagueId,
    decidedBy: userId,
    action,
    userId: typeof body?.userId === 'string' ? body.userId : null,
    username: typeof body?.username === 'string' ? body.username : null,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ status: 'ok', managerClass: result.summary })
}
