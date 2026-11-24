import 'server-only'
import sharp from 'sharp'
import { prisma } from '@/lib/prisma'
import { persistProfileImageBytes } from '@/lib/avatar/ProfileImageUploadStorageService'
import { getBlobReadWriteToken } from '@/lib/blob/readWriteToken'

/**
 * Commissioner Partner Codes — a commissioner's own logo on their share image.
 *
 * Every upload is re-drawn as a 512×512 PNG before it is stored: that strips metadata (GPS, camera
 * data), flattens animation to one frame, and means we never serve the bytes the user sent. Then it
 * waits for an admin: nothing appears on a share image until /admin/partner-codes approves it
 * (shareCard reads `logoUrl` only when `logoStatus === 'approved'`). The rule shown at upload time:
 * images you own only — no NFL, team, league or other brands' logos.
 */

export const LOGO_MAX_BYTES = 5 * 1024 * 1024
export const LOGO_ACCEPT = ['image/png', 'image/jpeg', 'image/webp'] as const
export const LOGO_SIZE = 512
/** Uploads per commissioner per day — enough to fix a mistake, not enough to flood the review queue. */
export const LOGO_UPLOADS_PER_DAY = 5

export type LogoError = 'no_file' | 'bad_type' | 'too_large' | 'unreadable' | 'too_small' | 'storage' | 'no_code' | 'rate_limited'

export const LOGO_ERROR_COPY: Record<LogoError, string> = {
  no_file: 'Pick an image first',
  bad_type: 'Use a PNG, JPG or WebP image',
  too_large: 'That image is over 5 MB',
  unreadable: "We couldn't read that image. Try a different file",
  too_small: 'That image is too small. Use one at least 128 pixels wide and tall',
  storage: "Uploads aren't available right now. Try again later",
  no_code: 'Claim a code first',
  rate_limited: "You've uploaded a lot today. Try again tomorrow",
}

/**
 * Turn whatever was uploaded into a square 512×512 PNG, cropped to the centre. Throws a LogoError
 * string for anything that is not a usable picture. Pure apart from sharp, so it is unit-tested.
 */
export async function normalizeLogo(input: Uint8Array, mimeType: string): Promise<Buffer> {
  if (!(LOGO_ACCEPT as readonly string[]).includes(mimeType)) throw 'bad_type' satisfies LogoError
  if (input.byteLength > LOGO_MAX_BYTES) throw 'too_large' satisfies LogoError
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>
  try {
    // limitInputPixels guards against decompression bombs (a tiny file that expands to gigapixels).
    meta = await sharp(input, { limitInputPixels: 40_000_000 }).metadata()
  } catch {
    throw 'unreadable' satisfies LogoError
  }
  if (!meta.width || !meta.height) throw 'unreadable' satisfies LogoError
  if (meta.width < 128 || meta.height < 128) throw 'too_small' satisfies LogoError
  try {
    return await sharp(input, { limitInputPixels: 40_000_000, pages: 1 })
      .rotate() // honour the camera's orientation before the metadata is dropped
      .resize(LOGO_SIZE, LOGO_SIZE, { fit: 'cover', position: 'centre' })
      .png({ compressionLevel: 9 })
      .toBuffer()
  } catch {
    throw 'unreadable' satisfies LogoError
  }
}

const uploadsToday = new Map<string, { day: string; count: number }>()

function underDailyLimit(userId: string, now: Date): boolean {
  const day = now.toISOString().slice(0, 10)
  const rec = uploadsToday.get(userId)
  if (!rec || rec.day !== day) {
    uploadsToday.set(userId, { day, count: 1 })
    return true
  }
  if (rec.count >= LOGO_UPLOADS_PER_DAY) return false
  rec.count++
  return true
}

/** Store a commissioner's new logo and put it in the review queue. */
export async function uploadPartnerLogo(args: { userId: string; bytes: Uint8Array; mimeType: string; now?: Date }): Promise<{ ok: true; logoUrl: string } | { ok: false; error: LogoError }> {
  const code = await prisma.partnerCode.findUnique({ where: { ownerUserId: args.userId }, select: { id: true } })
  if (!code) return { ok: false, error: 'no_code' }
  if (!underDailyLimit(args.userId, args.now ?? new Date())) return { ok: false, error: 'rate_limited' }
  let png: Buffer
  try {
    png = await normalizeLogo(args.bytes, args.mimeType)
  } catch (error) {
    return { ok: false, error: (typeof error === 'string' ? error : 'unreadable') as LogoError }
  }
  if (!getBlobReadWriteToken() && !process.env.UPLOADTHING_TOKEN?.trim()) return { ok: false, error: 'storage' }
  let url: string
  try {
    url = (await persistProfileImageBytes({ bytes: new Uint8Array(png), mimeType: 'image/png', originalFilename: 'logo.png', keyPrefix: 'partner-logos' })).url
  } catch {
    return { ok: false, error: 'storage' }
  }
  await prisma.partnerCode.update({
    where: { id: code.id },
    data: { logoUrl: url, logoStatus: 'pending', logoReviewNote: null, shareLogo: 'upload' },
  })
  return { ok: true, logoUrl: url }
}

/** Remove the logo; the share image goes back to initials. */
export async function removePartnerLogo(userId: string) {
  await prisma.partnerCode.updateMany({
    where: { ownerUserId: userId },
    data: { logoUrl: null, logoStatus: 'none', logoReviewNote: null, shareLogo: 'initials' },
  })
}

export const LOGO_REJECT_REASONS = {
  brand: "It looks like a team, league or brand logo. Use an image you own.",
  inappropriate: "It isn't appropriate for a share image.",
  unclear: "It's hard to make out at small sizes. Try a simpler image.",
} as const
export type LogoRejectReason = keyof typeof LOGO_REJECT_REASONS

/** Admin decision. Approving puts it on their share images; rejecting tells them why. */
export async function reviewPartnerLogo(partnerCodeId: string, decision: 'approve' | 'reject', reason?: LogoRejectReason) {
  const code = await prisma.partnerCode.findUnique({ where: { id: partnerCodeId }, select: { logoUrl: true, logoStatus: true } })
  if (!code?.logoUrl) throw new Error('No logo to review')
  if (decision === 'approve') {
    return prisma.partnerCode.update({ where: { id: partnerCodeId }, data: { logoStatus: 'approved', logoReviewNote: null } })
  }
  return prisma.partnerCode.update({
    where: { id: partnerCodeId },
    data: { logoStatus: 'rejected', logoReviewNote: LOGO_REJECT_REASONS[reason ?? 'brand'], shareLogo: 'initials' },
  })
}

/** For tests. */
export function _resetLogoRateLimit() {
  uploadsToday.clear()
}
