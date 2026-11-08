import "server-only"
import { createHmac, timingSafeEqual } from "node:crypto"
import { resolveAuthSecret } from "@/lib/auth/resolve-auth-secret"

/** Versioned, domain-separated invite. Rotating the auth secret invalidates old links. */
export function cfpInviteCode(challengeId: string, secret = resolveAuthSecret()): string {
  if (!secret) throw new Error("Secure CFP invitations are unavailable until authentication is configured.")
  if (!/^[a-z0-9]{1,64}$/i.test(challengeId)) throw new Error("Invalid CFP pool identifier.")
  const id = challengeId.toLowerCase()
  const mac = createHmac("sha256", secret).update(`allfantasy:cfp-invite:v1:${id}`).digest("hex").slice(0, 32)
  return `CFP1${id}${mac}`.toUpperCase()
}

export function cfpInviteChallengeId(value: unknown): string | null {
  if (typeof value !== "string") return null
  const match = /^CFP1([A-Z0-9]{1,64})([A-F0-9]{32})$/i.exec(value.trim())
  return match ? match[1].toLowerCase() : null
}

export function verifyCfpInvite(challengeId: string, value: unknown, secret = resolveAuthSecret()): boolean {
  if (!secret || typeof value !== "string") return false
  if (cfpInviteChallengeId(value) !== challengeId.toLowerCase()) return false
  const expected = Buffer.from(cfpInviteCode(challengeId, secret), "utf8")
  const actual = Buffer.from(value.trim().toUpperCase(), "utf8")
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export function isPrivateCfpPool(sport: unknown, config: unknown): boolean {
  const visibility = (config && typeof config === "object" ? (config as { visibility?: unknown }).visibility : null) ?? "private"
  return sport === "ncaaf" && visibility !== "public"
}
