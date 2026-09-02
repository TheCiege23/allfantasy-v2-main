import { NextRequest, NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { put } from "@vercel/blob"
import { resolvePlatformUser } from "@/lib/platform/current-user"
import { getBlobReadWriteToken } from "@/lib/blob/readWriteToken"

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

/**
 * POST /api/shared/chat/upload
 * Multipart formData with "file". Uploads to Vercel Blob, returns { url } (public HTTPS URL).
 */
export async function POST(req: NextRequest) {
  const user = await resolvePlatformUser()
  if (!user.appUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  if (!getBlobReadWriteToken()) {
    return NextResponse.json({ error: "Storage not configured" }, { status: 503 })
  }

  try {
    const formData = await req.formData()
    const file = formData.get("file") as File | null
    if (!file) return NextResponse.json({ error: "No file" }, { status: 400 })

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

    const ext = file.name.split(".").pop()?.toLowerCase() || "bin"
    const safeExt = ["jpg", "jpeg", "png", "gif", "webp", "pdf", "txt", "csv"].includes(ext) ? ext : "bin"
    const filename = `${randomUUID()}.${safeExt}`
    const key = `shared-chat/${user.appUserId}/${filename}`

    const mimeType = file.type || "application/octet-stream"
    const blob = await put(key, file, {
      access: "public",
      contentType: mimeType,
      token: getBlobReadWriteToken(),
    })

    return NextResponse.json({ url: blob.url })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Upload failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
