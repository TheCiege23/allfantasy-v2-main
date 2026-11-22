/**
 * Sign in with a text code: the person types their phone number, Twilio Verify texts a
 * 6-digit code, and the code signs them in. No password.
 *
 * 🛑 ONLY A VERIFIED NUMBER IS A WAY IN. `UserProfile.phone` can hold a number nobody has
 * proven (a typo saved in settings, an unverified signup). If a code sent to that number
 * signed into the account, whoever owns the number would own the account. So the lookup
 * requires `phoneVerifiedAt`, set only after a code was checked for that exact number
 * (`/api/verify/phone/check`, or a PHONE-method registration).
 *
 * ⚠ THE START STEP NEVER SAYS WHETHER A NUMBER HAS AN ACCOUNT. It answers `sent` the same
 * way for a known and an unknown number, and it only texts a number that matches a
 * verified account — an unknown number costs nothing and reveals nothing.
 *
 * Every number goes through `normalizePhoneE164`, the one normalizer the stored key is
 * written with (see lib/phone/e164.ts for why a second one is a bug).
 */
import { prisma } from '@/lib/prisma'
import { normalizePhoneE164, isValidPhoneE164 } from '@/lib/phone/e164'
import { clearSharedRateLimit, consumeSharedRateLimit } from '@/lib/security/sharedRateLimit'
import { maskPhonesInText } from '@/lib/sms/maskPhone'
import { activeAccountRestriction, ACCOUNT_SUSPENDED_ERROR } from '@/lib/moderation/accountSuspension'

export type PhoneCodeAccount = {
  id: string
  /** Null for a phone-only account. */
  email: string | null
  displayName: string | null
  username: string
  avatarUrl: string | null
}

/** The account whose VERIFIED phone is exactly this E.164 number, or null. */
export async function findVerifiedPhoneAccount(phoneE164: string): Promise<PhoneCodeAccount | null> {
  const profile = await prisma.userProfile
    .findUnique({ where: { phone: phoneE164 }, select: { userId: true, phoneVerifiedAt: true } })
    .catch(() => null)
  if (!profile?.phoneVerifiedAt) return null
  return prisma.appUser.findUnique({
    where: { id: profile.userId },
    select: { id: true, email: true, displayName: true, username: true, avatarUrl: true },
  })
}

type VerifyService = {
  verifications: { create(input: { to: string; channel: 'sms' }): Promise<unknown> }
  verificationChecks: { create(input: { to: string; code: string }): Promise<{ status?: string }> }
}

async function verifyService(): Promise<VerifyService | null> {
  const verifySid = process.env.TWILIO_VERIFY_SERVICE_SID
  if (!verifySid) return null
  const { getTwilioClient } = await import('@/lib/twilio-client')
  const client = await getTwilioClient()
  return client.verify.v2.services(verifySid) as unknown as VerifyService
}

export type StartResult =
  | { ok: true }
  | { ok: false; error: 'INVALID_PHONE' | 'PHONE_VERIFY_NOT_CONFIGURED' | 'SEND_FAILED' }

/**
 * Text a sign-in code if — and only if — the number belongs to a verified account.
 * Rate limits are the caller's job (the route knows the IP).
 */
export async function startPhoneCodeSignIn(rawPhone: string): Promise<StartResult> {
  const phone = normalizePhoneE164(rawPhone)
  if (!isValidPhoneE164(phone)) return { ok: false, error: 'INVALID_PHONE' }

  const service = await verifyService()
  if (!service) return { ok: false, error: 'PHONE_VERIFY_NOT_CONFIGURED' }

  const account = await findVerifiedPhoneAccount(phone)
  if (!account) return { ok: true }

  try {
    await service.verifications.create({ to: phone, channel: 'sms' })
    return { ok: true }
  } catch (err) {
    // Masked: Twilio's error messages quote the full number.
    console.error('[auth/phone-code] send failed:', maskPhonesInText(String((err as Error)?.message ?? err)))
    return { ok: false, error: 'SEND_FAILED' }
  }
}

/**
 * The `phone-code` credentials provider's authorize step. Returns the next-auth user, or
 * null for anything that is not a correct code for a verified number — a wrong code, an
 * expired one, an unknown number and a spent guess budget all look the same.
 */
export async function authorizePhoneCode(rawPhone: unknown, rawCode: unknown) {
  const phone = normalizePhoneE164(String(rawPhone ?? ''))
  const code = String(rawCode ?? '').replace(/\s/g, '')
  if (!isValidPhoneE164(phone) || !/^\d{4,10}$/.test(code)) return null

  // ⚠ PER-NUMBER GUESS BUDGET, shared across processes and spent BEFORE the check, the
  // same shape as the password provider's per-account budget. Twilio also caps attempts
  // per verification; this stops a fresh code being requested and ground indefinitely.
  const budgetKey = `signin-phone-code:${phone}`
  const budget = await consumeSharedRateLimit(budgetKey, 8, 15 * 60)
  if (!budget.success) return null

  const account = await findVerifiedPhoneAccount(phone)
  if (!account) return null

  const service = await verifyService()
  if (!service) return null

  let approved = false
  try {
    const check = await service.verificationChecks.create({ to: phone, code })
    approved = check?.status === 'approved'
  } catch {
    // Twilio answers 404 when there is no pending code (expired, already used, never sent).
    approved = false
  }
  if (!approved) return null
  await clearSharedRateLimit(budgetKey).catch(() => undefined)

  if (await activeAccountRestriction(account.id)) {
    throw new Error(ACCOUNT_SUSPENDED_ERROR)
  }

  return {
    id: account.id,
    email: account.email,
    name: account.displayName || account.username || account.email,
    username: account.username,
    image: account.avatarUrl,
  }
}
