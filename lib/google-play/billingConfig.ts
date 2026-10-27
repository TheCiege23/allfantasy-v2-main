import "server-only"
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"
import { PLAY_PACKAGE } from "./billingCatalog"

export class PlayBillingError extends Error {
  constructor(message: string, readonly status = 400) { super(message) }
}
export function playServiceAccount() {
  const raw = (process.env.GOOGLE_PLAY_BILLING_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON)?.trim()
  try {
    const value = JSON.parse(raw?.startsWith("{") ? raw : Buffer.from(raw || "", "base64").toString("utf8"))
    if (typeof value.client_email !== "string" || typeof value.private_key !== "string") throw new Error()
    return { email: value.client_email as string, key: (value.private_key as string).replace(/\\n/g, "\n") }
  } catch { throw new PlayBillingError("Google Play billing is not configured.", 503) }
}
function encryptionKey() {
  const key = process.env.GOOGLE_PLAY_PURCHASE_ENCRYPTION_KEY?.trim() || ""
  if (!/^[a-f0-9]{64}$/i.test(key)) throw new PlayBillingError("Google Play receipt protection is not configured.", 503)
  return Buffer.from(key, "hex")
}
export function playServerConfigured() {
  try { playServiceAccount(); encryptionKey(); return true } catch { return false }
}
export function playCheckoutEnabled(userId?: string) {
  const testers = (process.env.GOOGLE_PLAY_BILLING_TEST_USER_IDS || "").split(",").map(id => id.trim()).filter(Boolean)
  return playServerConfigured() && (process.env.GOOGLE_PLAY_BILLING_ENABLED === "true" || Boolean(userId && testers.includes(userId))) &&
    process.env.GOOGLE_PLAY_CATALOG_READY === "true" && Boolean(process.env.GOOGLE_PLAY_RTDN_AUDIENCE?.trim()) &&
    Boolean(process.env.GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL?.trim()) && Boolean(process.env.GOOGLE_PLAY_PUBSUB_SUBSCRIPTION?.trim())
}
export function purchaseHash(token: string) {
  return createHash("sha256").update(`${PLAY_PACKAGE}\0${token}`).digest("hex")
}
export function obfuscatedPlayAccountId(userId: string) {
  return createHash("sha256").update(`allfantasy:play:${userId}`).digest("hex")
}
export function encryptPurchaseToken(token: string) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv)
  cipher.setAAD(Buffer.from(PLAY_PACKAGE))
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()])
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".")
}
export function decryptPurchaseToken(value: string) {
  const [version, iv, tag, ciphertext] = value.split(".")
  if (version !== "v1" || !iv || !tag || !ciphertext) throw new PlayBillingError("Invalid stored receipt.", 503)
  const cipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"))
  cipher.setAAD(Buffer.from(PLAY_PACKAGE)); cipher.setAuthTag(Buffer.from(tag, "base64url"))
  return Buffer.concat([cipher.update(Buffer.from(ciphertext, "base64url")), cipher.final()]).toString("utf8")
}
export function validatePurchaseToken(value: unknown): string {
  if (typeof value !== "string" || value.length < 10 || value.length > 4096 || /\s/.test(value)) {
    throw new PlayBillingError("Invalid Google Play purchase receipt.")
  }
  return value
}
