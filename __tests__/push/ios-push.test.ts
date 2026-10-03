// @vitest-environment node
/**
 * Native push to the iOS app (APNs), riding the existing web-push table and sender.
 *
 *  - sendApns: what goes over the wire to Apple (path, topic, auth, collapse id, body), and
 *    which answers mean "this phone is gone" (delete the row) vs a transient failure.
 *  - sendPushToUser: iPhones and browsers are routed separately, and each half depends only
 *    on its own keys — an unset VAPID must not silence iPhones.
 *  - /api/push/ios: sign-in required, token validated, the login's sid recorded.
 *  - sign-out removes exactly that login's phone.
 *
 * Apple is stood in for by a fake http2 session; the ES256 provider token is verified with
 * the matching public key (jose), not string-matched.
 */
import { EventEmitter } from "node:events"
import crypto from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { decodeProtectedHeader, importSPKI, jwtVerify } from "jose"

/* ── A fake Apple: records each request and answers from `answers` by device token. ── */
type Sent = { headers: Record<string, string>; body: string }
const apple = vi.hoisted(() => ({ sent: [] as Array<{ headers: Record<string, string>; body: string }>, answers: new Map<string, { status: number; reason?: string }>(), connectedTo: [] as string[] }))
vi.mock("http2", () => {
  const connect = (host: string) => {
    apple.connectedTo.push(host)
    const session = new EventEmitter() as EventEmitter & { request: unknown; close: () => void }
    session.close = () => undefined
    session.request = (headers: Record<string, string>) => {
      const req = new EventEmitter() as EventEmitter & { setTimeout: () => void; close: () => void; end: (b: string) => void }
      req.setTimeout = () => undefined
      req.close = () => undefined
      req.end = (body: string) => {
        apple.sent.push({ headers, body })
        const token = String(headers[":path"]).split("/").pop() ?? ""
        const answer = apple.answers.get(token) ?? { status: 200 }
        setImmediate(() => {
          req.emit("response", { ":status": answer.status })
          if (answer.reason) req.emit("data", JSON.stringify({ reason: answer.reason }))
          req.emit("end")
        })
      }
      return req
    }
    return session
  }
  return { default: { connect }, connect }
})

/* ── Prisma and web-push stand-ins for the sender ── */
const db = vi.hoisted(() => ({ rows: [] as Array<{ id: string; endpoint: string; p256dh: string; auth: string; userAgent?: string | null; userId?: string }>, deleted: [] as unknown[], upserts: [] as unknown[] }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    webPushSubscription: {
      findMany: vi.fn(async () => db.rows),
      deleteMany: vi.fn(async (args: unknown) => {
        db.deleted.push(args)
        return { count: 1 }
      }),
      upsert: vi.fn(async (args: unknown) => {
        db.upserts.push(args)
        return { id: "row" }
      }),
    },
  },
}))
const webpushSend = vi.hoisted(() => vi.fn(async () => ({ statusCode: 201 })))
vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification: webpushSend } }))

import { apnsBody, apnsProviderToken, sendApns, __resetApnsTokenCache } from "@/lib/push-notifications/apns"
import { removeIosDevicesForSession, saveIosDevice, sendPushToUser } from "@/lib/push-notifications/push-service"

const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" })
const P8 = privateKey.export({ type: "pkcs8", format: "pem" }).toString()
const PUB = publicKey.export({ type: "spki", format: "pem" }).toString()
const TOKEN_A = "a".repeat(64)
const TOKEN_B = "b".repeat(64)

const ENV = ["APNS_KEY_ID", "APNS_TEAM_ID", "APNS_PRIVATE_KEY", "APNS_BUNDLE_ID", "APNS_ENV", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"] as const
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]))

