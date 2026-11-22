import "server-only"
import { createHash } from "crypto"

export const WORLD_CUP_CHAT_IMAGE_MAX_BYTES = 5 * 1024 * 1024
const WORLD_CUP_CHAT_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const

type WorldCupChatImageMimeType = typeof WORLD_CUP_CHAT_IMAGE_TYPES[number]

type WorldCupChatImageUploadResult = {
  assetId: string
  publicId: string
  secureUrl: string
  width: number
  height: number
  format: string
  bytes: number
  provider: "cloudinary"
}

type CloudinaryUploadResponse = {
  asset_id?: string
  public_id?: string
  secure_url?: string
  width?: number
  height?: number
  format?: string
  bytes?: number
}

export function isWorldCupChatImageType(mimeType: string): mimeType is WorldCupChatImageMimeType {
  return (WORLD_CUP_CHAT_IMAGE_TYPES as readonly string[]).includes(mimeType)
}

export function isCloudinaryConfigured() {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET
  )
}

function signedCloudinaryParams(params: Record<string, string>, apiSecret: string) {
  const payload = Object.entries(params)
    .filter(([, value]) => value !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("&")

  return createHash("sha1").update(`${payload}${apiSecret}`).digest("hex")
}

export async function uploadWorldCupChatImageToCloudinary(input: {
  file: Blob
  challengeId: string
  userId: string
}): Promise<WorldCupChatImageUploadResult> {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME
  const apiKey = process.env.CLOUDINARY_API_KEY
  const apiSecret = process.env.CLOUDINARY_API_SECRET

  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error("Cloudinary storage is not configured")
  }

  const timestamp = Math.floor(Date.now() / 1000).toString()
  const folder = `allfantasy/world-cup/${input.challengeId}/chat`
  const paramsToSign = { folder, timestamp }
  const signature = signedCloudinaryParams(paramsToSign, apiSecret)
  const formData = new FormData()

  formData.set("file", input.file)
  formData.set("api_key", apiKey)
  formData.set("timestamp", timestamp)
  formData.set("folder", folder)
  formData.set("signature", signature)

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: "POST",
    body: formData,
  })
  const json = await res.json().catch(() => ({})) as CloudinaryUploadResponse & { error?: { message?: string } }

  if (!res.ok) {
    throw new Error(json.error?.message ?? "Cloudinary upload failed")
  }

  if (!json.asset_id || !json.public_id || !json.secure_url) {
    throw new Error("Cloudinary upload response was missing image metadata")
  }

  return {
    assetId: json.asset_id,
    publicId: json.public_id,
    secureUrl: json.secure_url,
    width: typeof json.width === "number" ? json.width : 0,
    height: typeof json.height === "number" ? json.height : 0,
    format: typeof json.format === "string" ? json.format : "",
    bytes: typeof json.bytes === "number" ? json.bytes : input.file.size,
    provider: "cloudinary",
  }
}
