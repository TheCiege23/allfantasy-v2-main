/**
 * Apple Push Notification service (APNs) — native push to the iOS app.
 *
 * The iOS app (ios-app/, Capacitor) registers its device token through
 * /api/push/ios, which stores it in the SAME table as web push
 * (web_push_subscriptions) with endpoint `apns:<token>` — see IOS_ENDPOINT_PREFIX.
 * sendPushToUser (./push-service) routes those rows here, so every notification
 * that already goes out as web push reaches iPhones too, with no second pipeline
 * and no schema change.
 *
 * Auth is APNs "token-based": an ES256 JWT signed with the .p8 key from the
 * Apple Developer portal (Keys → Apple Push Notifications service). Apple wants
 * it replaced no more often than every 20 minutes and no less often than every
 * 60, so one is minted per 50 minutes and reused in between.
 *
 * Env (production):
 *   APNS_KEY_ID        the key's Key ID
 *   APNS_TEAM_ID       Team ID (falls back to APPLE_TEAM_ID)
 *   APNS_PRIVATE_KEY   the .p8 contents (literal "\n" line breaks are fine)
 *   APNS_BUNDLE_ID     default ai.allfantasy.app (the push "topic")
 *   APNS_ENV           "production" (default — TestFlight and App Store) or "sandbox" (Xcode debug builds)
 * Unset → iOS push is simply off; web push is unaffected.
 */
import "server-only"
import crypto from "crypto"
import http2 from "http2"

export const IOS_ENDPOINT_PREFIX = "apns:"

export type ApnsPayload = {
  title: string
  body?: string
  href?: string
  tag?: string
  type?: string
  leagueId?: string | null
}

export type ApnsResult = { ok: true } | { ok: false; expired: boolean; error: string }

type ApnsConfig = { keyId: string; teamId: string; privateKey: string; topic: string; host: string }

export function apnsConfig(env: Record<string, string | undefined> = process.env): ApnsConfig | null {
  const keyId = env.APNS_KEY_ID?.trim()
  const teamId = (env.APNS_TEAM_ID ?? env.APPLE_TEAM_ID)?.trim()
  const privateKey = env.APNS_PRIVATE_KEY?.trim()
  if (!keyId || !teamId || !privateKey) return null
  return {
    keyId,
    teamId,
    privateKey: privateKey.replace(/\\n/g, "\n"),
    topic: env.APNS_BUNDLE_ID?.trim() || "ai.allfantasy.app",
    host: env.APNS_ENV?.trim() === "sandbox" ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com",
  }
}

export function isIosEndpoint(endpoint: string): boolean {
  return endpoint.startsWith(IOS_ENDPOINT_PREFIX)
}

/** A device token is hex; Apple's are 64 characters today, but the length is not a contract. */
export function isValidDeviceToken(token: unknown): token is string {
  return typeof token === "string" && /^[0-9a-fA-F]{32,200}$/.test(token)
}

let cachedJwt: { value: string; mintedAt: number; keyId: string } | null = null

export function apnsProviderToken(cfg: ApnsConfig, nowMs = Date.now()): string {
  if (cachedJwt && cachedJwt.keyId === cfg.keyId && nowMs - cachedJwt.mintedAt < 50 * 60_000) return cachedJwt.value
  const b64 = (v: string | Buffer) => Buffer.from(v).toString("base64url")
  const input = `${b64(JSON.stringify({ alg: "ES256", kid: cfg.keyId }))}.${b64(
    JSON.stringify({ iss: cfg.teamId, iat: Math.floor(nowMs / 1000) }),
  )}`
  const sig = crypto.sign("sha256", Buffer.from(input), {
    key: crypto.createPrivateKey(cfg.privateKey),
    dsaEncoding: "ieee-p1363",
  })
  const value = `${input}.${b64(sig)}`
  cachedJwt = { value, mintedAt: nowMs, keyId: cfg.keyId }
  return value
}

export function __resetApnsTokenCache(): void {
  cachedJwt = null
}

/** The notification body Apple shows, plus our own fields the app reads when it is tapped. */
export function apnsBody(payload: ApnsPayload): string {
  return JSON.stringify({
    aps: {
      alert: { title: payload.title, ...(payload.body ? { body: payload.body } : {}) },
      sound: "default",
    },
    href: payload.href ?? null,
    type: payload.type ?? "notification",
    leagueId: payload.leagueId ?? null,
  })
}

/**
 * Send one notification per device token over a single HTTP/2 connection.
 * Returns a result per token, in order. `expired` means Apple says the token is
 * gone (uninstalled, or never valid for this app) and the row should be deleted.
 */
export async function sendApns(deviceTokens: string[], payload: ApnsPayload): Promise<ApnsResult[]> {
  const cfg = apnsConfig()
  if (!cfg) return deviceTokens.map(() => ({ ok: false as const, expired: false, error: "APNs not configured" }))
  if (deviceTokens.length === 0) return []

  let jwt: string
  try {
    jwt = apnsProviderToken(cfg)
  } catch (e) {
    return deviceTokens.map(() => ({ ok: false as const, expired: false, error: `APNs key unusable: ${String(e)}` }))
  }

  const body = apnsBody(payload)
  const session = http2.connect(cfg.host)
  session.on("error", () => undefined)
  try {
    return await Promise.all(
      deviceTokens.map(
        (token) =>
          new Promise<ApnsResult>((resolve) => {
            const headers: http2.OutgoingHttpHeaders = {
              ":method": "POST",
              ":path": `/3/device/${token}`,
              authorization: `bearer ${jwt}`,
              "apns-topic": cfg.topic,
              "apns-push-type": "alert",
              "apns-priority": "10",
              "content-type": "application/json",
            }
            // Same-tag notifications replace each other, as on the web. Apple caps the id at 64 bytes.
            if (payload.tag) headers["apns-collapse-id"] = payload.tag.slice(0, 64)
            const req = session.request(headers)
            let status = 0
            let text = ""
            req.setTimeout(10_000, () => {
              req.close()
              resolve({ ok: false, expired: false, error: "APNs timeout" })
            })
            req.on("response", (h) => {
              status = Number(h[":status"] ?? 0)
            })
            req.on("data", (chunk) => {
              text += String(chunk)
            })
            req.on("end", () => {
              if (status === 200) return resolve({ ok: true })
              let reason = ""
              try {
                reason = String((JSON.parse(text) as { reason?: string }).reason ?? "")
              } catch {
                reason = text
              }
              // 410 Unregistered; 400 BadDeviceToken / DeviceTokenNotForTopic → the token is dead.
              const expired =
                status === 410 || (status === 400 && /BadDeviceToken|DeviceTokenNotForTopic/.test(reason))
              resolve({ ok: false, expired, error: `APNs ${status}${reason ? ` ${reason}` : ""}` })
            })
            req.on("error", (e) => resolve({ ok: false, expired: false, error: `APNs ${String(e)}` }))
            req.end(body)
          }),
      ),
    )
  } finally {
    session.close()
  }
}
