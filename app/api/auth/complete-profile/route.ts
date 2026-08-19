import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { resolveOnboardingProfile } from "@/lib/signup/OnboardingProfileResolver"
import {
  parseAvatarDataUrl,
  persistProfileImageBytes,
} from "@/lib/avatar/ProfileImageUploadStorageService"

export const runtime = "nodejs"

export async function POST(req: Request) {
  const session = (await getServerSession(authOptions as any)) as {
    user?: { id?: string; email?: string | null }
  } | null

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id
  const email = session.user.email

  const body = await req.json().catch(() => ({}))

  const resolved = resolveOnboardingProfile(body)
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error, code: resolved.code }, { status: 400 })
  }
  const profile = resolved.value

  // Verification gate (unchanged): the account must have a verified email or phone.
  const existingProfile = await (prisma as any).userProfile
    .findUnique({ where: { userId } })
    .catch(() => null)

  const isVerified = !!existingProfile?.emailVerifiedAt || !!existingProfile?.phoneVerifiedAt
  if (!isVerified) {
    return NextResponse.json({ error: "VERIFICATION_REQUIRED" }, { status: 403 })
  }

  // Only treat the username as a change if it differs from the current handle
  // (the form pre-fills the auto-generated one, so most submits leave it as-is).
  let usernameToPersist: string | null = null
  if (profile.username) {
    const current = await prisma.appUser
      .findUnique({ where: { id: userId }, select: { username: true } })
      .catch(() => null)
    if ((current?.username ?? "").toLowerCase() !== profile.username.toLowerCase()) {
      usernameToPersist = profile.username
    }
  }

  // Optional avatar upload → AppUser.avatarUrl. Non-blocking on storage failure.
  let uploadedAvatarUrl: string | null = null
  const avatarDataUrl = typeof body?.avatarDataUrl === "string" ? body.avatarDataUrl : ""
  if (avatarDataUrl.trim()) {
    const parsed = parseAvatarDataUrl(avatarDataUrl)
    if (!parsed) {
      return NextResponse.json(
        { error: "Invalid profile image. Use JPEG, PNG, GIF, or WebP under 3MB." },
        { status: 400 }
      )
    }
    try {
      const { url } = await persistProfileImageBytes({
        bytes: parsed.bytes,
        mimeType: parsed.mimeType,
        originalFilename: `onboarding-avatar.${parsed.extension}`,
      })
      uploadedAvatarUrl = url
    } catch (avatarErr) {
      console.warn("[complete-profile] avatar upload failed (non-blocking):", avatarErr)
    }
  }

  // Write AppUser (displayName + optional username/avatar) FIRST, so a username
  // uniqueness conflict aborts with 409 before we mark the profile complete.
  try {
    const appUserUpdate: Prisma.AppUserUpdateInput = { displayName: profile.displayName }
    if (usernameToPersist) appUserUpdate.username = usernameToPersist
    if (uploadedAvatarUrl) appUserUpdate.avatarUrl = uploadedAvatarUrl
    await prisma.appUser.update({ where: { id: userId }, data: appUserUpdate })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json(
        { error: "That username is already taken.", code: "USERNAME_TAKEN" },
        { status: 409 }
      )
    }
    console.error("[complete-profile] appUser update failed:", err)
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 })
  }

  // Persist the profile and mark it complete. Only overwrite phone when one was
  // provided, so an already-verified phone isn't wiped by a blank field.
  const profileUpdate: Record<string, unknown> = {
    displayName: profile.displayName,
    timezone: profile.timezone,
    preferredLanguage: profile.preferredLanguage,
    avatarPreset: profile.avatarPreset,
    profileComplete: true,
  }
  if (profile.phone) profileUpdate.phone = profile.phone

  await (prisma as any).userProfile.upsert({
    where: { userId },
    update: profileUpdate,
    create: { userId, ...profileUpdate, phone: profile.phone },
  })

  if (email) {
    await (prisma as any).pendingSignup.delete({ where: { email } }).catch(() => {})
  }

  return NextResponse.json({ ok: true, username: usernameToPersist ?? undefined })
}
