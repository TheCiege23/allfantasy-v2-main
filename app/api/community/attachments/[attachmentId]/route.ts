/**
 * GET /api/community/attachments/:attachmentId — opens a League Lab attachment. Public, like the
 * idea it belongs to, but streamed from private storage so a removed idea's files go with it.
 *
 * The content type is the one sniffed from the bytes at upload (an image type or PDF, never
 * HTML or SVG), and `nosniff` stops a browser second-guessing it.
 */
import { NextResponse } from 'next/server'
import { openIdeaAttachment } from '@/lib/community/ideaFiles'
import { getCommunityViewer } from '@/lib/community/service'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ attachmentId: string }> }

export async function GET(_req: Request, ctx: Ctx) {
  const { attachmentId } = await ctx.params
  if (!/^[0-9a-f-]{36}$/i.test(attachmentId)) return new NextResponse('Not found', { status: 404 })
  try {
    const viewer = await getCommunityViewer().catch(() => ({ userId: null, isModerator: false }))
    const file = await openIdeaAttachment(viewer, attachmentId)
    if (!file) return new NextResponse('Not found', { status: 404 })
    const ascii = file.fileName.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')
    // No CSP `sandbox` on PDFs: Chrome refuses to open its PDF viewer inside one.
    const csp = file.contentType === 'application/pdf' ? null : "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'"
    return new NextResponse(file.stream, {
      headers: {
        ...(csp ? { 'Content-Security-Policy': csp } : {}),
        'Content-Type': file.contentType,
        'Content-Disposition': `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        'X-Content-Type-Options': 'nosniff',
        // Short and private: a removal should take effect within minutes, not after a CDN day.
        'Cache-Control': 'private, max-age=300',
      },
    })
  } catch (err) {
    console.error('[community/attachments] read failed', err instanceof Error ? err.name : 'unknown')
    return NextResponse.json({ error: 'Something went wrong. Try again.' }, { status: 500 })
  }
}
