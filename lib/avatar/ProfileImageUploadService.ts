/**
 * Client-side profile image upload: calls POST /api/user/profile/avatar and returns the URL.
 *
 * ⚠ ONE ROUTE FOR BOTH EDITORS. The settings page used to POST to `/api/chat/upload`
 * instead, which sits behind `requireVerifiedUser` — age AND verification — so a Google
 * sign-in that had never confirmed its age got a 403 `AGE_REQUIRED` for a profile picture
 * while the identical upload from `/profile` succeeded. Two doors, one locked, and no sign
 * on either. Route both editors here so there is one auth model and one size limit.
 */

import { describeAvatarUploadError } from "./AvatarUploadErrorCopy"
import {
  MAX_PROFILE_IMAGE_BYTES,
  PROFILE_IMAGE_BAD_TYPE_MESSAGE,
  PROFILE_IMAGE_TOO_LARGE_MESSAGE,
  isAllowedProfileImageType,
} from "./profileImageLimits"

const AVATAR_UPLOAD_API = "/api/user/profile/avatar"

export interface UploadResult {
  ok: boolean
  url?: string
  /** Already human-readable. Render it directly — do not map it again. */
  error?: string
}

export async function uploadProfileImage(file: File): Promise<UploadResult> {
  if (file.size > MAX_PROFILE_IMAGE_BYTES) {
    return { ok: false, error: PROFILE_IMAGE_TOO_LARGE_MESSAGE }
  }
  if (!isAllowedProfileImageType(file.type)) {
    return { ok: false, error: PROFILE_IMAGE_BAD_TYPE_MESSAGE }
  }

  const formData = new FormData()
  formData.append("file", file)

  try {
    const res = await fetch(AVATAR_UPLOAD_API, { method: "POST", body: formData })
    const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string }
    if (!res.ok) return { ok: false, error: describeAvatarUploadError(data?.error) }
    if (!data?.url) return { ok: false, error: describeAvatarUploadError(null) }
    return { ok: true, url: data.url }
  } catch {
    // A thrown fetch is a transport failure, not a server verdict — say which.
    return { ok: false, error: "Upload failed — check your connection and try again." }
  }
}
