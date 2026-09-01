import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth-guard"
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
 * 🛑 THE GATE IS A SESSION AND NOTHING MORE, DELIBERATELY. A profile picture is not an
 * age-restricted or deliverability-restricted action, and every stricter gate tried here has
 * locked out a population nobody intended to lock out:
 *
 *   - `requireVerifiedUser` (what `/api/chat/upload` uses, which the settings page used to
 *     post to) demands `ageConfirmedAt`. No OAuth sign-in ever writes that field, so EVERY
 *     Google account got 403 `AGE_REQUIRED` for a profile picture. Reported from a Play
 *     Store test user 2026-09-01.
 *   - Requiring only contact verification still shut out every account with no verified
 *     email or phone — a materially large group — who could upload from `/profile` before.
 *
 * So: signed in, and that is the whole test. Widen this only with a reason that survives
 * both of the above.
 *
 * ⚠ `requireAuth` does NOT create a `userProfile` row, unlike the stricter guards. The
 * preset clear below therefore uses `updateMany`, which is a no-op on a missing row rather
 * than a throw. Do not "tidy" it into `update`.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth()
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
