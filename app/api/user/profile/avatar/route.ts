import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireContactVerifiedUser } from "@/lib/auth-guard"
import {
  isAllowedProfileImageType,
  MAX_PROFILE_IMAGE_BYTES,
  persistProfileImageBytes,
} from "@/lib/avatar/ProfileImageUploadStorageService"
import {
  PROFILE_IMAGE_BAD_TYPE_MESSAGE,
  PROFILE_IMAGE_TOO_LARGE_MESSAGE,
} from "@/lib/avatar/profileImageLimits"

/**
 * POST /api/user/profile/avatar
 * Upload a profile image to Vercel Blob; sets AppUser.avatarUrl to the public HTTPS URL and
 * clears any avatar preset. The single avatar upload route for every surface.
 *
 * ⚠ THE GATE IS VERIFICATION WITHOUT THE AGE CHECK, DELIBERATELY. See
 * `requireContactVerifiedUser` — the settings page previously uploaded through
 * `/api/chat/upload`, whose `requireVerifiedUser` also demands `ageConfirmedAt`, which no
 * OAuth sign-in ever sets. That returned 403 `AGE_REQUIRED` for a profile picture.
 *
 * The guard calls `getOrCreateUserProfile`, so the `userProfile` row is guaranteed to exist
 * by the time the preset is cleared below.
 */
export async function POST(req: NextRequest) {
  const auth = await requireContactVerifiedUser()
  if (!auth.ok) return auth.response
  const userId = auth.userId

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ error: "Storage not configured" }, { status: 503 })
  }

  try {
    const formData = await req.formData()
    const file = formData.get("file") as File | null
    if (!file) return NextResponse.json({ error: "No file" }, { status: 400 })

    if (!isAllowedProfileImageType(file.type)) {
      return NextResponse.json({ error: PROFILE_IMAGE_BAD_TYPE_MESSAGE }, { status: 400 })
    }
    if (file.size > MAX_PROFILE_IMAGE_BYTES) {
      return NextResponse.json({ error: PROFILE_IMAGE_TOO_LARGE_MESSAGE }, { status: 400 })
    }

    const bytes = new Uint8Array(await file.arrayBuffer())
    const { url } = await persistProfileImageBytes({
      bytes,
      mimeType: file.type,
      originalFilename: file.name,
    })

    /*
     * An upload supersedes a preset, and the two live in different tables — `avatarUrl` on
     * AppUser, `avatarPreset` on UserProfile. Clearing the preset here makes "the upload
     * wins" true for every caller rather than something each editor has to remember to
     * PATCH afterwards. `updateMany` so a missing profile row is a no-op, not a throw.
     */
    await prisma.$transaction([
      prisma.appUser.update({ where: { id: userId }, data: { avatarUrl: url } }),
      (prisma as any).userProfile.updateMany({ where: { userId }, data: { avatarPreset: null } }),
    ])

    return NextResponse.json({ url })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Upload failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
