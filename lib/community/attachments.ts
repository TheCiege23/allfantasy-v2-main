/**
 * League Lab attachments: the photos and PDFs a member adds to an idea so it is easier to
 * follow. Pure — no storage, no database — so the browser form and the upload route share one
 * set of rules and the byte checks are tested directly.
 *
 * Attachments are PUBLIC, like the idea itself (owner's decision, 2026-11-25): anyone who can
 * read the idea can open them. They are still kept in private storage and streamed through
 * /api/community/attachments/[id], so a removed idea takes its files down with it.
 */

export const ATTACHMENTS_PER_IDEA = 4

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const
export const PDF_TYPE = 'application/pdf'
export type AttachmentType = (typeof IMAGE_TYPES)[number] | typeof PDF_TYPE

/** Chimmy reads every file when writing the build plan, so these also bound one request. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const MAX_PDF_BYTES = 10 * 1024 * 1024
/** All files on one idea together. Keeps the build-plan request well under the API's limit. */
export const MAX_TOTAL_BYTES = 20 * 1024 * 1024

export const ATTACHMENT_ACCEPT = [...IMAGE_TYPES, PDF_TYPE].join(',')

export function isImageType(t: string): t is (typeof IMAGE_TYPES)[number] {
  return (IMAGE_TYPES as readonly string[]).includes(t)
}

export function maxBytesFor(t: AttachmentType): number {
  return t === PDF_TYPE ? MAX_PDF_BYTES : MAX_IMAGE_BYTES
}

/**
 * What the file really is, read from its first bytes. The browser's `type` is a guess from the
 * extension and anyone can send any value, so it is never trusted. `null` = not one we accept.
 */
export function sniffAttachmentType(bytes: Uint8Array): AttachmentType | null {
  const b = bytes
  const starts = (...sig: number[]) => sig.every((v, i) => b[i] === v)
  if (b.length >= 8 && starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png'
  if (b.length >= 3 && starts(0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (b.length >= 6 && (starts(0x47, 0x49, 0x46, 0x38, 0x37, 0x61) || starts(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))) return 'image/gif'
  if (
    b.length >= 12 &&
    starts(0x52, 0x49, 0x46, 0x46) &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) return 'image/webp'
  if (b.length >= 5 && starts(0x25, 0x50, 0x44, 0x46, 0x2d)) return PDF_TYPE
  return null
}

const EXT: Record<AttachmentType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
}

export function extensionFor(t: AttachmentType): string {
  return EXT[t]
}

/**
 * A display name safe to store and show: no path, no control characters, at most 120
 * characters, and an extension that matches what the bytes actually are.
 */
export function safeAttachmentName(raw: string | null | undefined, t: AttachmentType): string {
  const base = String(raw ?? '')
    .split(/[\\/]/)
    .pop()!
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f"<>|*?:]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const stem = base.replace(/\.[A-Za-z0-9]{1,8}$/, '').slice(0, 110).trim() || (t === PDF_TYPE ? 'document' : 'image')
  return `${stem}.${EXT[t]}`
}

export type AttachmentCheck = { ok: true; type: AttachmentType } | { ok: false; error: string }

/** The whole rule for one more file on an idea that already holds `existing`. */
export function checkAttachment(args: {
  bytes: Uint8Array
  size: number
  existing: { count: number; totalBytes: number }
}): AttachmentCheck {
  if (args.existing.count >= ATTACHMENTS_PER_IDEA) {
    return { ok: false, error: `An idea can have up to ${ATTACHMENTS_PER_IDEA} files.` }
  }
  const type = sniffAttachmentType(args.bytes)
  if (!type) return { ok: false, error: 'Use a photo (PNG, JPG, GIF, WebP) or a PDF.' }
  if (args.size <= 0) return { ok: false, error: 'That file is empty.' }
  if (args.size > maxBytesFor(type)) {
    return { ok: false, error: type === PDF_TYPE ? 'PDFs can be up to 10 MB.' : 'Photos can be up to 5 MB.' }
  }
  if (args.existing.totalBytes + args.size > MAX_TOTAL_BYTES) {
    return { ok: false, error: 'All files on one idea can add up to 20 MB.' }
  }
  return { ok: true, type }
}

export function attachmentHref(id: string): string {
  return `/api/community/attachments/${encodeURIComponent(id)}`
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export type IdeaAttachmentView = {
  id: string
  href: string
  contentType: AttachmentType
  fileName: string
  byteSize: number
  isImage: boolean
}
