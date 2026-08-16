/**
 * P0-1 BETA-GATE — centralized closed-beta account admission.
 *
 * ONE server-only service that every real account-creation path routes through:
 *   - credentials register        (app/api/auth/register/route.ts)
 *   - OAuth new-user create        (lib/auth/SocialAccountLinkingService.ts)
 *   - Sleeper-username new account  (lib/auth.ts credentials provider id:"sleeper")
 *
 * It does NOT touch existing-user sign-in or account-linking — those never consume an
 * invite. It is deliberately transport-agnostic: callers read the token (from the request
 * body or the admission cookie) and the email (from the body / OAuth profile) and pass
 * them in; this module owns the policy, never the plumbing.
 *
 * SECURITY:
 *  - The raw token is NEVER stored or logged — only its sha256 digest is persisted.
 *  - Single-use is enforced by an atomic conditional update (`updateMany where status =
 *    'pending'`), so two concurrent redemptions cannot both win, without a table lock.
 *  - There is no public "is this email invited?" lookup — enumeration is impossible here.
 *  - Fails CLOSED: when invite-only is enabled and the gate cannot be evaluated (DB error,
 *    malformed config in production), admission is REFUSED, never granted.
 */
import "server-only"
import crypto from "crypto"

import type { Prisma, PrismaClient } from "@prisma/client"
import { prisma } from "@/lib/prisma"

/** A Prisma client or an interactive-transaction client — so consume can run inside a caller's tx. */
export type PrismaLike = PrismaClient | Prisma.TransactionClient

/** Stable, caller-safe error codes. Never leak whether a *specific* email was invited. */
export type AdmissionErrorCode =
  | "INVITE_REQUIRED" // invite-only on, no token presented
  | "INVITE_MALFORMED" // token present but not a well-formed token
  | "INVITE_NOT_FOUND" // no invite matches the digest
  | "INVITE_EXPIRED"
  | "INVITE_REVOKED"
  | "INVITE_REDEEMED"
  | "INVITE_EMAIL_MISMATCH"
  | "GATE_UNAVAILABLE" // enabled but could not evaluate → fail closed

export type AdmissionResult =
  | { ok: true; inviteId: string }
  | { ok: false; code: AdmissionErrorCode }

/**
 * Honest, non-enumerating user-facing copy for each failure. A mismatch reveals only that
 * THIS token was issued for a different email — which the token holder already knows — so
 * it is not an oracle for arbitrary addresses.
 */
export function admissionErrorMessage(code: AdmissionErrorCode): string {
  switch (code) {
    case "INVITE_REQUIRED":
      return "AllFantasy is in a closed beta — you need an invitation to create an account."
    case "INVITE_MALFORMED":
    case "INVITE_NOT_FOUND":
      return "This invitation link isn't valid."
    case "INVITE_EXPIRED":
      return "This invitation has expired. Ask your inviter for a new one."
    case "INVITE_REVOKED":
      return "This invitation is no longer active."
    case "INVITE_REDEEMED":
      return "This invitation has already been used."
    case "INVITE_EMAIL_MISMATCH":
      return "This invitation was issued for a different email address."
    case "GATE_UNAVAILABLE":
      return "We couldn't verify your invitation right now. Please try again in a moment."
  }
}

/**
 * SIGNUP IS OPEN. Closed beta is over — anyone can create an account, no invitation.
 *
 * This constant is the authority, NOT the environment. `INVITE_ONLY` is deliberately no
 * longer read: the flag is set in deployed environments that the repo cannot see or edit,
 * and a stale value left behind there must never be able to silently re-close public
 * signup. Config drift closing the front door is exactly the failure this replaces.
 *
 * The gate itself is intact, not deleted. Every account-creation path still routes through
 * `isInviteOnlyEnabled()`, and the invite machinery (issue/revoke/validate/consume, admin
 * panel, admission cookie) is untouched — so running another closed beta is a one-line
 * change here, not a re-implementation.
 */
const CLOSED_BETA_ENABLED = false

/**
 * Is closed-beta invite-only mode on? Always false while signup is open.
 *
 * Keeps its `env` parameter so callers and tests are unchanged, and so a future closed
 * beta can go back to reading a flag without touching a single call site.
 */
