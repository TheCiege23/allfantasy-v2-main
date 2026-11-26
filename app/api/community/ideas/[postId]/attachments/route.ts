/**
 * POST /api/community/ideas/:postId/attachments — the person who pitched an idea adds one photo
 * or PDF (multipart, field "file"). The form sends each file on its own request, right after the
 * idea is created. Types, sizes and counts are in `lib/community/attachments.ts`; the type is
 * read from the bytes, never from the browser.
 */
import { NextResponse } from 'next/server'
import { addIdeaAttachment } from '@/lib/community/ideaFiles'
import { MAX_PDF_BYTES } from '@/lib/community/attachments'
import { communityRateLimitResponse, requireSignedIn, withCommunityViewer } from '@/lib/community/http'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ postId: string }> }

export async function POST(req: Request, ctx: Ctx) {
  const { postId } = await ctx.params
  return withCommunityViewer(async (viewer) => {
    const unauth = requireSignedIn(viewer)
    if (unauth) return unauth
    const limited = communityRateLimitResponse(viewer.userId!, 'edit')
    if (limited) return limited
    // Refuse an oversized body before reading it, when the client says how big it is.
    const declared = Number(req.headers.get('content-length') || 0)
    if (declared > MAX_PDF_BYTES + 64 * 1024) {
      return NextResponse.json({ error: 'PDFs can be up to 10 MB, photos up to 5 MB.' }, { status: 413 })
    }
    const form = await req.formData().catch(() => null)
    const file = form?.get('file')
    if (!(file instanceof Blob)) return NextResponse.json({ error: 'Choose a file to attach.' }, { status: 400 })
    const name = typeof (file as File).name === 'string' ? (file as File).name : ''
    const attachment = await addIdeaAttachment(viewer, postId, file, name)
    return NextResponse.json({ ok: true, attachment }, { status: 201 })
  })
}
