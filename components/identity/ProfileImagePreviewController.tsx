"use client"

import { IdentityImageRenderer } from "./IdentityImageRenderer"

interface ProfileImagePreviewControllerProps {
  /** When user selects a file, pass object URL here for immediate preview before upload completes. */
  previewObjectUrl?: string | null
  /** Persisted profile image URL (from API). */
  profileImageUrl?: string | null
  avatarPreset?: string | null
  displayName?: string | null
  username?: string | null
  size?: "sm" | "md" | "lg"
  className?: string
}

/**
 * Controls profile image preview: shows previewObjectUrl (instant file preview),
 * then profileImageUrl (saved), then preset or initial.
 * Use in edit forms for immediate feedback when user picks a file.
 */
export function ProfileImagePreviewController({
  previewObjectUrl,
  profileImageUrl,
  avatarPreset,
  displayName,
  username,
  size = "lg",
  className = "",
}: ProfileImagePreviewControllerProps) {
  const effectiveUrl = previewObjectUrl || profileImageUrl

  return (
    <IdentityImageRenderer
      avatarUrl={effectiveUrl || undefined}
      avatarPreset={previewObjectUrl ? null : avatarPreset}
      displayName={displayName}
      username={username}
      size={size}
      className={className}
    />
  )
}
