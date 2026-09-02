import { NextRequest, NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { put } from "@vercel/blob"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { getBlobReadWriteToken } from "@/lib/blob/readWriteToken"

const MAX_SIZE = 5 * 1024 * 1024
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"]

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  if (!getBlobReadWriteToken()) {
    return NextResponse.json({ error: "Storage not configured" }, { status: 503 })
  }

  try {
    const formData = await req.formData()
    const file = formData.get("file") as File | null
    if (!file) return NextResponse.json({ error: "No file" }, { status: 400 })

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: "Only JPEG, PNG, GIF, WebP allowed" }, { status: 400 })
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "File too large (max 5MB)" }, { status: 400 })
    }

    const ext = file.name.split(".").pop() || "png"
    const filename = `${randomUUID()}.${ext}`
    const key = `bracket-chat/${userId}/${filename}`

    const blob = await put(key, file, {
      access: "public",
      contentType: file.type || "application/octet-stream",
      token: getBlobReadWriteToken(),
    })

    return NextResponse.json({ url: blob.url })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Upload failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
