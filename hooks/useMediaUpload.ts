"use client"

import { useCallback, useState } from "react"
import { isValidGifOrImageUrl, validateAttachmentFile } from "@/lib/rich-message"

export type MediaType = "gif" | "image" | "video" | "meme"

/**
 * Shared upload helper for media actions. Returns uploaded URL (or GIF URL)
 * and exposes simple progress/error state.
 */
export function useMediaUpload(threadId?: string) {
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const upload = useCallback(
    async (type: MediaType, file?: File | null, url?: string): Promise<string | null> => {
      setError(null)
      if (type === "gif") {
        if (!url || !isValidGifOrImageUrl(url)) {
          setError("Enter a valid GIF URL")
          return null
        }
        return url.trim()
      }

      if (!file) {
        setError("Select a file first")
        return null
      }

      const validation = validateAttachmentFile(file)
      if (!validation.valid) {
        setError(validation.error ?? "Invalid file")
        return null
      }

      // The upload route stores privately and only for a member of the chat it names.
      if (!threadId) {
        setError("Open a conversation first")
        return null
      }

      setProgress(20)
      try {
        const formData = new FormData()
        formData.append("file", file)
        formData.append("threadId", threadId)
        const res = await fetch("/api/shared/chat/upload", { method: "POST", body: formData })
        setProgress(80)
        const data = await res.json().catch(() => ({}))
        if (!res.ok || typeof data?.url !== "string") {
          setError(typeof data?.error === "string" ? data.error : "Upload failed")
          setProgress(0)
          return null
        }
        setProgress(100)
        return data.url
      } catch {
        setError("Upload failed")
        return null
      } finally {
        setTimeout(() => setProgress(0), 150)
      }
    },
    [threadId]
  )

  const uploadGif = useCallback(
    (url?: string) => upload("gif", null, url),
    [upload]
  )
  const uploadImage = useCallback(
    (file?: File | null) => upload("image", file),
    [upload]
  )
  const uploadVideo = useCallback(
    (file?: File | null) => upload("video", file),
    [upload]
  )
  const uploadMeme = useCallback(
    (file?: File | null) => upload("meme", file),
    [upload]
  )

  return {
    uploadGif,
    uploadImage,
    uploadVideo,
    uploadMeme,
    progress,
    error,
    setError,
  }
}
