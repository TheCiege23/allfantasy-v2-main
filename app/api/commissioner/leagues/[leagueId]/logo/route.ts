import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { requireCommissionerRole } from '@/lib/league/permissions'
import { isAllowedProfileImageType, MAX_PROFILE_IMAGE_BYTES, persistProfileImageBytes } from '@/lib/avatar/ProfileImageUploadStorageService'
import { PROFILE_IMAGE_BAD_TYPE_MESSAGE, PROFILE_IMAGE_TOO_LARGE_MESSAGE } from '@/lib/avatar/profileImageLimits'
import { getBlobReadWriteToken } from '@/lib/blob/readWriteToken'

export const dynamic = 'force-dynamic'

/**
 * The league logo (`League.logoUrl`), from the commissioner settings Appearance tab.
 *
 *   POST   multipart `file`   upload an image (the profile-image types and size cap) and set it
 *   DELETE                    clear it; the league falls back to its imported avatar or initials
 *
 * Commissioners only. The logo is what the league header and league switcher show
 * (components/core-app/CoreLeagueContextBar.tsx), ahead of an imported platform avatar.
 */

type Ctx = { params: Promise<{ leagueId: string }> }

async function commissionerOrResponse(ctx: Ctx): Promise<{ leagueId: string } | NextResponse | Response> {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await ctx.params
  try {
    await requireCommissionerRole(leagueId, userId)
  } catch (e) {
    if (e instanceof Response) return e
    throw e
  }
  return { leagueId }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const gate = await commissionerOrResponse(ctx)
  if (gate instanceof Response) return gate
  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!file || typeof file === 'string') return NextResponse.json({ error: 'No file' }, { status: 400 })
  if (!isAllowedProfileImageType(file.type)) return NextResponse.json({ error: PROFILE_IMAGE_BAD_TYPE_MESSAGE }, { status: 400 })
  if (file.size > MAX_PROFILE_IMAGE_BYTES) return NextResponse.json({ error: PROFILE_IMAGE_TOO_LARGE_MESSAGE }, { status: 400 })
  if (!getBlobReadWriteToken()) return NextResponse.json({ error: 'Storage not configured' }, { status: 503 })

  const bytes = new Uint8Array(await file.arrayBuffer())
  const { url } = await persistProfileImageBytes({ bytes, mimeType: file.type, originalFilename: file.name, keyPrefix: 'league-logos' })
  await prisma.league.update({ where: { id: gate.leagueId }, data: { logoUrl: url } })
  return NextResponse.json({ logoUrl: url })
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const gate = await commissionerOrResponse(ctx)
  if (gate instanceof Response) return gate
  await prisma.league.update({ where: { id: gate.leagueId }, data: { logoUrl: null } })
  return NextResponse.json({ logoUrl: null })
}
