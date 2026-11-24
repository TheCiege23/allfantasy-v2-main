import 'server-only'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isPartnerCodesEnabled } from './flags'

/** Shared guard for the member-facing Partner Code APIs. */
export async function partnerApiUser(): Promise<
  { ok: true; userId: string; email: string | null } | { ok: false; res: NextResponse }
> {
  if (!isPartnerCodesEnabled()) return { ok: false, res: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string; email?: string | null } } | null
  const userId = session?.user?.id
  if (!userId) return { ok: false, res: NextResponse.json({ error: 'Sign in first' }, { status: 401 }) }
  return { ok: true, userId, email: session?.user?.email ?? null }
}
