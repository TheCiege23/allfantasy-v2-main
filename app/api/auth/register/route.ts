import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { prisma } from "@/lib/prisma"
import { isUndeliverableEmailDomain } from "@/lib/email/undeliverableDomains"
import { notifyOwnerOfNewSignup } from "@/lib/notifications/notifyOwnerOfNewSignup"
import { getPlatformEvents, EVENT } from "@/lib/events"
import { Prisma, VerificationMethod } from "@prisma/client"
import bcrypt from "bcryptjs"
import { sha256Hex, makeToken, isStrongPassword } from "@/lib/tokens"
import { getClientIp, rateLimit } from "@/lib/rate-limit"
import { attributeSignup } from "@/lib/referral"
import { attributeSignupFromLandingInviteToken } from "@/lib/dashboard/attributeSignupFromLandingInvite"
import { recordAttribution } from "@/lib/viral-loop"
import { recordFunnelEvent } from "@/lib/analytics/recordFunnelEvent"
import { ACQUISITION } from "@/lib/analytics/eventNames"
import {
  admissionErrorMessage,
  consumeAdmission,
  isInviteOnlyEnabled,
  validateAdmission,
  type AdmissionErrorCode,
} from "@/lib/beta-invite/betaAdmissionService"
import { BETA_ADMISSION_COOKIE, clearAdmissionCookie } from "@/lib/beta-invite/betaAdmissionCookie"

/** Thrown inside the create transaction so a consume failure rolls the account back and maps to a 403. */
class BetaAdmissionConsumeError extends Error {
  constructor(public readonly code: AdmissionErrorCode) {
    super(`beta admission consume failed: ${code}`)
    this.name = "BetaAdmissionConsumeError"
  }
}
import { validateLeagueJoin } from "@/lib/league-privacy"
import { hasProfanityInUsername } from "@/lib/signup/UsernameProfanityGuard"
import { generateUniqueUsername } from "@/lib/signup/AutoUsernameGenerator"
import { resolvePreferredLanguage } from "@/lib/signup/LanguagePreferenceResolver"
import {
  isAllowedSignupTimezone,
  resolveSignupTimezone,
} from "@/lib/signup/TimezoneSelectorService"
import { resolveAvatarPreset } from "@/lib/signup/AvatarPickerService"
import { validateAgreementAcceptance } from "@/lib/legal/AgreementAcceptanceService"
import { resolveTheme } from "@/lib/theme/constants"
import {
  parseAvatarDataUrl,
  persistProfileImageBytes,
} from "@/lib/avatar/ProfileImageUploadStorageService"
import { getTierFromXP, getXPRemainingToNextTier } from "@/lib/xp-progression/TierResolver"
import { lookupSleeperUser } from "@/lib/sleeper/user-lookup"
import { GUEST_SESSION_COOKIE_NAME } from "@/lib/guest-mode/guestSessionToken"
import { claimGuestTrialForUser } from "@/lib/legacy/claimGuestTrialForUser"
import { detectUserState } from "@/lib/geo/detectUserState"
import { isFullyBlocked, isPaidBlocked } from "@/lib/geo/restrictedStates"
import { buildMetaEventPayload } from "@/lib/meta-events"
import { trackMetaServerEvent } from "@/lib/meta-capi"

export const runtime = "nodejs"

function normalizeUsername(u: string) {
  return u.trim()
}

function normalizeEmail(e: string) {
  return e.trim().toLowerCase()
}

function normalizePhone(p?: string | null) {
  const s = (p ?? "").trim().replace(/[\s()-]/g, "")
  if (!s.length) return null
  if (s.startsWith("+")) return s
  return `+1${s}`
}

function getUniqueConstraintTarget(err: Prisma.PrismaClientKnownRequestError): string {
  const rawTarget = err.meta?.target
  if (Array.isArray(rawTarget)) {
    return rawTarget.join(",").toLowerCase()
  }
  if (typeof rawTarget === "string") {
    return rawTarget.toLowerCase()
  }
  return String(err.message ?? "").toLowerCase()
}

