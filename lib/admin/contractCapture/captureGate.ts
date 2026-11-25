import { getServerSession } from 'next-auth'
import { NextResponse } from 'next/server'
import { authOptions } from '@/lib/auth'
import { requireAdmin } from '@/lib/adminAuth'

/**
 * Who may run a contract capture, and WHOSE credential it uses.
 *
 * Two checks, both required:
 *   1. `requireAdmin()` — the existing admin gate, unchanged (401 signed out, 403 not an admin). The
 *      bearer/machine-key form (`requireAdminOrBearer`) is deliberately NOT accepted: a machine key
 *      has no person behind it, so there is no "own" credential to read.
 *   2. a signed-in AllFantasy app session. Its user id is the ONLY id the capture reads a stored
 *      provider credential for. If the admin session names a different account, refuse rather than
 *      guess which one is "own".
 */
export async function resolveContractCaptureRequester(): Promise<
  { ok: true; userId: string } | { ok: false; res: NextResponse }
> {
  const admin = await requireAdmin()
  if (!admin.ok) return { ok: false, res: admin.res }

  const session = (await getServerSession(authOptions as never).catch(() => null)) as {
    user?: { id?: string | null }
  } | null
  const sessionUserId = session?.user?.id?.trim() || null
  if (!sessionUserId) {
    return {
      ok: false,
      res: NextResponse.json({ error: 'Sign in to AllFantasy as yourself; the capture uses your own connected account.' }, { status: 401 }),
    }
  }
  if (admin.user.id && admin.user.id !== sessionUserId) {
    return {
      ok: false,
      res: NextResponse.json({ error: 'Your admin session and app session are different accounts.' }, { status: 403 }),
    }
  }
  return { ok: true, userId: sessionUserId }
}
