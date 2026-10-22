import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveSurvivorAccessContext } from '@/lib/survivor/survivorAccessControl'
import { normalizeSurvivorFoundationSettings } from '@/lib/survivor/survivorSettings'
import { readTribeSlots, resolveTribeEmblem, tribeCatalogIdFor, tribeCrestUrl } from '@/lib/survivor/survivorTribeIdentity'
import { normalizeSurvivorTribeName } from '@/lib/survivor/survivorTribeName'
import { isAllowedProfileImageType, MAX_PROFILE_IMAGE_BYTES, persistProfileImageBytes } from '@/lib/avatar/ProfileImageUploadStorageService'
import { PROFILE_IMAGE_BAD_TYPE_MESSAGE, PROFILE_IMAGE_TOO_LARGE_MESSAGE } from '@/lib/avatar/profileImageLimits'
import { getBlobReadWriteToken } from '@/lib/blob/readWriteToken'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ leagueId: string; tribeId: string }> }

const TRIBE_SELECT = {
  id: true, leagueId: true, slotIndex: true, name: true, catalogId: true, logoUrl: true,
  colorHex: true, primaryColor: true, secondaryColor: true, chatChannelId: true,
} as const

type Body = { name?: unknown; removeLogo?: unknown; file?: File | null }

async function readBody(req: NextRequest): Promise<Body> {
  const contentType = req.headers.get('content-type') ?? ''
  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData()
    const file = form.get('file')
    return {
      name: form.has('name') ? String(form.get('name') ?? '') : undefined,
      removeLogo: form.get('removeLogo') === 'true' || form.get('removeLogo') === '1',
      file: file instanceof File && file.size > 0 ? file : null,
    }
  }
  const json = await req.json().catch(() => null) as { name?: unknown; removeLogo?: unknown } | null
  return { name: json?.name, removeLogo: json?.removeLogo === true, file: null }
}

/**
 * PATCH — rename a tribe (free text) and/or replace its image (owner's call, 2026-10-20).
 * Commissioner only; works before and after the draft. A custom image replaces the catalogue
 * crest; `removeLogo` goes back to the catalogue crest chosen at setup. JSON `{ name, removeLogo }`
 * or multipart with `name`, `file`, `removeLogo`.
 */
export async function PATCH(req: NextRequest, ctx: Context) {
  const session = await getServerSession(authOptions as never) as { user?: { id?: string } } | null
  const { leagueId, tribeId } = await ctx.params
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const access = await resolveSurvivorAccessContext(leagueId, userId)
  if (!access?.isLeagueMember || !access.decisions.canUpdateSettings) return NextResponse.json({ error: 'Commissioner access required' }, { status: 403 })

  const tribe = await prisma.survivorTribe.findFirst({ where: { id: tribeId, leagueId }, select: TRIBE_SELECT })
  if (!tribe) return NextResponse.json({ error: 'Tribe not found' }, { status: 404 })
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true, settings: true } })
  const sport = String(league?.sport ?? 'NFL')

  const body = await readBody(req)
  const data: { name?: string; logoUrl?: string | null; catalogId?: string | null } = {}

  if (body.name !== undefined) {
    const named = normalizeSurvivorTribeName(body.name)
    if (!named.ok) return NextResponse.json({ error: named.error }, { status: 400 })
    if (named.name !== tribe.name) {
      const clash = await prisma.survivorTribe.findFirst({
        where: { leagueId, id: { not: tribe.id }, name: { equals: named.name, mode: 'insensitive' } }, select: { id: true },
      })
      if (clash) return NextResponse.json({ error: 'Another tribe already has that name.' }, { status: 409 })
      data.name = named.name
    }
  }

  if (body.file) {
    if (!isAllowedProfileImageType(body.file.type)) return NextResponse.json({ error: PROFILE_IMAGE_BAD_TYPE_MESSAGE }, { status: 400 })
    if (body.file.size > MAX_PROFILE_IMAGE_BYTES) return NextResponse.json({ error: PROFILE_IMAGE_TOO_LARGE_MESSAGE }, { status: 400 })
    if (!getBlobReadWriteToken()) return NextResponse.json({ error: 'Storage not configured' }, { status: 503 })
    const bytes = new Uint8Array(await body.file.arrayBuffer())
    const { url } = await persistProfileImageBytes({ bytes, mimeType: body.file.type, originalFilename: body.file.name, keyPrefix: 'survivor-tribes' })
    data.logoUrl = url
    data.catalogId = null
  } else if (body.removeLogo === true) {
    // Back to the catalogue crest chosen at setup for this slot (the stored column, else the slot choice).
    const settings = normalizeSurvivorFoundationSettings((league?.settings ?? {}) as Record<string, unknown>)
    const slots = readTribeSlots((league?.settings ?? {}) as Record<string, unknown>, settings.defaultTeamCount, settings.tribeCount)
    const catalogId = tribeCatalogIdFor(tribe) ?? slots[tribe.slotIndex]?.catalogId ?? null
    if (!catalogId) return NextResponse.json({ error: 'This tribe has no catalogue crest to go back to.' }, { status: 400 })
    data.catalogId = catalogId
    data.logoUrl = tribeCrestUrl(catalogId, sport, { name: data.name ?? tribe.name, primaryColor: tribe.primaryColor, secondaryColor: tribe.secondaryColor })
  }

  if (Object.keys(data).length === 0) return NextResponse.json({ error: 'Send a new name or image.' }, { status: 400 })

  const updated = await prisma.survivorTribe.update({ where: { id: tribe.id }, data, select: TRIBE_SELECT })
  if (data.name && updated.chatChannelId) {
    await prisma.survivorChatChannel.updateMany({ where: { id: updated.chatChannelId, leagueId }, data: { name: `${data.name} Huddle` } })
  }
  await prisma.survivorAuditEntry.create({ data: {
    leagueId, actorUserId: userId, category: 'tribe', action: 'tribe_identity_updated', relatedEntityId: tribe.id, relatedEntityType: 'tribe',
    data: { from: { name: tribe.name, customLogo: Boolean(tribe.logoUrl && !tribeCatalogIdFor(tribe)) }, to: { name: updated.name, customLogo: Boolean(updated.logoUrl && !tribeCatalogIdFor(updated)) } },
    isVisibleToPublic: true, isVisibleToCommissioner: true,
  } })

  const emblem = resolveTribeEmblem(updated, sport)
  return NextResponse.json({ ok: true, tribe: {
    id: updated.id, slotIndex: updated.slotIndex, name: updated.name, colorHex: updated.colorHex ?? updated.primaryColor ?? null,
    crestUrl: emblem.crestUrl, markUrl: emblem.markUrl, customLogo: Boolean(updated.logoUrl && !emblem.catalogId),
  } })
}