function isDatabaseUnavailableError(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientInitializationError) return true

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // Common transient/db connectivity issues from Prisma.
    if (["P1001", "P1002", "P1008", "P1017", "P2024", "P2028"].includes(err.code)) {
      return true
    }
  }

  const message = String((err as any)?.message ?? "").toLowerCase()
  if (message.includes("can't reach database server")) return true
  if (message.includes("connection timed out")) return true
  if (message.includes("terminating connection due to administrator command")) return true
  if (message.includes("maxclientsinsessionmode")) return true
  if (message.includes("too many clients")) return true
  if (message.includes("unable to start a transaction in the given time")) return true

  return false
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withDatabaseUnavailableRetry<T>(operation: () => Promise<T>): Promise<T> {
  const maxAttempts = 3

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation()
    } catch (err) {
      const lastAttempt = attempt === maxAttempts
      if (!isDatabaseUnavailableError(err) || lastAttempt) {
        throw err
      }

      const backoffMs = 150 * attempt
      console.warn(
        `[register] transient database error during signup; retrying attempt ${attempt + 1} of ${maxAttempts} in ${backoffMs}ms`
      )
      await sleep(backoffMs)
    }
  }

  throw new Error("Registration retry loop exited unexpectedly.")
}

function throwRegistrationConflict(err: Prisma.PrismaClientKnownRequestError): never {
  const target = getUniqueConstraintTarget(err)
  if (target.includes("email")) {
    throw new Response(
      JSON.stringify({ error: "An account with this email already exists." }),
      { status: 409 }
    )
  }
  if (target.includes("username")) {
    throw new Response(
      JSON.stringify({ error: "username already taken, choose another username" }),
      { status: 409 }
    )
  }
  throw new Response(
    JSON.stringify({ error: "An account with one of these details already exists." }),
    { status: 409 }
  )
}

async function withRegistrationConflictHandling<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throwRegistrationConflict(err)
    }
    throw err
  }
}

/**
 * True when `err` is the 409 thrown by throwRegistrationConflict for a *username*
 * uniqueness collision (not email). Used to decide whether an auto-generated
 * handle should be regenerated and retried. Reads a clone so the original
 * Response body stays intact for the top-level handler.
 */
async function isUsernameConflictResponse(err: unknown): Promise<boolean> {
  if (!(err instanceof Response) || err.status !== 409) return false
  try {
    const text = await err.clone().text()
    return text.toLowerCase().includes("username")
  } catch {
    return false
  }
}

