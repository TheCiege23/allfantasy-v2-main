import 'server-only'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/prisma'
import { getPrivateChatFile, privateChatStorageConfigured, putPrivateChatFile } from '@/lib/chat-core/privateStorage'
import {
  attachmentHref,
  checkAttachment,
  extensionFor,
  isImageType,
  safeAttachmentName,
  type AttachmentType,
  type IdeaAttachmentView,
} from './attachments'
import { IDEA_KIND } from './ideas'
import { CommunityError, type CommunityViewer } from './service'

/**
 * Storage and database side of League Lab attachments. The rules (types, sizes, counts) are in
 * `attachments.ts`; this file only applies them, and every read re-checks the idea.
 */

const ATTACHMENT_SELECT = { id: true, contentType: true, fileName: true, byteSize: true } as const

function toView(row: { id: string; contentType: string; fileName: string; byteSize: number }): IdeaAttachmentView {
  const contentType = row.contentType as AttachmentType
  return {
    id: row.id,
    href: attachmentHref(row.id),
    contentType,
    fileName: row.fileName,
    byteSize: row.byteSize,
    isImage: isImageType(contentType),
  }
}

/** For a post the caller has already loaded through `getPost`, which applied visibility. */
export async function listIdeaAttachments(postId: string): Promise<IdeaAttachmentView[]> {
  const rows = await prisma.communityAttachment.findMany({
    where: { postId },
    orderBy: { createdAt: 'asc' },
    select: ATTACHMENT_SELECT,
  })
  return rows.map(toView)
}

/** Only the person who pitched the idea adds files to it. */
export async function addIdeaAttachment(viewer: CommunityViewer, postId: string, file: Blob, rawName: string) {
  if (!viewer.userId) throw new CommunityError(401, 'Sign in first.')
  if (!privateChatStorageConfigured()) throw new CommunityError(503, "File uploads aren't available right now.")
  const post = await prisma.communityPost.findUnique({
    where: { id: postId },
    select: { kind: true, authorUserId: true, removedAt: true },
  })
  if (!post || post.kind !== IDEA_KIND || post.removedAt) throw new CommunityError(404, 'Idea not found')
  if (post.authorUserId !== viewer.userId) throw new CommunityError(403, 'Only the person who pitched this idea can add files.')

  const existing = await prisma.communityAttachment.aggregate({
    where: { postId },
    _count: { _all: true },
    _sum: { byteSize: true },
  })
  const bytes = new Uint8Array(await file.arrayBuffer())
  const check = checkAttachment({
    bytes,
    size: bytes.byteLength,
    existing: { count: existing._count._all, totalBytes: existing._sum.byteSize ?? 0 },
  })
  if (!check.ok) throw new CommunityError(400, check.error)

  const key = `community/ideas/${postId}/${randomUUID()}.${extensionFor(check.type)}`
  await putPrivateChatFile(key, new Blob([bytes], { type: check.type }), check.type)
  const row = await prisma.communityAttachment.create({
    data: {
      postId,
      uploaderUserId: viewer.userId,
      storageKey: key,
      contentType: check.type,
      fileName: safeAttachmentName(rawName, check.type),
      byteSize: bytes.byteLength,
    },
    select: ATTACHMENT_SELECT,
  })
  return toView(row)
}

/** `null` = nothing to show this viewer: unknown id, or the idea was removed and they are not staff. */
export async function openIdeaAttachment(viewer: CommunityViewer, attachmentId: string) {
  const row = await prisma.communityAttachment.findUnique({
    where: { id: attachmentId },
    select: { storageKey: true, contentType: true, fileName: true, post: { select: { removedAt: true } } },
  })
  if (!row) return null
  if (row.post.removedAt && !viewer.isModerator) return null
  const file = await getPrivateChatFile(row.storageKey)
  if (!file) return null
  return { stream: file.stream, contentType: row.contentType as AttachmentType, fileName: row.fileName }
}

/** Every file on an idea, as bytes, in upload order — for the build plan. */
export async function loadIdeaAttachmentBytes(
  postId: string,
): Promise<Array<{ fileName: string; contentType: AttachmentType; data: Buffer }>> {
  const rows = await prisma.communityAttachment.findMany({
    where: { postId },
    orderBy: { createdAt: 'asc' },
    select: { storageKey: true, contentType: true, fileName: true },
  })
  const out: Array<{ fileName: string; contentType: AttachmentType; data: Buffer }> = []
  for (const r of rows) {
    const file = await getPrivateChatFile(r.storageKey)
    if (!file) continue
    const data = Buffer.from(await new Response(file.stream).arrayBuffer())
    out.push({ fileName: r.fileName, contentType: r.contentType as AttachmentType, data })
  }
  return out
}
