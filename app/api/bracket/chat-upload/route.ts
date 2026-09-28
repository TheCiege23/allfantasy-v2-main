import { NextRequest, NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { requireAuth } from "@/lib/auth-guard"
import { putPrivateChatFile, privateChatStorageConfigured } from "@/lib/chat-core/privateStorage"
import {
  CHAT_UPLOAD_SCOPE_ID,
  canAccessBracketLeague,
  chatUploadPrefix,
  chatUploadReadUrl,
} from "@/lib/chat-core/chatUploadAccess"

export const dynamic = "force-dynamic"

const MAX_SIZE = 5 * 1024 * 1024
/** The only types accepted, and the extension each is stored under — never the client's filename. */
const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
}

/**
 * POST /api/bracket/chat-upload — a photo for a bracket pool's chat (`components/bracket/PoolChat`).
 * Multipart formData with "file" and "leagueId" (the BracketLeague id).
 *
 * 🛑 THIS WROTE TO PUBLIC BLOB STORAGE AND CHECKED NO POOL MEMBERSHIP. Any signed-in user
 * could upload, and anyone holding the returned URL could open the photo. It now works like
 * the other two chat upload routes (`/api/chat/upload`, `/api/shared/chat/upload`):
 *   - a NextAuth session (`requireAuth`), the same identity the reader checks;
 *   - membership of the pool, via `canAccessBracketLeague` — the same rule the pool's chat
 *     POST and its `league:<id>` room in /messages apply — proven BEFORE anything is stored;
 *   - PRIVATE storage (`putPrivateChatFile`) under `chat/bracket/<leagueId>/image/`, handed
 *     back only as `/api/chat/upload?path=…`, which re-checks membership on every open.
 *
 * ⚠ Photos uploaded here before this change are still public Blob URLs (`bracket-chat/<userId>/…`)
 * in `BracketLeagueMessage.imageUrl`. They were left untouched on purpose: moving or deleting
 * them is the owner's call.
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

  const rawLeagueId = formData.get("leagueId")
  const leagueId = typeof rawLeagueId === "string" ? rawLeagueId.trim() : ""
  if (!leagueId) return NextResponse.json({ error: "leagueId required" }, { status: 400 })
  if (!CHAT_UPLOAD_SCOPE_ID.test(leagueId)) return NextResponse.json({ error: "Invalid pool" }, { status: 400 })
  if (!(await canAccessBracketLeague(leagueId, userId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const file = formData.get("file")
  if (!(file instanceof Blob)) return NextResponse.json({ error: "No file" }, { status: 400 })

  const ext = EXT_BY_TYPE[file.type]
  if (!ext) {
    return NextResponse.json({ error: "Only JPEG, PNG, GIF, WebP allowed" }, { status: 400 })
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "File too large (max 5MB)" }, { status: 400 })
  }

  const key = `${chatUploadPrefix({ kind: "bracket", id: leagueId })}/image/${randomUUID()}.${ext}`

  try {
    const pathname = await putPrivateChatFile(key, file, file.type)
    return NextResponse.json({ url: chatUploadReadUrl(pathname) })
  } catch {
    // Never echo the storage error: it can carry bucket names or endpoint details.
    console.error("[api/bracket/chat-upload] Private storage write failed")
    return NextResponse.json({ error: "Upload failed" }, { status: 500 })
  }
}
