import { randomUUID } from "crypto"
import { put } from "@vercel/blob"
import {
  ALLOWED_PROFILE_IMAGE_TYPES,
  MAX_PROFILE_IMAGE_BYTES,
  PROFILE_IMAGE_BAD_TYPE_MESSAGE,
  PROFILE_IMAGE_TOO_LARGE_MESSAGE,
  isAllowedProfileImageType,
  type AllowedProfileImageType,
} from "./profileImageLimits"

/*
 * Re-exported so every existing server importer keeps working unchanged while the browser
 * imports the same values from `./profileImageLimits`. This module pulls in `@vercel/blob`
 * and node's `crypto` and must never reach a client bundle, which is the whole reason the
 * constants moved out.
 */
export { ALLOWED_PROFILE_IMAGE_TYPES, MAX_PROFILE_IMAGE_BYTES, isAllowedProfileImageType }

const MIME_EXTENSION_MAP: Record<AllowedProfileImageType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
}

type AllowedMimeType = AllowedProfileImageType

export function parseAvatarDataUrl(
  dataUrl: string
): { mimeType: AllowedMimeType; bytes: Uint8Array; extension: string } | null {
  const trimmed = dataUrl.trim()
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(trimmed)
  if (!match) return null

  const mimeType = match[1]
  if (!isAllowedProfileImageType(mimeType)) return null

  try {
    const bytes = new Uint8Array(Buffer.from(match[2], "base64"))
    if (!bytes.length || bytes.byteLength > MAX_PROFILE_IMAGE_BYTES) return null
    return {
      mimeType,
      bytes,
      extension: MIME_EXTENSION_MAP[mimeType],
    }
  } catch {
    return null
  }
}

export async function persistProfileImageBytes(params: {
  bytes: Uint8Array
  mimeType: string
  originalFilename?: string | null
}): Promise<{ url: string }> {
  if (params.bytes.byteLength > MAX_PROFILE_IMAGE_BYTES) {
    throw new Error(PROFILE_IMAGE_TOO_LARGE_MESSAGE)
  }
  if (!isAllowedProfileImageType(params.mimeType)) {
    throw new Error(PROFILE_IMAGE_BAD_TYPE_MESSAGE)
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("Storage not configured")
  }

  const fileFromName = params.originalFilename?.split(".").pop()?.toLowerCase() ?? ""
  const canonical = MIME_EXTENSION_MAP[params.mimeType]
  const ext = ["jpg", "jpeg", "png", "gif", "webp"].includes(fileFromName)
    ? fileFromName
    : canonical
  const filename = `${randomUUID()}.${ext}`
  const key = `avatars/${filename}`

  const body = Buffer.from(params.bytes)

  const blob = await put(key, body, {
    access: "public",
    contentType: params.mimeType,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  })

  return { url: blob.url }
}
