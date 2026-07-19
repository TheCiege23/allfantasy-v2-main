import crypto from "crypto"

import { prisma } from "@/lib/prisma"

/**
 * Per-admin API tokens for bearer-authenticated admin calls.
 *
 * The shared `ADMIN_PASSWORD` bearer path proves only that the caller knew a secret —
 * it cannot say who acted, cannot be rotated for one person, and cannot be revoked
 * without cutting off every caller at once. These tokens carry an owner instead.
 *
 * A token never grants more than its owner. Authority is deliberately NOT stored on
 * the row: the owner is re-checked against the admin allowlist on every use (see
 * `isOwnerStillAdmin` below), so an owner losing admin access revokes their tokens
 * implicitly.
 *
 * The raw token is returned exactly once, by `issueAdminApiToken`. Only its sha256 is
 * persisted. Treat raw values like passwords — never log them, never put them in an
 * error message, never re-display them.
 */

/** Prefix on every raw token, so leaked values are greppable and secret-scannable. */
export const ADMIN_API_TOKEN_PREFIX = "afadm_"

/** Bytes of entropy in a token. 32 bytes = 256 bits — not brute-forceable. */
const TOKEN_ENTROPY_BYTES = 32

export type AdminApiTokenOwner = {
  tokenId: string
  label: string
  ownerEmail: string
  ownerUserId: string | null
}

export type AdminApiTokenSummary = {
  id: string
  label: string
  ownerEmail: string
  ownerUserId: string | null
  createdByEmail: string | null
  createdAt: Date
  lastUsedAt: Date | null
  revokedAt: Date | null
  revokedByEmail: string | null
}

/**
 * sha256, lowercase hex. Deliberately NOT bcrypt/argon: these are 256-bit random
 * tokens, not user-chosen passwords, so there is no dictionary to slow down — and a
 * per-request KDF cost would be paid on every admin API call. The security comes from
 * the entropy, not from the hash being slow.
 */
export function hashAdminApiToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken, "utf8").digest("hex")
}

/** Generate a new raw token. The caller must show this once and then discard it. */
export function generateAdminApiToken(): string {
  return ADMIN_API_TOKEN_PREFIX + crypto.randomBytes(TOKEN_ENTROPY_BYTES).toString("base64url")
}

/** Pull the bearer value out of an Authorization header, if present. */
export function extractBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization")
  if (!header?.startsWith("Bearer ")) return null
  const value = header.slice(7).trim()
  return value || null
}

/**
 * Look up a presented raw token and return its owner, or null.
 *
 * Returns null when the token is unknown, revoked, or its owner is no longer an admin.
 * On success, `lastUsedAt` is refreshed — that timestamp plus the owner is the audit
 * signal this whole table exists to provide, so a failure to record it is logged but
 * never fails the request (the caller is legitimately authenticated either way).
 *
 * @param isOwnerStillAdmin Authority check, supplied by the caller. It lives in
 *   lib/adminAuth.ts, which imports this module — taking it as a parameter keeps the
 *   dependency one-directional and makes the re-check impossible to forget silently.
 */
export async function resolveAdminApiToken(
  rawToken: string,
  isOwnerStillAdmin: (ownerEmail: string) => boolean,
): Promise<AdminApiTokenOwner | null> {
  if (!rawToken) return null

  const tokenHash = hashAdminApiToken(rawToken)

  const record = await prisma.adminApiToken.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      label: true,
      ownerEmail: true,
      ownerUserId: true,
      revokedAt: true,
    },
  })

  if (!record) return null
  if (record.revokedAt) return null
  if (!isOwnerStillAdmin(record.ownerEmail)) return null

  try {
    await prisma.adminApiToken.update({
      where: { id: record.id },
      data: { lastUsedAt: new Date() },
    })
  } catch (e) {
    console.error("[admin-api-token] failed to record lastUsedAt:", e)
  }

  return {
    tokenId: record.id,
    label: record.label,
    ownerEmail: record.ownerEmail,
    ownerUserId: record.ownerUserId,
  }
}

/**
 * Create a token for an admin. Returns the raw value — the ONLY time it exists in a
 * readable form. The caller must surface it once and must not persist or log it.
 *
 * Callers are responsible for gating this behind `requireAdmin()` (never bearer auth,
 * or a token could mint tokens) and for confirming `ownerEmail` is already an admin.
 */
export async function issueAdminApiToken(input: {
  label: string
  ownerEmail: string
  ownerUserId?: string | null
  createdByEmail?: string | null
}): Promise<{ rawToken: string; token: AdminApiTokenSummary }> {
  const rawToken = generateAdminApiToken()

  const created = await prisma.adminApiToken.create({
    data: {
      label: input.label.trim().slice(0, 120),
      tokenHash: hashAdminApiToken(rawToken),
      ownerEmail: input.ownerEmail.trim().toLowerCase(),
      ownerUserId: input.ownerUserId ?? null,
      createdByEmail: input.createdByEmail?.trim().toLowerCase() ?? null,
    },
  })

  return { rawToken, token: toSummary(created) }
}

/** Revoke a token. The row is kept — revocation keeps its timestamp for the audit trail. */
export async function revokeAdminApiToken(
  tokenId: string,
  revokedByEmail: string | null,
): Promise<AdminApiTokenSummary | null> {
  const existing = await prisma.adminApiToken.findUnique({ where: { id: tokenId } })
  if (!existing) return null
  if (existing.revokedAt) return toSummary(existing)

  const updated = await prisma.adminApiToken.update({
    where: { id: tokenId },
    data: {
      revokedAt: new Date(),
      revokedByEmail: revokedByEmail?.trim().toLowerCase() ?? null,
    },
  })

  return toSummary(updated)
}

/** List tokens for the admin UI. Never returns a hash or anything token-recoverable. */
export async function listAdminApiTokens(): Promise<AdminApiTokenSummary[]> {
  const rows = await prisma.adminApiToken.findMany({
    orderBy: [{ revokedAt: "asc" }, { createdAt: "desc" }],
    take: 200,
  })
  return rows.map(toSummary)
}

function toSummary(row: {
  id: string
  label: string
  ownerEmail: string
  ownerUserId: string | null
  createdByEmail: string | null
  createdAt: Date
  lastUsedAt: Date | null
  revokedAt: Date | null
  revokedByEmail: string | null
}): AdminApiTokenSummary {
  return {
    id: row.id,
    label: row.label,
    ownerEmail: row.ownerEmail,
    ownerUserId: row.ownerUserId,
    createdByEmail: row.createdByEmail,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
    revokedByEmail: row.revokedByEmail,
  }
}
