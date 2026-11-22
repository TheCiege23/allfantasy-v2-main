/**
 * MessageAttachmentService — validation and payload building for image/GIF/file attachments.
 */

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024 // 5MB
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024 // 10MB
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"]
const ALLOWED_FILE_TYPES = [
  "image/jpeg", "image/png", "image/gif", "image/webp",
  "application/pdf",
  "text/plain", "text/csv",
]

type ImagePreview = { type: "image"; file: File; url: string }
type GifPreview = { type: "gif"; url: string; source?: string }
type FilePreview = { type: "file"; file: File; url?: string }

export type AttachmentPreview = ImagePreview | GifPreview | FilePreview

export function validateImageFile(file: File): { valid: boolean; error?: string } {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return { valid: false, error: "Only JPEG, PNG, GIF, WebP allowed" }
  }
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    return { valid: false, error: "Image too large (max 5MB)" }
  }
  return { valid: true }
}

export function validateAttachmentFile(file: File): { valid: boolean; error?: string } {
  if (!ALLOWED_FILE_TYPES.includes(file.type) && !file.type.startsWith("image/")) {
    return { valid: false, error: "File type not allowed" }
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { valid: false, error: "File too large (max 10MB)" }
  }
  return { valid: true }
}

export function getMessagePayloadForImage(imageUrl: string, alt?: string): { body: string; messageType: string; metadata?: Record<string, unknown> } {
  return {
    body: imageUrl,
    messageType: "image",
    metadata: alt ? { alt } : undefined,
  }
}

export function getMessagePayloadForGif(gifUrl: string, source?: string): { body: string; messageType: string; metadata?: Record<string, unknown> } {
  return {
    body: gifUrl,
    messageType: "gif",
    metadata: source ? { source } : undefined,
  }
}

export function getMessagePayloadForFile(fileUrl: string, filename: string, contentType?: string): { body: string; messageType: string; metadata?: Record<string, unknown> } {
  return {
    body: fileUrl,
    messageType: "file",
    metadata: { filename, contentType: contentType || "" },
  }
}
