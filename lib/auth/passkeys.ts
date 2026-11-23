import "server-only"

import { createHash } from "node:crypto"
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server"

import { prisma } from "@/lib/prisma"
import { PASSKEY_RP_NAME, passkeyDevice, passkeyLabel, passkeyRelyingParty } from "@/lib/auth/passkeyConfig"

/**
 * Passkeys: sign in with Face ID, Touch ID, a fingerprint or Windows Hello. The private key stays
 * on the person's device (and their iCloud / Google keychain); `auth_passkeys` holds the public
 * half. Pure config is in ./passkeyConfig; the page half is ./passkey-client.
 *
 * CHALLENGES live in the NextAuth table `auth_verification_tokens`, hashed — the same store the
 * support sign-in links use — so a challenge made on one replica can be answered on another.
 * Each is single-use (`deleteMany` must remove exactly one row) and lives 5 minutes:
 *   `passkey-reg:<userId>`  adding a passkey, signed in
 *   `passkey-signin`        signing in; nobody is known yet, so the challenge alone is the key
 *
 * Sign-in uses DISCOVERABLE passkeys (no username typed): the browser offers the passkeys it holds
 * for www.allfantasy.ai, the person picks one with Face ID, and the credential id names the row.
 * User verification is REQUIRED both ways — a passkey here must mean the face or fingerprint, not
 * merely a tap on a security key.
 */

const CHALLENGE_TTL_MS = 5 * 60 * 1000
export const MAX_PASSKEYS_PER_USER = 10
const MAX_RESPONSE_BYTES = 16_000

function hashChallenge(challenge: string): string {
  return createHash("sha256").update(challenge).digest("hex")
}

async function storeChallenge(identifier: string, challenge: string): Promise<void> {
  await prisma.authVerificationToken.create({
    data: { identifier, token: hashChallenge(challenge), expires: new Date(Date.now() + CHALLENGE_TTL_MS) },
  })
}

/** Spends a challenge. True only if it was ours, unexpired and unused — and now it is used. */
export async function consumeChallenge(identifier: string, challenge: string): Promise<boolean> {
  if (typeof challenge !== "string" || !challenge) return false
  const { count } = await prisma.authVerificationToken.deleteMany({
    where: { identifier, token: hashChallenge(challenge), expires: { gt: new Date() } },
  })
  return count === 1
}

function parseJson<T>(raw: unknown): T | null {
  if (raw && typeof raw === "object") return raw as T
  if (typeof raw !== "string" || !raw || raw.length > MAX_RESPONSE_BYTES) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export type PasskeyError = "NOT_CONFIGURED" | "NO_USER" | "TOO_MANY" | "INVALID" | "ALREADY_ADDED"

// ── Adding a passkey (signed in) ────────────────────────────────────────────────────────────

export async function startPasskeyRegistration(userId: string, requestOrigin: string | null) {
  const rp = passkeyRelyingParty(requestOrigin)
  if (!rp) return { ok: false as const, error: "NOT_CONFIGURED" as PasskeyError }

  const user = await prisma.appUser.findUnique({
    where: { id: userId },
    select: { id: true, email: true, username: true, displayName: true, passkeys: { select: { credentialId: true, transports: true } } },
  })
  if (!user) return { ok: false as const, error: "NO_USER" as PasskeyError }
  if (user.passkeys.length >= MAX_PASSKEYS_PER_USER) return { ok: false as const, error: "TOO_MANY" as PasskeyError }

  const options = await generateRegistrationOptions({
    rpName: PASSKEY_RP_NAME,
    rpID: rp.rpID,
    userID: new TextEncoder().encode(user.id),
    // What the phone shows in its passkey list: the sign-in they would type.
    userName: user.email || user.username,
    userDisplayName: user.displayName || user.username,
    attestationType: "none",
    excludeCredentials: user.passkeys.map((p) => ({ id: p.credentialId, transports: p.transports })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  })

  const identifier = `passkey-reg:${user.id}`
  await prisma.authVerificationToken.deleteMany({ where: { identifier } })
  await storeChallenge(identifier, options.challenge)
  return { ok: true as const, options }
}

export async function finishPasskeyRegistration(
  userId: string,
  rawResponse: unknown,
  requestOrigin: string | null,
  userAgent: string | null
) {
  const rp = passkeyRelyingParty(requestOrigin)
  if (!rp) return { ok: false as const, error: "NOT_CONFIGURED" as PasskeyError }
  const response = parseJson<RegistrationResponseJSON>(rawResponse)
  if (!response || typeof response.id !== "string") return { ok: false as const, error: "INVALID" as PasskeyError }

  const identifier = `passkey-reg:${userId}`
  let verification
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: (challenge) => consumeChallenge(identifier, challenge),
      expectedOrigin: rp.origins,
      expectedRPID: rp.rpID,
      requireUserVerification: true,
    })
  } catch {
    return { ok: false as const, error: "INVALID" as PasskeyError }
  }
  if (!verification.verified) return { ok: false as const, error: "INVALID" as PasskeyError }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo
  const label = passkeyLabel(passkeyDevice(userAgent))
  try {
    const row = await prisma.authPasskey.create({
      data: {
        userId,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey),
        counter: BigInt(credential.counter),
        transports: credential.transports ?? [],
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
        label,
      },
      select: { id: true, label: true },
    })
    return { ok: true as const, passkey: row }
  } catch (error) {
    if ((error as { code?: string })?.code === "P2002") return { ok: false as const, error: "ALREADY_ADDED" as PasskeyError }
    throw error
  }
}