export function isInviteOnlyEnabled(_env: NodeJS.ProcessEnv = process.env): boolean {
  return CLOSED_BETA_ENABLED
}

export function normalizeEmail(email: string | null | undefined): string {
  return String(email ?? "").trim().toLowerCase()
}

/** Trim only — the raw token's own alphabet is preserved so the digest matches exactly. */
export function normalizeToken(token: string | null | undefined): string {
  return String(token ?? "").trim()
}

export function hashToken(rawToken: string): string {
  return crypto.createHash("sha256").update(normalizeToken(rawToken)).digest("hex")
}

/** Base64url token; 32 bytes → ~43 chars, unguessable. Raw is returned to the admin ONCE. */
export function generateRawToken(): string {
  return crypto.randomBytes(32).toString("base64url")
}

/** Cheap structural check so an obviously-junk token fails fast without a DB hit. */
export function isWellFormedToken(rawToken: string): boolean {
  const t = normalizeToken(rawToken)
  return t.length >= 20 && t.length <= 200 && /^[A-Za-z0-9_-]+$/.test(t)
}

type StoredInvite = {
  id: string
  invitedEmail: string
  status: string
  expiresAt: Date | null
}

function evaluateInvite(
  invite: StoredInvite | null,
  expectedEmail: string | null,
  now: Date,
): AdmissionResult {
  if (!invite) return { ok: false, code: "INVITE_NOT_FOUND" }
  if (invite.status === "revoked") return { ok: false, code: "INVITE_REVOKED" }
  if (invite.status === "redeemed") return { ok: false, code: "INVITE_REDEEMED" }
  if (invite.expiresAt && invite.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, code: "INVITE_EXPIRED" }
  }
  // EMAIL-BOUND POLICY (P0-1): every ordinary invite is bound to a normalized email, and the
  // signup MUST present a matching email. Token possession alone is never sufficient — an
  // invite is not a transferable general-access code. All three failures below (invite with
  // no email, caller with no email, non-matching email) return the SAME code so no response
  // reveals whether a particular address was invited.
  if (!invite.invitedEmail) return { ok: false, code: "INVITE_EMAIL_MISMATCH" }
  if (!expectedEmail) return { ok: false, code: "INVITE_EMAIL_MISMATCH" }
  if (normalizeEmail(expectedEmail) !== invite.invitedEmail) {
    return { ok: false, code: "INVITE_EMAIL_MISMATCH" }
  }
  return { ok: true, inviteId: invite.id }
}

/**
 * Non-consuming pre-check. Use this to fail fast and return an honest error BEFORE doing
 * expensive/irreversible account-creation work. Authority still rests with `consumeAdmission`,
 * which re-checks atomically, so the TOCTOU window between validate and consume is harmless.
 *
 * Throws only on the fail-closed path (DB unavailable) — callers must treat a throw as refusal.
 */
export async function validateAdmission(input: {
  rawToken: string | null
  email: string | null
  now?: Date
  db?: PrismaLike
}): Promise<AdmissionResult> {
  const token = normalizeToken(input.rawToken)
  if (!token) return { ok: false, code: "INVITE_REQUIRED" }
  if (!isWellFormedToken(token)) return { ok: false, code: "INVITE_MALFORMED" }

  const db = input.db ?? prisma
  const now = input.now ?? new Date()
  const invite = await db.betaInvite.findUnique({
    where: { tokenDigest: hashToken(token) },
    select: { id: true, invitedEmail: true, status: true, expiresAt: true },
  })
  return evaluateInvite(invite, input.email, now)
}

/**
 * Atomically consume the invite as part of a successful account creation.
 *
 * MUST be called inside the same transaction that creates the AppUser (`db` = tx client),
 * so that a failed account creation rolls the redemption back and leaves the invite usable.
 *
 * Single-use is guaranteed by the conditional `updateMany where status='pending'`: exactly
 * one concurrent caller sees count===1; the loser re-reads to return the precise reason.
 * Never logs the token.
 */