beforeEach(() => {
  apple.sent.length = 0
  apple.answers.clear()
  apple.connectedTo.length = 0
  db.rows = []
  db.deleted = []
  db.upserts = []
  webpushSend.mockClear()
  __resetApnsTokenCache()
  process.env.APNS_KEY_ID = "KEYID12345"
  process.env.APNS_TEAM_ID = "TEAMID1234"
  process.env.APNS_PRIVATE_KEY = P8.trim().replace(/\n/g, "\\n")
  delete process.env.APNS_BUNDLE_ID
  delete process.env.APNS_ENV
  delete process.env.VAPID_PUBLIC_KEY
  delete process.env.VAPID_PRIVATE_KEY
})
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe("sendApns — what reaches Apple", () => {
  it("posts each token to Apple with the app's topic, a verifiable ES256 token and the payload", async () => {
    const res = await sendApns([TOKEN_A], { title: "Injury: Josh Allen", body: "Out for Sunday", href: "/core/players?id=1", tag: "injury-1", leagueId: "L1" })
    expect(res).toEqual([{ ok: true }])
    expect(apple.connectedTo).toEqual(["https://api.push.apple.com"])
    const { headers, body } = apple.sent[0] as Sent
    expect(headers[":path"]).toBe(`/3/device/${TOKEN_A}`)
    expect(headers["apns-topic"]).toBe("ai.allfantasy.app")
    expect(headers["apns-push-type"]).toBe("alert")
    expect(headers["apns-collapse-id"]).toBe("injury-1")
    const jwt = headers.authorization.replace(/^bearer /, "")
    expect(decodeProtectedHeader(jwt)).toMatchObject({ alg: "ES256", kid: "KEYID12345" })
    await expect(jwtVerify(jwt, await importSPKI(PUB, "ES256"), { issuer: "TEAMID1234" })).resolves.toBeTruthy()
    expect(JSON.parse(body)).toEqual({
      aps: { alert: { title: "Injury: Josh Allen", body: "Out for Sunday" }, sound: "default" },
      href: "/core/players?id=1",
      type: "notification",
      leagueId: "L1",
    })
  })

  it("marks a gone phone as expired (410, BadDeviceToken) and a transient failure as not", async () => {
    apple.answers.set(TOKEN_A, { status: 410, reason: "Unregistered" })
    apple.answers.set(TOKEN_B, { status: 429, reason: "TooManyRequests" })
    const [gone, busy] = await sendApns([TOKEN_A, TOKEN_B], { title: "t" })
    expect(gone).toMatchObject({ ok: false, expired: true })
    expect(busy).toMatchObject({ ok: false, expired: false })
    apple.answers.set(TOKEN_A, { status: 400, reason: "BadDeviceToken" })
    expect((await sendApns([TOKEN_A], { title: "t" }))[0]).toMatchObject({ ok: false, expired: true })
  })

  it("uses the sandbox host when APNS_ENV=sandbox, and does nothing unconfigured", async () => {
    process.env.APNS_ENV = "sandbox"
    await sendApns([TOKEN_A], { title: "t" })
    expect(apple.connectedTo).toEqual(["https://api.sandbox.push.apple.com"])
    delete process.env.APNS_KEY_ID
    expect(await sendApns([TOKEN_A], { title: "t" })).toEqual([{ ok: false, expired: false, error: "APNs not configured" }])
  })

  it("reuses one provider token for 50 minutes, then mints another", () => {
    const cfg = { keyId: "K", teamId: "T", privateKey: P8, topic: "x", host: "h" }
    const t0 = apnsProviderToken(cfg, 1_000_000)
    expect(apnsProviderToken(cfg, 1_000_000 + 49 * 60_000)).toBe(t0)
    expect(apnsProviderToken(cfg, 1_000_000 + 51 * 60_000)).not.toBe(t0)
  })

  it("keeps an empty body out of the alert", () => {
    expect(JSON.parse(apnsBody({ title: "Hi" })).aps.alert).toEqual({ title: "Hi" })
  })
})

