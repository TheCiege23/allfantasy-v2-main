import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getInvitePreview, recordInviteEvent } from '@/lib/invite-engine'
import { prisma } from '@/lib/prisma'
import { getServedOrigin } from '@/lib/http/served-origin'

export const dynamic = 'force-dynamic'

/*
 * An invite link has to name a host, and neither source this used could be trusted
 * to. `x-forwarded-host` is set by the caller, so an invite could be minted pointing
 * at any host an attacker put in a header; `req.nextUrl.origin` is the address the
 * server BOUND to, which on Railway is https://0.0.0.0:8080. getServedOrigin reads
 * the configured origin from the environment instead — see lib/http/served-origin.ts.
 */
function getBaseUrl(req: NextRequest): string {
  return getServedOrigin(req)
}

/**
 * GET /api/invite/preview?code=XXX
 * Public: returns invite preview (no PII). Records lightweight analytics when the token resolves.
 */
export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as any)) as
    | { user?: { id?: string } }
    | null
  const code = req.nextUrl.searchParams?.get('code') ?? undefined
  const explicitUserId = req.nextUrl.searchParams?.get('userId') ?? undefined
  const userId = explicitUserId || session?.user?.id || undefined
  const recordView = req.nextUrl.searchParams?.get('recordView') !== 'false'

  const preview = await getInvitePreview(code, {
    userId: userId || null,
    baseUrl: getBaseUrl(req),
  })

  if (recordView && preview.token && preview.status !== 'invalid') {
    const link = await prisma.inviteLink.findUnique({
      where: { token: preview.token },
      select: { id: true },
    })
    if (link) {
      await recordInviteEvent(link.id, 'viewed', null, { status: preview.status }).catch(() => {})
      if (preview.status === 'expired' || preview.status === 'max_used') {
        await recordInviteEvent(link.id, 'expired_shown', null, { status: preview.status }).catch(
          () => {}
        )
      }
    }
  }

  return NextResponse.json({ ok: true, preview })
}

