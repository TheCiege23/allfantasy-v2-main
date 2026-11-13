import type { AttachmentPreview } from "./MessageAttachmentService"

export function getAttachmentPreviewLabel(preview: AttachmentPreview | null): string {
  if (!preview) return ""
  if (preview.type === "image") return "Image"
  if (preview.type === "gif") return "GIF"
  if (preview.type === "file") return preview.file?.name || "File"
  return "Attachment"
}

export function canSendComposerMessage(
  input: string,
  preview: AttachmentPreview | null,
  sending: boolean,
): boolean {
  if (sending) return false
  return Boolean(input.trim() || preview)
}

export function clearAttachmentState<T extends AttachmentPreview | null>(
  setPreview: (value: T) => void,
  setError?: (value: string | null) => void,
) {
  setPreview(null as T)
  if (setError) setError(null)
}