describe("sendPushToUser — iPhones and browsers are separate", () => {
  it("reaches the iPhone even when web push (VAPID) is not configured", async () => {
    db.rows = [
      { id: "ios-1", endpoint: `apns:${TOKEN_A}`, p256dh: "", auth: "" },
      { id: "web-1", endpoint: "https://fcm.googleapis.com/x", p256dh: "p", auth: "a" },
    ]
    const results = await sendPushToUser("u1", { title: "Trade accepted" })
    expect(apple.sent).toHaveLength(1)
    expect(results.find((r) => r.subscriptionId === "ios-1")).toMatchObject({ ok: true })
    expect(results.filter((r) => r.error === "VAPID not configured")).toHaveLength(1)
    expect(webpushSend).not.toHaveBeenCalled()
  })

  it("control: a browser row still goes to web-push, never to Apple", async () => {
    process.env.VAPID_PUBLIC_KEY = "pub"
    process.env.VAPID_PRIVATE_KEY = "priv"
    db.rows = [{ id: "web-1", endpoint: "https://fcm.googleapis.com/x", p256dh: "p", auth: "a" }]
    await sendPushToUser("u1", { title: "t" })
    expect(webpushSend).toHaveBeenCalledTimes(1)
    expect(apple.sent).toHaveLength(0)
  })

  it("a DM sender's face is the browser's icon and the iPhone's attachment", async () => {
    process.env.VAPID_PUBLIC_KEY = "pub"
    process.env.VAPID_PRIVATE_KEY = "priv"
    db.rows = [
      { id: "ios-1", endpoint: `apns:${TOKEN_A}`, p256dh: "", auth: "" },
      { id: "web-1", endpoint: "https://fcm.googleapis.com/x", p256dh: "p", auth: "a" },
    ]
    await sendPushToUser("u1", { title: "Matt Jones", body: "Sup!", iconUrl: "https://blob.test/matt.png" })
    const web = JSON.parse(String((webpushSend.mock.calls[0] as unknown[])[1]))
    expect(web.icon).toBe("https://blob.test/matt.png")
    // An avatar is not a banner: the large `image` slot stays empty on the web.
    expect(web.image).toBeUndefined()
    const ios = JSON.parse((apple.sent[0] as Sent).body)
    expect(ios.imageUrl).toBe("https://blob.test/matt.png")
    expect(ios.aps["mutable-content"]).toBe(1)
  })

  it("a real picture still wins the iPhone's one attachment over the face", async () => {
    db.rows = [{ id: "ios-1", endpoint: `apns:${TOKEN_A}`, p256dh: "", auth: "" }]
    await sendPushToUser("u1", { title: "t", imageUrl: "https://cdn.test/card.png", iconUrl: "https://blob.test/matt.png" })
    expect(JSON.parse((apple.sent[0] as Sent).body).imageUrl).toBe("https://cdn.test/card.png")
  })

  it("an icon a phone cannot fetch is dropped, not forwarded", async () => {
    process.env.VAPID_PUBLIC_KEY = "pub"
    process.env.VAPID_PRIVATE_KEY = "priv"
    db.rows = [
      { id: "ios-1", endpoint: `apns:${TOKEN_A}`, p256dh: "", auth: "" },
      { id: "web-1", endpoint: "https://fcm.googleapis.com/x", p256dh: "p", auth: "a" },
    ]
    await sendPushToUser("u1", { title: "t", iconUrl: "data:image/png;base64,AAAA" })
    expect(JSON.parse(String((webpushSend.mock.calls[0] as unknown[])[1])).icon).toBeUndefined()
    expect(JSON.parse((apple.sent[0] as Sent).body)).not.toHaveProperty("imageUrl")
  })

  it("deletes an iPhone Apple says is gone, and keeps one that only failed transiently", async () => {
    apple.answers.set(TOKEN_A, { status: 410, reason: "Unregistered" })
    apple.answers.set(TOKEN_B, { status: 503 })
    db.rows = [
      { id: "ios-a", endpoint: `apns:${TOKEN_A}`, p256dh: "", auth: "" },
      { id: "ios-b", endpoint: `apns:${TOKEN_B}`, p256dh: "", auth: "" },
    ]
    await sendPushToUser("u1", { title: "t" })
    expect(db.deleted).toEqual([{ where: { endpoint: `apns:${TOKEN_A}` } }])
  })
})

describe("registering and unregistering the phone", () => {
  it("stores the phone in the push table under apns:, tied to the login's sid", async () => {
    expect(await saveIosDevice("u1", TOKEN_A.toUpperCase(), "sid-1")).toBe(true)
    expect(db.upserts[0]).toMatchObject({
      where: { endpoint: `apns:${TOKEN_A}` },
      create: { userId: "u1", endpoint: `apns:${TOKEN_A}`, p256dh: "", auth: "", userAgent: "ios-app sid:sid-1" },
    })
    expect(await saveIosDevice("u1", "not-a-token", "sid-1")).toBe(false)
  })

  it("sign-out removes exactly that login's phone", async () => {
    await removeIosDevicesForSession("sid-1")
    expect(db.deleted).toEqual([{ where: { endpoint: { startsWith: "apns:" }, userAgent: "ios-app sid:sid-1" } }])
  })
})
