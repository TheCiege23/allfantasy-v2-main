import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from "next/server"
import crypto from "crypto"
import { put } from "@vercel/blob"
import { consumeSharedRateLimit } from "@/lib/security/sharedRateLimit"
import { getClientIp } from "@/lib/rate-limit"

const MAX_SIZE = 5 * 1024 * 1024

/*
 * 🛑 THIS UPLOAD IS ANONYMOUS (the feedback modal works signed out) AND PUBLIC, so it must
 * not be a free host for arbitrary files. It used to accept any `image/*` the CLIENT
 * declared — `image/svg+xml` included, which can carry script — with the extension taken
 * from the client's filename and the client's content type stored on the blob.
 *
 * Now: raster screenshot formats only, identified by their MAGIC BYTES rather than by
 * anything the client says; the extension and content type are chosen here from that
 * sniff; and uploads are capped per IP.
 */
const RASTER_FORMATS: Array<{ ext: string; type: string; matches: (b: Uint8Array) => boolean }> = [
  { ext: "png", type: "image/png", matches: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { ext: "jpg", type: "image/jpeg", matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: "gif", type: "image/gif", matches: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 },
  {
    ext: "webp",
    type: "image/webp",
    matches: (b) =>
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  },
]

function sniffRasterFormat(head: Uint8Array) {
  return RASTER_FORMATS.find((f) => f.matches(head)) ?? null
}

export const POST = withApiUsage({ endpoint: "/api/legacy/feedback/upload", tool: "LegacyFeedbackUpload" })(
  async (request: NextRequest) => {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return NextResponse.json({ error: "Storage not configured" }, { status: 503 })
    }

    const limit = await consumeSharedRateLimit(`feedback-upload:ip:${getClientIp(request)}`, 10, 60 * 60)
    if (!limit.success) {
      return NextResponse.json({ error: "Too many uploads. Please try again later." }, { status: 429 })
    }

    try {
      const formData = await request.formData()
      const file = formData.get("file") as File | null

      if (!file || typeof file === "string") {
        return NextResponse.json({ error: "No file provided" }, { status: 400 })
      }

      if (file.size > MAX_SIZE) {
        return NextResponse.json({ error: "File must be less than 5MB" }, { status: 400 })
      }

      const bytes = new Uint8Array(await file.arrayBuffer())
      const format = sniffRasterFormat(bytes.subarray(0, 16))
      if (!format) {
        return NextResponse.json({ error: "File must be a PNG, JPEG, GIF or WebP image" }, { status: 400 })
      }

      const fileName = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}.${format.ext}`
      const key = `legacy-feedback/${fileName}`

      const blob = await put(key, Buffer.from(bytes), {
        access: "public",
        contentType: format.type,
        token: process.env.BLOB_READ_WRITE_TOKEN,
      })

      return NextResponse.json({ url: blob.url, fileName })
    } catch (err) {
      console.error("Screenshot upload error:", err)
      return NextResponse.json({ error: "Failed to upload file" }, { status: 500 })
    }
  }
)