export async function consumeAdmission(input: {
  rawToken: string | null
  email: string | null
  userId: string
  now?: Date
  db: PrismaLike
}): Promise<AdmissionResult> {
  const token = normalizeToken(input.rawToken)
  if (!token) return { ok: false, code: "INVITE_REQUIRED" }
  if (!isWellFormedToken(token)) return { ok: false, code: "INVITE_MALFORMED" }

  const now = input.now ?? new Date()
  const digest = hashToken(token)

  // Re-check first so we can return the specific reason (expired/revoked/mismatch) rather
  // than a generic failure when the atomic update matches zero rows.
  const invite = await input.db.betaInvite.findUnique({
    where: { tokenDigest: digest },
    select: { id: true, invitedEmail: true, status: true, expiresAt: true },
  })
  const evaluation = evaluateInvite(invite, input.email, now)
  if (!evaluation.ok) return evaluation

  const updated = await input.db.betaInvite.updateMany({
    where: { tokenDigest: digest, status: "pending" },
    data: { status: "redeemed", redeemedAt: now, redeemedByUserId: input.userId },
  })

  if (updated.count !== 1) {
    // Lost the race: another creation consumed it between the read and the update.
    return { ok: false, code: "INVITE_REDEEMED" }
  }
  return { ok: true, inviteId: evaluation.inviteId }
}

// ── Admin operations ────────────────────────────────────────────────────────────────
// Callers MUST have already passed requireAdmin(). These functions do not re-check auth.

export type IssuedInvite = {
  id: string
  invitedEmail: string
  /** Returned exactly ONCE, here. Never stored, never returned again. */
  rawToken: string
  expiresAt: Date | null
}

export async function issueInvite(input: {
  email: string
  adminId: string
  expiresAt?: Date | null
  note?: string | null
  db?: PrismaLike
}): Promise<IssuedInvite> {
  const db = input.db ?? prisma
  const invitedEmail = normalizeEmail(input.email)
  // Email-bound policy: an invite with no email could never be admitted (evaluateInvite
  // rejects a blank invitedEmail), so refuse to mint one rather than create dead records.
  if (!invitedEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(invitedEmail)) {
    throw new Error("BETA_INVITE_EMAIL_REQUIRED")
  }
  const rawToken = generateRawToken()

  const created = await db.betaInvite.create({
    data: {
      tokenDigest: hashToken(rawToken),
      invitedEmail,
      status: "pending",
      note: input.note?.slice(0, 200) ?? null,
      createdByAdmin: input.adminId,
      expiresAt: input.expiresAt ?? null,
    },
    select: { id: true, invitedEmail: true, expiresAt: true },
  })

  return { id: created.id, invitedEmail: created.invitedEmail, rawToken, expiresAt: created.expiresAt }
}

export async function revokeInvite(input: {
  id: string
  adminId: string
  now?: Date
  db?: PrismaLike
}): Promise<{ ok: boolean; reason?: "not_found" | "already_redeemed" }> {
  const db = input.db ?? prisma
  const now = input.now ?? new Date()
  // Only a still-pending invite can be revoked; a redeemed one is history and stays intact.
  const updated = await db.betaInvite.updateMany({
    where: { id: input.id, status: "pending" },
    data: { status: "revoked", revokedAt: now, revokedBy: input.adminId },
  })
  if (updated.count === 1) return { ok: true }

  const exists = await db.betaInvite.findUnique({ where: { id: input.id }, select: { status: true } })
  if (!exists) return { ok: false, reason: "not_found" }
  return { ok: false, reason: "already_redeemed" }
}

/** Admin listing — token digests are never returned as usable secrets. */
export async function listInvites(input?: { limit?: number; db?: PrismaLike }) {
  const db = input?.db ?? prisma
  const rows = await db.betaInvite.findMany({
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(input?.limit ?? 100, 1), 500),
    select: {
      id: true,
      invitedEmail: true,
      status: true,
      note: true,
      createdByAdmin: true,
      createdAt: true,
      expiresAt: true,
      revokedAt: true,
      redeemedAt: true,
      redeemedByUserId: true,
    },
  })
  return rows
}
