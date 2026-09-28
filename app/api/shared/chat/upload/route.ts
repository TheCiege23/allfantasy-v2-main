import { NextRequest, NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { requireAuth } from "@/lib/auth-guard"
import { putPrivateChatFile, privateChatStorageConfigured } from "@/lib/chat-core/privateStorage"
import {
  CHAT_UPLOAD_SCOPE_ID,
  canAccessBracketLeague,
  canAccessLeague,
  canAccessThread,
  chatUploadPrefix,
  chatUploadReadUrl,
  type ChatUploadScope,
} from "@/lib/chat-core/chatUploadAccess"
import { getLeagueIdFromVirtualRoom, isLeagueVirtualRoom } from "@/lib/chat-core/ChatRoomResolver"

export const dynamic = "force-dynamic"

const MAX_IMAGE = 5 * 1024 * 1024 // 5MB
const MAX_FILE = 10 * 1024 * 1024 // 10MB
const ALLOWED_IMAGE = ["image/jpeg", "image/png", "image/gif", "image/webp"]
const ALLOWED_FILE = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/csv",
]

function field(formData: FormData, key: string): string {
  const value = formData.get(key)
  return typeof value === "string" ? value.trim() : ""
}

/**
 * Which chat this upload is for, and whether the caller is IN it — or the response that says no.
 *
 * `threadId` is whatever /messages has selected: a platform DM/group thread, or a
 * `league:<id>` room, which is either a main league (`League`) or a bracket pool
 * (`BracketLeague`) — the same two branches the room's own message POST takes.
 */
async function resolveScope(
  leagueId: string,
  threadId: string,
  userId: string,
): Promise<{ scope: ChatUploadScope } | { response: NextResponse }> {
  const forbidden = { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  const invalid = { response: NextResponse.json({ error: "Invalid chat" }, { status: 400 }) }

  if (leagueId) {
    if (!CHAT_UPLOAD_SCOPE_ID.test(leagueId)) return invalid
    return (await canAccessLeague(leagueId, userId)) ? { scope: { kind: "league", id: leagueId } } : forbidden
  }
  if (isLeagueVirtualRoom(threadId)) {
    const roomLeagueId = getLeagueIdFromVirtualRoom(threadId) ?? ""
    if (!CHAT_UPLOAD_SCOPE_ID.test(roomLeagueId)) return invalid
    if (await canAccessLeague(roomLeagueId, userId)) return { scope: { kind: "league", id: roomLeagueId } }
    if (await canAccessBracketLeague(roomLeagueId, userId)) return { scope: { kind: "bracket", id: roomLeagueId } }
    return forbidden
  }
  if (!CHAT_UPLOAD_SCOPE_ID.test(threadId)) return invalid
  return (await canAccessThread(threadId, userId)) ? { scope: { kind: "thread", id: threadId } } : forbidden
}

/**
 * POST /api/shared/chat/upload — the /messages composer's photo and file attachments.
 * Multipart formData with "file" and "threadId" (or "leagueId").
 *
 * 🛑 THIS WROTE TO PUBLIC BLOB STORAGE AND CHECKED NO MEMBERSHIP. Any signed-in user could
 * upload, and anyone holding the returned URL — signed in or not, in the chat or not — could
 * open the photo. It now matches the drawer's `/api/chat/upload` exactly:
 *   - a NextAuth session (`requireAuth`), the same identity the reader checks;
 *   - membership of the target league or thread, via the SAME functions
 *     (`lib/chat-core/chatUploadAccess.ts`), proven BEFORE anything is stored;
 *   - PRIVATE storage (`putPrivateChatFile` — S3 when `CHAT_PRIVATE_S3_CONFIG` is set, else a
 *     private Vercel Blob store), handed back only as the authenticated reader URL
 *     `/api/chat/upload?path=…`, which re-checks membership on every open.
 *
 * ⚠ Photos uploaded here before this change are still public Blob URLs inside message
 * bodies. They were left untouched on purpose: moving or deleting them is the owner's call.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  const userId = auth.userId

  if (!privateChatStorageConfigured()) {
    return NextResponse.json({ error: "Storage not configured" }, { status: 503 })
  }

  const formData = await req.formData().catch(() => null)
  if (!formData) return NextResponse.json({ error: "Invalid form data" }, { status: 400 })

  const leagueId = field(formData, "leagueId")
  const threadId = field(formData, "threadId")
  if (!leagueId && !threadId) {
    return NextResponse.json({ error: "leagueId or threadId required" }, { status: 400 })
  }
  const resolved = await resolveScope(leagueId, threadId, userId)
  if ("response" in resolved) return resolved.response

  const file = formData.get("file")
  if (!(file instanceof Blob)) return NextResponse.json({ error: "No file" }, { status: 400 })

  const isImage = ALLOWED_IMAGE.includes(file.type)
  const isAllowedFile = ALLOWED_FILE.includes(file.type)
  if (!isImage && !isAllowedFile) {
    return NextResponse.json({ error: "File type not allowed" }, { status: 400 })
  }
  const maxSize = isImage ? MAX_IMAGE : MAX_FILE
  if (file.size > maxSize) {
    return NextResponse.json(
      { error: isImage ? "Image too large (max 5MB)" : "File too large (max 10MB)" },
      { status: 400 }
    )
  }

  const name = typeof (file as File).name === "string" ? (file as File).name : ""
  const ext = name.split(".").pop()?.toLowerCase() || "bin"
  const safeExt = ["jpg", "jpeg", "png", "gif", "webp", "pdf", "txt", "csv"].includes(ext) ? ext : "bin"
  const media = isImage ? "image" : "file"
  const key = `${chatUploadPrefix(resolved.scope)}/${media}/${randomUUID()}.${safeExt}`
  const mimeType = file.type || "application/octet-stream"

  try {
    const pathname = await putPrivateChatFile(key, file, mimeType)
    return NextResponse.json({ url: chatUploadReadUrl(pathname), type: media, mimeType, size: file.size })
  } catch {
    // Never echo the storage error: it can carry bucket names or endpoint details.
    console.error("[api/shared/chat/upload] Private storage write failed")
    return NextResponse.json({ error: "Upload failed" }, { status: 500 })
  }
}