export async function POST(req: Request) {
  try {
    // E2E register bypass: enabled in non-production, OR in a production-MODE build
    // only when the operator explicitly opts in via ALLOW_E2E_SEED=1 (the same flag
    // the E2E seed route uses). Needed because the only stable local browser runtime
    // is `next start` (production mode) against the STAGING DB. The real production
    // deploy never sets ALLOW_E2E_SEED, so the bypass stays disabled there; it also
    // still requires the x-allfantasy-e2e header. Never exposed to real users.
    const isE2ERequest =
      (process.env.NODE_ENV !== "production" || process.env.ALLOW_E2E_SEED === "1") &&
      req.headers.get("x-allfantasy-e2e") === "1"

    let detectedStateCode: string | null = null
    let stateRestrictionLevel: string | null = null
    let isStateRestrictedFlag = false

    if (!isE2ERequest) {
      const geo = await detectUserState(req)
      detectedStateCode = geo.stateCode
      if (geo.stateCode && isFullyBlocked(geo.stateCode)) {
        return NextResponse.json(
          {
            error: "GEO_BLOCKED",
            stateCode: geo.stateCode,
            message: `Account creation is not available in ${geo.stateCode}. Fantasy sports are prohibited under state law.`,
          },
          { status: 451 }
        )
      }
      if (
        geo.isVpnOrProxy &&
        geo.stateCode &&
        (isFullyBlocked(geo.stateCode) || isPaidBlocked(geo.stateCode))
      ) {
        return NextResponse.json(
          {
            error: "VPN_BLOCKED",
            message:
              "VPN or proxy usage is not permitted when accessing AllFantasy.ai from a restricted state.",
          },
          { status: 451 }
        )
      }
      if (geo.stateCode && isPaidBlocked(geo.stateCode)) {
        stateRestrictionLevel = "paid_block"
        isStateRestrictedFlag = true
      }
    }

    const ip = getClientIp(req)
    if (!isE2ERequest) {
      const rl = rateLimit(`signup:${ip}`, 5, 600_000)
      if (!rl.success) {
        return NextResponse.json({ error: "Too many signup attempts. Please wait a few minutes." }, { status: 429 })
      }
    }

    let body: any
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: "Invalid request payload." }, { status: 400 })
    }
    const {
      password,
      displayName,
      phone,
      sleeperUsername,
      ageConfirmed,
      verificationMethod,
      timezone,
      preferredLanguage,
      themePreference,
      avatarPreset,
      avatarDataUrl,
      phoneVerificationCode,
      disclaimerAgreed,
      termsAgreed,
      referralCode: referralCodeFromBody,
    } = body

    // Accept legacy/alternate keys (e.g. integrations sending termsAccepted).
    const termsAgreedResolved = Boolean(
      termsAgreed ?? (body as { termsAccepted?: unknown }).termsAccepted
    )
    const disclaimerAgreedResolved = Boolean(
      disclaimerAgreed ?? (body as { disclaimerAccepted?: unknown }).disclaimerAccepted
    )

    const cookieStore = await cookies()
    const referralCodeFromCookie = cookieStore.get("af_ref")?.value ?? null
    const referralCode = typeof referralCodeFromBody === "string" && referralCodeFromBody.trim()
      ? referralCodeFromBody.trim().toUpperCase()
      : referralCodeFromCookie?.trim().toUpperCase() || null

    const clientUsername = normalizeUsername(String(body?.username ?? ""))
    const email = normalizeEmail(String(body?.email ?? ""))
    const autoGeneratedUsername = clientUsername.length === 0

    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 })
    }

    // ── P0-1 BETA-GATE (credentials path) ────────────────────────────────────────────
    // Closed-beta admission is checked BEFORE any expensive/irreversible work (password
    // hashing, profile creation) and consumed atomically inside the create transaction
    // below. The token comes from the request body or the httpOnly admission cookie; the
    // client never chooses the userId or the outcome. The E2E seam bypasses the gate under
    // its existing explicit control, so automated tests keep working.
    const admissionToken =
      (typeof body?.inviteToken === "string" ? body.inviteToken.trim() : "") ||
      cookieStore.get(BETA_ADMISSION_COOKIE)?.value ||
      null

    if (isInviteOnlyEnabled() && !isE2ERequest) {
      let precheck: Awaited<ReturnType<typeof validateAdmission>>
      try {
        precheck = await validateAdmission({ rawToken: admissionToken, email })
      } catch {
        // Fail closed: if the gate cannot be evaluated, refuse rather than open signup.
        return NextResponse.json(
          { error: admissionErrorMessage("GATE_UNAVAILABLE"), code: "GATE_UNAVAILABLE" },
          { status: 503 },
        )
      }
      if (!precheck.ok) {
        return NextResponse.json(
          { error: admissionErrorMessage(precheck.code), code: precheck.code },
          { status: 403 },
        )
      }
    }

    // Case-insensitive availability probe, shared by generation and validation.
    const isUsernameTaken = async (candidate: string): Promise<boolean> => {
      const hit = await withDatabaseUnavailableRetry(() =>
        prisma.appUser.findFirst({
          where: { username: { equals: candidate, mode: "insensitive" } },
          select: { id: true },
        })
      )
      return Boolean(hit)
    }

    // The redesigned /signup form no longer collects a username — it is generated
    // server-side from the display name (username selection moves to onboarding).
    // Callers that DO send one (legacy clients / integrations) keep the original
    // validation path unchanged. `username` is `let` so an auto-generated handle
    // can be regenerated if it loses a race to a concurrent signup (see below).
    let username: string
    if (autoGeneratedUsername) {
      username = await generateUniqueUsername({
        name: typeof displayName === "string" ? displayName : "",
        isTaken: isUsernameTaken,
      })
    } else {
      username = clientUsername
      if (username.length < 3 || username.length > 30) {
        return NextResponse.json({ error: "Username must be 3-30 characters." }, { status: 400 })
      }
      if (!/^[A-Za-z0-9_]+$/.test(username)) {
        return NextResponse.json({ error: "Username can only contain letters, numbers, and underscores." }, { status: 400 })
      }
      if (hasProfanityInUsername(username)) {
        return NextResponse.json(
          { error: "Please choose a different username." },
          { status: 400 },
        )
      }
    }

    if (!isStrongPassword(String(password ?? ""))) {
      return NextResponse.json({ error: "Password must be at least 8 characters with a letter and number." }, { status: 400 })
    }

    if (!ageConfirmed) {
      return NextResponse.json({ error: "You must confirm you are 18 or older." }, { status: 400 })
    }

    const agreementsValidation = validateAgreementAcceptance({
      termsAgreed: termsAgreedResolved,
      disclaimerAgreed: disclaimerAgreedResolved,
    })
    if (!agreementsValidation.ok) {
      return NextResponse.json({ error: agreementsValidation.error }, { status: 400 })
    }

    const method: VerificationMethod = verificationMethod === "PHONE" ? "PHONE" : "EMAIL"
    const normalizedPhone = normalizePhone(phone)
    if (method === "PHONE" && !normalizedPhone) {
      return NextResponse.json({ error: "Phone is required for phone verification." }, { status: 400 })
    }
    if (method === "PHONE" && normalizedPhone && !/^\+\d{10,15}$/.test(normalizedPhone)) {
      return NextResponse.json({ error: "Please enter a valid phone number with country code." }, { status: 400 })
    }

    if (typeof timezone !== "undefined" && timezone !== null && !isAllowedSignupTimezone(timezone)) {
      return NextResponse.json({ error: "Please choose a valid US/Canada/Mexico timezone." }, { status: 400 })
    }
    const resolvedTimezone = resolveSignupTimezone(timezone)
    const resolvedLanguage = resolvePreferredLanguage(preferredLanguage)
    const resolvedThemePreference =
      typeof themePreference === "string" ? resolveTheme(themePreference) : null
    const resolvedAvatarPreset = avatarPreset === null ? null : resolveAvatarPreset(avatarPreset)
    const parsedAvatarUpload =
      typeof avatarDataUrl === "string" && avatarDataUrl.trim().length > 0
        ? parseAvatarDataUrl(avatarDataUrl)
        : null
    if (typeof avatarDataUrl === "string" && avatarDataUrl.trim().length > 0 && !parsedAvatarUpload) {
      return NextResponse.json({ error: "Invalid profile image. Use JPEG, PNG, GIF, or WebP under 3MB." }, { status: 400 })
    }

    if (method === "PHONE" && !isE2ERequest) {
      const code = String(phoneVerificationCode ?? "").trim()
      if (!code) {
        return NextResponse.json({ error: "Phone verification code is required." }, { status: 400 })
      }
      try {
        const { getTwilioClient } = await import("@/lib/twilio-client")
        const client = await getTwilioClient()
        const verifySid = process.env.TWILIO_VERIFY_SERVICE_SID
        if (!verifySid) {
          return NextResponse.json({ error: "PHONE_VERIFY_NOT_CONFIGURED" }, { status: 500 })
        }
        const check = await client.verify.v2.services(verifySid).verificationChecks.create({
          to: normalizedPhone!,
          code,
        })
        if (check.status !== "approved") {
          return NextResponse.json({ error: "Invalid phone verification code." }, { status: 400 })
        }
      } catch (phoneVerifyError) {
        console.error("[register] phone verification check failed:", phoneVerifyError)
        return NextResponse.json({ error: "Phone verification failed." }, { status: 400 })
      }
    }

    type ExistingSignupUser = { id: string; email: string | null; username: string | null }
    const existing = await withDatabaseUnavailableRetry<ExistingSignupUser | null>(() =>
      prisma.appUser.findFirst({
        where: {
          OR: [
            { email: { equals: email, mode: "insensitive" } },
            { username: { equals: username, mode: "insensitive" } },
          ],
        },
        select: { id: true, email: true, username: true },
      })
    )

    if (existing?.email && existing.email.toLowerCase() === email.toLowerCase()) {
      return NextResponse.json(
        { error: "An account with this email already exists." },
        { status: 409 }
      )
    }
    if (existing?.username && existing.username.toLowerCase() === username.toLowerCase()) {
      return NextResponse.json(
        { error: "username already taken, choose another username" },
        { status: 409 }
      )
    }

    const passwordHash = await bcrypt.hash(password, isE2ERequest ? 6 : 12)
    const now = new Date()

    let sleeperData: { sleeperUsername?: string; sleeperUserId?: string; sleeperLinkedAt?: Date } = {}
    if (!isE2ERequest && sleeperUsername) {
      try {
        const sleeperLookup = await lookupSleeperUser(sleeperUsername)
        if (sleeperLookup.status === "found") {
          const sleeperUser = sleeperLookup.user
          sleeperData = {
            sleeperUsername: sleeperUser.username || sleeperUsername.trim(),
            sleeperUserId: sleeperUser.user_id,
            sleeperLinkedAt: now,
          }
        }
      } catch {}
    }

    const createProfileData = {
      displayName: displayName?.trim() || username,
      phone: normalizedPhone,
      ageConfirmedAt: now,
      verificationMethod: method,
      phoneVerifiedAt: method === "PHONE" ? now : null,
      ...sleeperData,
      profileComplete: false,
      timezone: resolvedTimezone,
      preferredLanguage: resolvedLanguage,
      themePreference: resolvedThemePreference,
      avatarPreset: resolvedAvatarPreset,
    }

    const upsertManagerXpProfile = async (
      client: Pick<typeof prisma, "managerXPProfile">,
      managerId: string
    ) => {
      await client.managerXPProfile.upsert({
        where: { managerId },
        create: {
          managerId,
          totalXP: 0,
          currentTier: getTierFromXP(0),
          xpToNextTier: getXPRemainingToNextTier(0),
        },
        update: {},
        select: { managerId: true },
      })
    }

    const buildUserCreateData = (finalUsername: string) => ({
      email,
      username: finalUsername,
      passwordHash,
      displayName: displayName?.trim() || finalUsername,
      detectedStateCode,
      stateRestrictionLevel,
      isStateRestricted: isStateRestrictedFlag,
    })

    const createAccountOnce = (finalUsername: string) =>
      withDatabaseUnavailableRetry(() =>
        withRegistrationConflictHandling(async () => {
          if (isE2ERequest) {
            const created = await prisma.appUser.create({
              data: buildUserCreateData(finalUsername),
              select: { id: true, email: true, username: true },
            })

            try {
              await prisma.userProfile.create({
                data: {
                  userId: created.id,
                  ...createProfileData,
                  displayName: displayName?.trim() || finalUsername,
                },
                select: { userId: true },
              })
            } catch (profileErr) {
              try {
                await prisma.appUser.delete({ where: { id: created.id } })
              } catch (cleanupErr) {
                console.warn("[register] failed to clean up e2e user after profile create error:", cleanupErr)
              }
              throw profileErr
            }

            try {
              await upsertManagerXpProfile(prisma, created.id)
            } catch (xpErr) {
              console.warn("[register] managerXPProfile upsert failed during e2e signup (non-blocking):", xpErr)
            }

            return created
          }

          return prisma.$transaction(async (tx) => {
            const created = await tx.appUser.create({
              data: buildUserCreateData(finalUsername),
              select: { id: true, email: true, username: true },
            })

            // P0-1 BETA-GATE: consume the invite in the SAME transaction as the account.
            // If this throws (concurrent redemption, or the invite changed state between the
            // pre-check and here), the whole transaction rolls back and the invite stays
            // redeemable — a failed signup never burns an invite. E2E signups skip the gate.
            if (isInviteOnlyEnabled() && !isE2ERequest) {
              const consumed = await consumeAdmission({
                rawToken: admissionToken,
                email,
                userId: created.id,
                db: tx,
              })
              if (!consumed.ok) {
                throw new BetaAdmissionConsumeError(consumed.code)
              }
            }

            await tx.userProfile.create({
              data: {
                userId: created.id,
                ...createProfileData,
                displayName: displayName?.trim() || finalUsername,
              },
              select: { userId: true },
            })

            await upsertManagerXpProfile(tx, created.id)

            return created
          })
        })
      )

    // For an auto-generated username, a unique-constraint collision means a
    // concurrent signup grabbed the same handle between the availability check
    // and the insert. Regenerate a fresh handle and retry rather than surfacing
    // a "username taken" error the user can't act on — they never chose it.
    // Email (and any other) conflicts propagate unchanged.
    let user: { id: string; email: string | null; username: string | null }
    if (autoGeneratedUsername) {
      const maxUsernameRetries = 3
      let attempt = 0
      // eslint-disable-next-line no-constant-condition
      while (true) {
        try {
          user = await createAccountOnce(username)
          break
        } catch (err) {
          if (attempt < maxUsernameRetries && (await isUsernameConflictResponse(err))) {
            attempt += 1
            username = await generateUniqueUsername({
              name: typeof displayName === "string" ? displayName : "",
              isTaken: isUsernameTaken,
            })
            continue
          }
          throw err
        }
      }
    } else {
      user = await createAccountOnce(username)
    }

    // Notify the owner of the new account. Hooked here, after createAccountOnce has
    // fully returned, rather than inside the two `appUser.create` branches: the E2E
    // branch deletes the row on a profile-create error, so emailing inside it could
    // notify for an account that is then rolled back. This point is reached only on a
    // committed create, so it fires exactly once per new account and never on login.
    // Not awaited — fire-and-forget.
    void notifyOwnerOfNewSignup({
      email: user.email,
      method: "email",
      userId: user.id,
      username: user.username,
    })

    // Growth attribution is best-effort and should not block account creation.
    if (!isE2ERequest) {
      try {
        let growthAttributionRecorded = false
        if (referralCode) {
          const attribution = await attributeSignup(user.id, referralCode)
          if (attribution?.referrerId) {
            await recordAttribution(user.id, "referral", { sourceId: attribution.referrerId })
            growthAttributionRecorded = true
          }
        }
        if (!growthAttributionRecorded) {
          const landingInviteToken = cookieStore.get("af_landing_invite")?.value?.trim()
          if (landingInviteToken) {
            const landing = await attributeSignupFromLandingInviteToken(user.id, landingInviteToken).catch(() => null)
            if (landing?.referrerId) {
              await recordAttribution(user.id, "referral", {
                sourceId: landing.referrerId,
                metadata: { landingInvite: true },
              })
              growthAttributionRecorded = true
            }
          }
        }
        if (!growthAttributionRecorded) {
          const leagueInviteCode = cookieStore.get("af_league_invite")?.value?.trim()
          if (leagueInviteCode) {
            const joinResult = await validateLeagueJoin(leagueInviteCode).catch(() => ({ valid: false as const }))
            if (joinResult.valid) {
              await recordAttribution(user.id, "league_invite", {
                sourceId: joinResult.leagueId,
                metadata: { inviteCode: leagueInviteCode },
              })
              growthAttributionRecorded = true
            }
          }
        }
        if (!growthAttributionRecorded) {
          await recordAttribution(user.id, "organic", {})
        }
      } catch (growthErr) {
        console.warn("[register] Growth attribution failed (non-blocking):", growthErr)
      }
    }

    // Social/campaign funnel truth. Complements — does not replace — the referral
    // attribution above: that block answers "which AF user or invite brought them",
    // this answers "which social platform, campaign, and creative brought them".
    // Emitted here, after a committed account exists, so a redirect or an abandoned
    // OAuth flow can never be counted as a signup. Best-effort; never blocks the response.
    if (!isE2ERequest) {
      void recordFunnelEvent({
        event: ACQUISITION.SIGNUP_COMPLETED,
        userId: user.id,
        getCookie: (name) => cookieStore.get(name)?.value,
        meta: { auth_method: "email" },
      })
    }

    // Guest-to-account claim: if this visitor already did a no-login Sleeper
    // import, attach that LegacyUser (and all its imported leagues/history) to
    // their new account now. Centralized in claimGuestTrialForUser so email and
    // OAuth signup share one idempotent, best-effort path (AF_GATE0 §3.5). Never
    // blocks registration; the guest cookie is cleared on the response below.
    if (!isE2ERequest) {
      const guestToken = cookieStore.get(GUEST_SESSION_COOKIE_NAME)?.value
      await claimGuestTrialForUser(user.id, guestToken)
    }

    if (parsedAvatarUpload) {
      try {
        const { url } = await persistProfileImageBytes({
          bytes: parsedAvatarUpload.bytes,
          mimeType: parsedAvatarUpload.mimeType,
          originalFilename: `signup-avatar.${parsedAvatarUpload.extension}`,
        })
        await prisma.appUser.update({
          where: { id: user.id },
          data: { avatarUrl: url },
        })
      } catch (avatarErr) {
        console.warn("[register] avatar upload persistence failed (non-blocking):", avatarErr)
      }
    }

    // G15.2b — best-effort emit (never throws). Account is created at this point.
    // No PII in the payload — only the canonical user id.
    await getPlatformEvents().emit(EVENT.AUTH_REGISTERED, {
      actor: { type: "user", id: user.id },
      source: "route:auth-register",
      subjects: [{ kind: "user", id: user.id }],
      idempotencyKey: `auth.registered:${user.id}`,
      payload: { userId: user.id },
    })

    // Mirror into EarlyAccessSignup so the admin "Signups" tab surfaces every new
    // account (not just waitlist entries). `confirmedAt` flips on email verify;
    // for phone-verified accounts the verification already succeeded above so
    // we can mark it confirmed immediately. Best-effort — never blocks registration.
    try {
      const mirrorName =
        typeof displayName === "string" && displayName.trim()
          ? displayName.trim()
          : username
      const mirrorConfirmedAt = method === "PHONE" ? new Date() : null

      /*
       * ⚠ A RESERVED-DOMAIN ADDRESS NEVER ENTERS THE MARKETING LIST. This mirror
       * is why EarlyAccessSignup held 114 e2e rows out of 146 — every test that
       * registers an account wrote one, and because Vercel PREVIEW deployments
       * point at the PRODUCTION database, those were production writes. The real
       * waitlist was 32 people; the number on the dashboard was 146.
       *
       * The guard is domain reservation rather than an environment check,
       * because NODE_ENV cannot see that a preview is talking to the production
       * database. Registration itself is unaffected — the account is created,
       * the test passes, only the marketing-list mirror is skipped.
       */
      if (!isUndeliverableEmailDomain(email)) {
        await prisma.earlyAccessSignup.upsert({
          where: { email },
          create: {
            email,
            name: mirrorName,
            source: "account_signup",
            confirmedAt: mirrorConfirmedAt,
          },
          update: {
            name: mirrorName,
            // Only promote source if the row was previously a waitlist entry.
            // We intentionally DO NOT overwrite an existing confirmedAt.
          },
        })
      }
    } catch (mirrorErr) {
      console.warn("[register] EarlyAccessSignup mirror failed (non-blocking):", mirrorErr)
    }

    const registrationMetaEvent = buildMetaEventPayload(
      "CompleteRegistration",
      {
        content_name: "Account signup",
        content_category: "Registration",
        status: method === "PHONE" ? "phone_verified" : "email_pending_verification",
        verification_method: method,
      },
      { sourceId: `user:${user.id}` }
    )

    if (!isE2ERequest) {
      await trackMetaServerEvent({
        eventName: registrationMetaEvent.eventName,
        eventId: registrationMetaEvent.eventId,
        customData: registrationMetaEvent.customData,
        email,
        phone: normalizedPhone,
        userId: user.id,
        request: req,
        source: "account_registration",
      }).catch((metaErr) => {
        console.warn("[register] Meta CompleteRegistration failed (non-blocking):", metaErr)
      })
    }

    if (method === "PHONE") {
      const res = NextResponse.json({
        ok: true,
        userId: user.id,
        verificationMethod: "PHONE",
        message: "Account created. Please sign in and verify your phone number.",
        metaEvent: registrationMetaEvent,
      })
      res.cookies.delete(GUEST_SESSION_COOKIE_NAME)
      return res
    }

    let emailVerificationPrepared = false
    if (!isE2ERequest) {
      // Track the token so an undelivered one can be removed — a token whose email never went
      // out must not be left behind as usable. Only cleared when the send did not succeed.
      let createdTokenId: string | null = null
      try {
        const rawToken = makeToken(32)
        const tokenHash = sha256Hex(rawToken)
        const expiresAt = new Date(Date.now() + 1000 * 60 * 60)

        const tokenRecord = await (prisma as any).emailVerifyToken.create({
          data: { userId: user.id, tokenHash, expiresAt },
        })
        createdTokenId = tokenRecord.id

        const { getResendClient, resendSendError } = await import("@/lib/resend-client")
        const { client, fromEmail } = await getResendClient()

        // Preview-aware, spoof-safe origin: on a PREVIEW deployment this is the preview's own
        // host, so a preview-issued verification token links back to the SAME environment that
        // stored it (the isolated preview DB) instead of production, where it doesn't exist.
        // Production is unchanged — getDeploymentLinkOrigin returns the configured canonical
        // there; the USER_FACING_SITE_ORIGIN fallback covers local/unset. Never derived from a
        // request header, so an emailed link can't be pointed at an attacker host.
        const { getDeploymentLinkOrigin } = await import("@/lib/site-public-origin")
        const { USER_FACING_SITE_ORIGIN } = await import("@/lib/auth/user-facing-site-origin")
        const emailOrigin = getDeploymentLinkOrigin() || USER_FACING_SITE_ORIGIN
        // returnTo=/onboarding routes ONLY this new-signup cohort into the profile
        // setup step after they verify (they hold an auto-generated username).
        // /onboarding self-guards and bounces already-complete profiles onward, so
        // existing users and other verification flows are unaffected.
        const verifyUrl = `${emailOrigin}/verify/email?token=${encodeURIComponent(rawToken)}&returnTo=${encodeURIComponent("/onboarding")}`

        const { buildVerificationEmailHtml, resolveEmailSafeName } = await import("@/lib/email/verification-email-html")
        const safeName = resolveEmailSafeName({ username })

        const { buildEmailIdempotencyKey } = await import("@/lib/email/idempotency")

        const sendResult = await client.emails.send(
          {
            from: fromEmail || "AllFantasy.ai <noreply@allfantasy.ai>",
            to: email,
            subject: "Verify your AllFantasy.ai email",
            html: buildVerificationEmailHtml({
              title: "Verify Your Email",
              greeting: `Welcome, ${safeName}! Click the button below to verify your email address and get started.`,
              verifyUrl,
              footerNote: "If you didn't create this account, you can safely ignore this email.",
            }),
          },
          { idempotencyKey: buildEmailIdempotencyKey("email-verify", user.id, tokenRecord.id) }
        )
        // Resend resolves { data, error } WITHOUT throwing on a provider rejection, so an
        // unchecked send silently reports success. Inspect it and log the provider message
        // ONLY (never the recipient, token, or verification URL).
        const sendError = resendSendError(sendResult)
        if (sendError) {
          console.error(`[register] verification email rejected by provider: ${sendError}`)
        } else {
          emailVerificationPrepared = true
        }
      } catch (emailErr) {
        // Client/config construction or a thrown provider/network error. Non-blocking: the
        // account already exists and the user can request a fresh email. Log the message only.
        console.error(
          `[register] verification email send failed: ${emailErr instanceof Error ? emailErr.message : "unknown error"}`
        )
      }

      // Delivery did not succeed — remove the just-created token so an undelivered token is
      // never left presented as usable. Best-effort; never blocks the response. A successful
      // send keeps its token unchanged.
      if (!emailVerificationPrepared && createdTokenId) {
        await (prisma as any).emailVerifyToken.delete({ where: { id: createdTokenId } }).catch(() => {})
      }
    }

    const res = NextResponse.json({
      ok: true,
      userId: user.id,
      verificationMethod: "EMAIL",
      message: emailVerificationPrepared
        ? "Account created. Please check your email to verify."
        : "Account created. Sign in to continue verification setup.",
      emailVerificationPrepared,
      metaEvent: registrationMetaEvent,
    })
    res.cookies.delete(GUEST_SESSION_COOKIE_NAME)
    // The admission token has now been consumed by this successful signup; clear the
    // cookie so a stale copy can't be presented again. No-op when it isn't present.
    clearAdmissionCookie(res.cookies)
    return res
  } catch (err: any) {
    if (err instanceof Response) {
      return err
    }
    // P0-1 BETA-GATE: a consume failure inside the create transaction rolled the account
    // back — the invite was NOT burned. Map to a 403 with the honest reason. This is
    // reached only when the atomic consume lost a race after the pre-check passed.
    if (err instanceof BetaAdmissionConsumeError) {
      return NextResponse.json(
        { error: admissionErrorMessage(err.code), code: err.code },
        { status: 403 },
      )
    }
    if (isDatabaseUnavailableError(err)) {
      console.error("[register] database unavailable:", err)
      return NextResponse.json(
        {
          error: "Database temporarily unavailable. Please try again in a minute.",
          code: "DB_UNAVAILABLE",
        },
        { status: 503, headers: { "Retry-After": "1" } }
      )
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const target = getUniqueConstraintTarget(err)
      if (target.includes("email")) {
        return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 })
      }
      if (target.includes("username")) {
        return NextResponse.json({ error: "username already taken, choose another username" }, { status: 409 })
      }
      return NextResponse.json({ error: "An account with one of these details already exists." }, { status: 409 })
    }
    console.error("[register] error:", err)
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    )
  }
}
