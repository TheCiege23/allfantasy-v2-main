import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { listMyInviteLinks } from '@/lib/invite-engine'
import type { InviteType } from '@/lib/invite-engine/types'
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

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const type = req.nextUrl.searchParams?.get('type') as InviteType | undefined
  const links = await listMyInviteLinks(userId, type, getBaseUrl(req))
  return NextResponse.json({ ok: true, links })
}

