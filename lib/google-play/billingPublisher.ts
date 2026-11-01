import "server-only"
import { importPKCS8, SignJWT } from "jose"
import { PLAY_PACKAGE } from "./billingCatalog"
import { playServiceAccount, PlayBillingError } from "./billingConfig"

const API = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PLAY_PACKAGE}`
let cached: { token: string; expires: number; email: string } | undefined
export async function playAccessToken() {
  const account = playServiceAccount()
  if (cached && cached.email === account.email && cached.expires > Date.now() + 60_000) return cached.token
  const key = await importPKCS8(account.key, "RS256")
  const assertion = await new SignJWT({ scope: "https://www.googleapis.com/auth/androidpublisher" })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" }).setIssuer(account.email)
    .setAudience("https://oauth2.googleapis.com/token").setIssuedAt().setExpirationTime("1h").sign(key)
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", cache: "no-store",
    headers: { "content-type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(15_000),
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }) })
  if (!r.ok) throw new PlayBillingError("Google Play authentication is temporarily unavailable.", 502)
  const b = await r.json() as { access_token?: string; expires_in?: number }
  if (!b.access_token) throw new PlayBillingError("Google Play authentication is temporarily unavailable.", 502)
  cached = { token: b.access_token, expires: Date.now() + (b.expires_in || 3600) * 1000, email: account.email }
  return cached.token
}
export async function publisherRequest(path: string, method: "GET" | "POST" = "GET", body?: object): Promise<unknown> {
  const r = await fetch(`${API}/${path}`, { method, cache: "no-store", signal: AbortSignal.timeout(15_000),
    headers: { authorization: `Bearer ${await playAccessToken()}`, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}) })
  // Never log provider bodies or request URLs: both may contain purchase tokens.
  if (!r.ok) {
    const failure = await r.json().catch(() => ({})) as { error?: { status?: unknown; details?: Array<{ reason?: unknown }> } }
    const candidate = failure.error?.details?.find(d => typeof d.reason === "string")?.reason ?? failure.error?.status
    const reason = typeof candidate === "string" && /^[A-Z_]{1,80}$/.test(candidate) ? candidate : undefined
    throw new PlayBillingError(r.status === 404 || r.status === 410 ? "Google Play receipt was not found." : "Google Play verification is temporarily unavailable.", r.status === 404 || r.status === 410 ? 400 : 502, r.status, reason)
  }
  return r.status === 204 ? {} : r.json().catch(() => ({}))
}
export const googlePlayPublisher = {
  get: (type: "subscription" | "token_pack", token: string) => publisherRequest(type === "subscription"
    ? `purchases/subscriptionsv2/tokens/${encodeURIComponent(token)}` : `purchases/productsv2/tokens/${encodeURIComponent(token)}`),
  cancel: (token: string) => publisherRequest(`purchases/subscriptionsv2/tokens/${encodeURIComponent(token)}:cancel`, "POST", { cancellationContext: { cancellationType: "DEVELOPER_REQUESTED_STOP_PAYMENTS" } }),
  finish: (type: "subscription" | "token_pack", product: string, token: string) => publisherRequest(
    `purchases/${type === "subscription" ? "subscriptions" : "products"}/${encodeURIComponent(product)}/tokens/${encodeURIComponent(token)}:${type === "subscription" ? "acknowledge" : "consume"}`, "POST", {}),
}
export type PlayPublisher = Pick<typeof googlePlayPublisher, "get" | "finish">
