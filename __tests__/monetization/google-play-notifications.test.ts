// @vitest-environment node
import { beforeAll, afterEach, describe, expect, it, vi } from "vitest"
import { generateKeyPair, SignJWT } from "jose"
const keys = vi.hoisted(() => ({ publicKey: undefined as any }))
vi.mock("jose", async importOriginal => ({ ...await importOriginal<typeof import("jose")>(), createRemoteJWKSet: () => async () => keys.publicKey }))
import { authenticatePlayPush } from "@/lib/google-play/billingNotifications"
let privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"]
const audience = "https://www.allfantasy.ai/api/webhooks/google-play", email = "pubsub-push@example-project.iam.gserviceaccount.com"
beforeAll(async () => { const pair = await generateKeyPair("RS256"); keys.publicKey = pair.publicKey; privateKey = pair.privateKey })
afterEach(() => vi.unstubAllEnvs())
async function request(changes: { aud?: string; iss?: string; email?: string; verified?: boolean; expired?: boolean } = {}) {
  vi.stubEnv("GOOGLE_PLAY_RTDN_AUDIENCE", audience); vi.stubEnv("GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL", email)
  const token = await new SignJWT({ email: changes.email ?? email, email_verified: changes.verified ?? true })
    .setProtectedHeader({ alg: "RS256" }).setIssuer(changes.iss ?? "https://accounts.google.com")
    .setAudience(changes.aud ?? audience).setIssuedAt().setExpirationTime(changes.expired ? Math.floor(Date.now()/1000) - 10 : "5m").sign(privateKey)
  return new Request(audience, { method: "POST", headers: { authorization: `Bearer ${token}` } })
}
describe("Google Pub/Sub push identity", () => {
  it("accepts the signed configured Google identity and audience", async () => { await expect(authenticatePlayPush(await request())).resolves.toBeUndefined() })
  it.each([{ aud: "https://attacker.invalid" }, { iss: "https://attacker.invalid" }, { email: "wrong@example-project.iam.gserviceaccount.com" }, { verified: false }, { expired: true }])("rejects incorrect signed claims %j", async claims => {
    await expect(authenticatePlayPush(await request(claims))).rejects.toMatchObject({ status: 401 })
  })
  it("refuses an unsigned HTTP request", async () => {
    await request()
    await expect(authenticatePlayPush(new Request(audience, { method: "POST" }))).rejects.toMatchObject({ status: 401 })
  })
})