// ── Signing in ──────────────────────────────────────────────────────────────────────────────

const SIGNIN_IDENTIFIER = "passkey-signin"

export async function startPasskeySignIn(requestOrigin: string | null) {
  const rp = passkeyRelyingParty(requestOrigin)
  if (!rp) return { ok: false as const, error: "NOT_CONFIGURED" as PasskeyError }
  // Unanswered sign-in challenges pile up (someone opens the sheet and cancels); sweep the dead ones.
  await prisma.authVerificationToken.deleteMany({ where: { identifier: SIGNIN_IDENTIFIER, expires: { lt: new Date() } } })
  const options = await generateAuthenticationOptions({ rpID: rp.rpID, userVerification: "required" })
  await storeChallenge(SIGNIN_IDENTIFIER, options.challenge)
  return { ok: true as const, options }
}

/**
 * The `passkey` next-auth provider. Returns the user to sign in, or null for anything that does
 * not check out — an unknown passkey, a spent or foreign challenge, a bad signature, a page on
 * another origin. Throws ACCOUNT_SUSPENDED like the other providers.
 */
export async function authorizePasskey(rawResponse: unknown, requestOrigin: string | null) {
  const rp = passkeyRelyingParty(requestOrigin)
  if (!rp) return null
  const response = parseJson<AuthenticationResponseJSON>(rawResponse)
  if (!response || typeof response.id !== "string" || !response.id) return null

  const passkey = await prisma.authPasskey.findUnique({
    where: { credentialId: response.id },
    select: {
      id: true,
      credentialId: true,
      publicKey: true,
      counter: true,
      transports: true,
      user: { select: { id: true, email: true, username: true, displayName: true, avatarUrl: true } },
    },
  })
  if (!passkey) return null

  let verification
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: (challenge) => consumeChallenge(SIGNIN_IDENTIFIER, challenge),
      expectedOrigin: rp.origins,
      expectedRPID: rp.rpID,
      credential: {
        id: passkey.credentialId,
        publicKey: new Uint8Array(passkey.publicKey),
        counter: Number(passkey.counter),
        transports: passkey.transports,
      },
      requireUserVerification: true,
    })
  } catch {
    return null
  }
  if (!verification.verified) return null

  await prisma.authPasskey.update({
    where: { id: passkey.id },
    data: { counter: BigInt(verification.authenticationInfo.newCounter), lastUsedAt: new Date() },
  })

  const { activeAccountRestriction, ACCOUNT_SUSPENDED_ERROR } = await import("@/lib/moderation/accountSuspension")
  if (await activeAccountRestriction(passkey.user.id)) throw new Error(ACCOUNT_SUSPENDED_ERROR)

  const user = passkey.user
  return {
    id: user.id,
    email: user.email,
    name: user.displayName || user.username || user.email,
    username: user.username,
    image: user.avatarUrl,
  }
}

// ── Settings ────────────────────────────────────────────────────────────────────────────────

export async function listPasskeys(userId: string) {
  return prisma.authPasskey.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { id: true, label: true, createdAt: true, lastUsedAt: true, backedUp: true },
  })
}

/** Removes one of THIS user's passkeys. True if it existed. */
export async function removePasskey(userId: string, passkeyId: string): Promise<boolean> {
  const { count } = await prisma.authPasskey.deleteMany({ where: { id: passkeyId, userId } })
  return count === 1
}
