/**
 * Profile image limits and type rules, shared by the browser and the server.
 *
 * ⚠ SEPARATE FROM `ProfileImageUploadStorageService` ON PURPOSE. That module imports
 * `@vercel/blob` and node's `crypto`, so a client-side upload helper cannot import the
 * limit from it without dragging server-only code into the browser bundle. The constants
 * live here and the storage service re-exports them, so existing server importers are
 * untouched.
 *
 * ⚠ ONE LIMIT, NOT THREE. There were three: 2MB in a dead `/api/user/avatar` route, 3MB on
 * the server, and a hardcoded 3MB in the client helper. A file sitting between two of them
 * passed one check and failed the next, and the message named a size the code did not
 * enforce. Derive every message from `MAX_PROFILE_IMAGE_MB` so they cannot drift again.
 *
 * The limit is 8MB because a photo straight off a modern phone camera routinely exceeds
 * 3MB, and a size rejection is indistinguishable to a user from the auth failure this
 * change was made to fix. Client-side downscaling (planned with crop/rotate) will make
 * most real uploads a fraction of this.
 */

export const MAX_PROFILE_IMAGE_MB = 8
export const MAX_PROFILE_IMAGE_BYTES = MAX_PROFILE_IMAGE_MB * 1024 * 1024

export const ALLOWED_PROFILE_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const

export type AllowedProfileImageType = (typeof ALLOWED_PROFILE_IMAGE_TYPES)[number]

export function isAllowedProfileImageType(mimeType: string): mimeType is AllowedProfileImageType {
  return (ALLOWED_PROFILE_IMAGE_TYPES as readonly string[]).includes(mimeType)
}

/** The `accept` attribute for a profile-image file input, from the same source of truth. */
export const PROFILE_IMAGE_ACCEPT_ATTRIBUTE = ALLOWED_PROFILE_IMAGE_TYPES.join(",")

export const PROFILE_IMAGE_TOO_LARGE_MESSAGE = `That image is too large (max ${MAX_PROFILE_IMAGE_MB}MB).`
export const PROFILE_IMAGE_BAD_TYPE_MESSAGE = "Pick a JPEG, PNG, GIF or WebP image."
