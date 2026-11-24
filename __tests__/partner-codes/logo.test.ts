import { beforeEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'

/**
 * Commissioner logos: every upload is re-drawn as a clean 512×512 PNG, waits for admin review, and
 * never reaches a share image until approved.
 */

vi.mock('server-only', () => ({}))

const codeRow = { id: 'pc1', logoUrl: null as string | null, logoStatus: 'none' }
const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) => Object.assign(codeRow, data))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    partnerCode: {
      findUnique: vi.fn(async () => ({ ...codeRow })),
      update,
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  },
}))
const persistProfileImageBytes = vi.fn(async (..._a: unknown[]) => ({ url: 'https://blob.example/partner-logos/x.png' }))
vi.mock('@/lib/avatar/ProfileImageUploadStorageService', () => ({ persistProfileImageBytes }))
vi.mock('@/lib/blob/readWriteToken', () => ({ getBlobReadWriteToken: () => 'token' }))

async function png(w: number, h: number): Promise<Uint8Array> {
  return new Uint8Array(await sharp({ create: { width: w, height: h, channels: 3, background: '#e11d48' } }).png().toBuffer())
}

describe('normalizeLogo', () => {
  it('re-draws any accepted image as a square 512×512 PNG', async () => {
    const { normalizeLogo } = await import('@/lib/partner-codes/logo')
    const out = await normalizeLogo(await png(900, 400), 'image/png')
    const meta = await sharp(out).metadata()
    expect([meta.format, meta.width, meta.height]).toEqual(['png', 512, 512])
  })

  it('strips metadata: GPS and camera data in a JPEG do not survive', async () => {
    const { normalizeLogo } = await import('@/lib/partner-codes/logo')
    const jpeg = new Uint8Array(await sharp({ create: { width: 300, height: 300, channels: 3, background: '#123456' } })
      .withExif({ IFD0: { Make: 'SecretCam', Model: 'X1' } }).jpeg().toBuffer())
    expect((await sharp(jpeg).metadata()).exif).toBeDefined()
    expect((await sharp(await normalizeLogo(jpeg, 'image/jpeg')).metadata()).exif).toBeUndefined()
  })

  it('refuses the wrong type, too-large, too-small and non-image files', async () => {
    const { normalizeLogo } = await import('@/lib/partner-codes/logo')
    await expect(normalizeLogo(await png(300, 300), 'image/gif')).rejects.toBe('bad_type')
    await expect(normalizeLogo(new Uint8Array(5 * 1024 * 1024 + 1), 'image/png')).rejects.toBe('too_large')
    await expect(normalizeLogo(await png(100, 100), 'image/png')).rejects.toBe('too_small')
    await expect(normalizeLogo(new TextEncoder().encode('<script>alert(1)</script>'), 'image/png')).rejects.toBe('unreadable')
  })
})

describe('uploadPartnerLogo and review', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    Object.assign(codeRow, { logoUrl: null, logoStatus: 'none' })
    ;(await import('@/lib/partner-codes/logo'))._resetLogoRateLimit()
  })

  it('stores the cleaned PNG (not the original bytes) and marks it pending', async () => {
    const { uploadPartnerLogo } = await import('@/lib/partner-codes/logo')
    const original = await png(600, 600)
    const res = await uploadPartnerLogo({ userId: 'u1', bytes: original, mimeType: 'image/png' })
    expect(res).toEqual({ ok: true, logoUrl: 'https://blob.example/partner-logos/x.png' })
    const stored = persistProfileImageBytes.mock.calls[0][0] as { bytes: Uint8Array; mimeType: string; keyPrefix: string }
    expect(stored.mimeType).toBe('image/png')
    expect(stored.keyPrefix).toBe('partner-logos')
    expect((await sharp(stored.bytes).metadata()).width).toBe(512)
    expect(codeRow.logoStatus).toBe('pending')
  })

  it('limits uploads to 5 a day per commissioner', async () => {
    const { uploadPartnerLogo } = await import('@/lib/partner-codes/logo')
    const bytes = await png(300, 300)
    const now = new Date('2026-11-23T12:00:00Z')
    for (let i = 0; i < 5; i++) expect((await uploadPartnerLogo({ userId: 'u1', bytes, mimeType: 'image/png', now })).ok).toBe(true)
    expect(await uploadPartnerLogo({ userId: 'u1', bytes, mimeType: 'image/png', now })).toEqual({ ok: false, error: 'rate_limited' })
    expect((await uploadPartnerLogo({ userId: 'u1', bytes, mimeType: 'image/png', now: new Date('2026-11-24T12:00:00Z') })).ok).toBe(true)
  })

  it('rejecting gives the commissioner a reason and puts their images back on initials', async () => {
    Object.assign(codeRow, { logoUrl: 'https://blob.example/a.png', logoStatus: 'pending' })
    const { reviewPartnerLogo } = await import('@/lib/partner-codes/logo')
    await reviewPartnerLogo('pc1', 'reject', 'brand')
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ logoStatus: 'rejected', shareLogo: 'initials', logoReviewNote: expect.stringContaining('brand') }) }))
    await reviewPartnerLogo('pc1', 'approve')
    expect(codeRow.logoStatus).toBe('approved')
  })
})

describe('share image', () => {
  it('uses an uploaded logo only when it is passed (approved); otherwise initials', async () => {
    const { renderShareCard } = await import('@/lib/partner-codes/shareCard')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const base = { code: 'TheCiege', name: 'TheCiege', look: 'midnight' as const, format: 'square' as const, discountPercent: 10, discountMonths: 3 }
    const logoPng = `data:image/png;base64,${Buffer.from(await png(512, 512)).toString('base64')}`
    const withLogo = Buffer.from(await (await renderShareCard({ ...base, logo: 'upload', logoUrl: logoPng })).arrayBuffer())
    const pending = Buffer.from(await (await renderShareCard({ ...base, logo: 'upload', logoUrl: null })).arrayBuffer())
    const initials = Buffer.from(await (await renderShareCard({ ...base, logo: 'initials', logoUrl: null })).arrayBuffer())
    expect(pending.equals(initials)).toBe(true)
    expect(withLogo.equals(initials)).toBe(false)
    vi.unstubAllGlobals()
  }, 60_000)
})
