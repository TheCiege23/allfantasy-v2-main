/**
 * GET: League privacy and invite settings (any member can read).
 * PATCH: Update privacy and invite settings (commissioner only).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { assertCommissioner, isCommissioner } from '@/lib/commissioner/permissions'
import { getLeaguePrivacySettings, updateLeaguePrivacySettings } from '@/lib/league-privacy'
import type { LeaguePrivacySettings } from '@/lib/league-privacy'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const [settings, commissioner] = await Promise.all([
      getLeaguePrivacySettings(leagueId),
      isCommissioner(leagueId, userId),
    ])
    const out: LeaguePrivacySettings & { isCommissioner: boolean } = {
      ...settings,
      passwordHash: null,
      isCommissioner: !!commissioner,
    }
    return NextResponse.json(out)
  } catch (e) {
    console.error('[privacy GET]', e)
    return NextResponse.json({ error: 'Failed to load privacy settings' }, { status: 500 })
  }
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  try {
    await assertCommissioner(leagueId, userId)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const patch: Parameters<typeof updateLeaguePrivacySettings>[1] = {}
  if (['public', 'private', 'invite_only', 'password_protected'].includes(body.visibility)) patch.visibility = body.visibility
  if (typeof body.allowInviteLink === 'boolean') patch.allowInviteLink = body.allowInviteLink
  if (typeof body.allowEmailInvite === 'boolean') patch.allowEmailInvite = body.allowEmailInvite
  if (typeof body.allowUsernameInvite === 'boolean') patch.allowUsernameInvite = body.allowUsernameInvite
  if (body.password !== undefined) patch.password = body.password === '' ? null : body.password

  if (Object.keys(patch).length === 0) {
    const current = await getLeaguePrivacySettings(leagueId)
    return NextResponse.json({ ...current, passwordHash: null })
  }

  try {
    const settings = await updateLeaguePrivacySettings(leagueId, patch)
    return NextResponse.json({ ...settings, passwordHash: null })
  } catch (e) {
    console.error('[privacy PATCH]', e)
    return NextResponse.json({ error: (e as Error).message ?? 'Failed to update' }, { status: 500 })
  }
}
