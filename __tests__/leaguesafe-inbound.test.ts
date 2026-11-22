// @vitest-environment node
import { createHmac } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  createMany: vi.fn(), findUniqueOrThrow: vi.fn(),
}))
vi.mock("@/lib/prisma", () => ({
  prisma: { leagueSafeRawEmail: { createMany: mocks.createMany, findUniqueOrThrow: mocks.findUniqueOrThrow } },
}))
import { POST } from "@/app/api/integrations/leaguesafe/inbound/route"
import { getLeagueSafeInboundConfig, LS_MAX_REQUEST_BYTES, readLeagueSafeRequestBody, verifyLeagueSafeSignature } from "@/lib/leaguesafe/inbound-security"

const secret = "synthetic-inbound-secret-with-at-least-32-bytes"
const now = Date.UTC(2026, 10, 14, 12)
const rawBody = [
  "From: alerts@notices.example", "To: allfantasysportsapp@gmail.com",
  "Subject: Synthetic capture 🧪", "Message-ID: <sender-controlled@example.invalid>",
  "Authentication-Results: mx.google.com; dkim=pass header.i=@notices.example; spf=pass; dmarc=pass",
  "", "<script>synthetic body only</script>",
].join("\r\n")
const envelope = { messageId: "19abcdef0123", receivedAt: "2026-11-14T11:00:00.000Z", rawBody }
function sign(body: string, timestamp = String(now / 1000)) {
  return "v1=" + createHmac("sha256", secret).update(timestamp + ".").update(body).digest("hex")
}
function request(body = JSON.stringify(envelope), timestamp = String(now / 1000), signature = sign(body, timestamp), extra: Record<string, string> = {}) {
  return new Request("https://example.invalid/api/integrations/leaguesafe/inbound", {
    method: "POST", headers: {
      "content-type": "application/json", "x-ls-timestamp": timestamp, "x-ls-signature": signature, ...extra,
    }, body,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("LS_INBOUND_SECRET", secret)
  vi.stubEnv("LS_SENDER_DOMAINS", "notices.example")
  vi.spyOn(Date, "now").mockReturnValue(now)
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
  mocks.createMany.mockResolvedValue({ count: 1 })
  mocks.findUniqueOrThrow.mockResolvedValue({ id: "raw-1", processingStatus: "captured", rejectionReason: null })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

describe("LeagueSafe HMAC and bounded transport", () => {
  it("matches the exact UTF-8 payload and detects tampering", () => {
    const body = JSON.stringify(envelope)
    expect(verifyLeagueSafeSignature(Buffer.from(body), String(now / 1000), sign(body), secret, now)).toBe(true)
    expect(verifyLeagueSafeSignature(Buffer.from(body + " "), String(now / 1000), sign(body), secret, now)).toBe(false)
  })
  it.each([-301, 301])("rejects timestamps outside the five-minute window (%s seconds)", (offset) => {
    const timestamp = String(now / 1000 + offset)
    expect(verifyLeagueSafeSignature(Buffer.from("body"), timestamp, sign("body", timestamp), secret, now)).toBe(false)
  })
  it.each([-300, 300])("accepts the five-minute boundary (%s seconds)", (offset) => {
    const timestamp = String(now / 1000 + offset)
    expect(verifyLeagueSafeSignature(Buffer.from("body"), timestamp, sign("body", timestamp), secret, now)).toBe(true)
  })
  it("fails closed on missing secret, short secret, or an empty/invalid domain list", () => {
    for (const [key, value] of [["LS_INBOUND_SECRET", ""], ["LS_INBOUND_SECRET", "short"], ["LS_SENDER_DOMAINS", ""], ["LS_SENDER_DOMAINS", "*.example"]]) {
      vi.stubEnv("LS_INBOUND_SECRET", secret)
      vi.stubEnv("LS_SENDER_DOMAINS", "notices.example")
      vi.stubEnv(key, value)
      expect(getLeagueSafeInboundConfig()).toBeNull()
    }
  })
  it("normalizes an explicit domain list without adding subdomains", () => {
    vi.stubEnv("LS_SENDER_DOMAINS", "Notices.Example, notices.example, mail.example")
    expect(getLeagueSafeInboundConfig()?.domains).toEqual(["notices.example", "mail.example"])
  })
  it("enforces the limit on an undeclared streaming body", async () => {
    const cancel = vi.fn()
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(LS_MAX_REQUEST_BYTES))
        controller.enqueue(new Uint8Array(1))
      },
      cancel,
    })
    const streamed = new Request("http://localhost", { method: "POST", body, duplex: "half" } as RequestInit)
    await expect(readLeagueSafeRequestBody(streamed)).rejects.toThrow()
    expect(cancel).toHaveBeenCalled()
  })
})

describe("POST LeagueSafe capture with real header/security helpers and a mocked database", () => {
  it("stores the original RFC822 and true receipt time without interpreting the body", async () => {
    const response = await POST(request())
    expect(response.status).toBe(202)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toEqual({ ok: true, stored: true, id: "raw-1", processingStatus: "captured", duplicate: false })
    expect(mocks.createMany).toHaveBeenCalledWith({
      skipDuplicates: true, data: [expect.objectContaining({
        messageId: envelope.messageId, receivedAt: new Date(envelope.receivedAt), rawBody,
        rfcMessageId: "<sender-controlled@example.invalid>", processingStatus: "captured", rejectionReason: null,
      })],
    })
  })
  it.each(["missing", "expired", "future", "tampered", "malformed"])("rejects %s signatures before touching the database", async (kind) => {
    let input = request()
    if (kind === "missing") input = new Request("http://localhost", { method: "POST", body: JSON.stringify(envelope) })
    if (kind === "expired") input = request(undefined, String(now / 1000 - 301))
    if (kind === "future") input = request(undefined, String(now / 1000 + 301))
    if (kind === "tampered") input = request(JSON.stringify({ ...envelope, rawBody: "altered" }), undefined, sign(JSON.stringify(envelope)))
    if (kind === "malformed") input = request(undefined, undefined, "v1=xyz")
    expect((await POST(input)).status).toBe(401)
    expect(mocks.createMany).not.toHaveBeenCalled()
    expect(mocks.findUniqueOrThrow).not.toHaveBeenCalled()
  })
  it("does not read the body of an expired request", async () => {
    const input = request(undefined, String(now / 1000 - 301))
    expect((await POST(input)).status).toBe(401)
    expect(input.bodyUsed).toBe(false)
  })
  it("stores a DKIM failure as rejected and only logs the generated ID and reason", async () => {
    const rejectedRaw = rawBody.replace("dkim=pass", "dkim=fail")
    mocks.findUniqueOrThrow.mockResolvedValue({ id: "raw-rejected", processingStatus: "rejected", rejectionReason: "leaguesafe_dkim_did_not_pass" })
    const response = await POST(request(JSON.stringify({ ...envelope, rawBody: rejectedRaw })))
    expect(response.status).toBe(202)
    expect(await response.json()).toMatchObject({ stored: true, processingStatus: "rejected" })
    expect(mocks.createMany.mock.calls[0][0].data[0]).toMatchObject({
      rawBody: rejectedRaw, processingStatus: "rejected", rejectionReason: "leaguesafe_dkim_did_not_pass",
    })
    expect(console.warn).toHaveBeenCalledWith("[leaguesafe] email_rejected", { id: "raw-rejected", reason: "leaguesafe_dkim_did_not_pass" })
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("alerts@")
  })
  it("acknowledges a retry without overwriting an existing capture or later processing status", async () => {
    mocks.createMany.mockResolvedValue({ count: 0 })
    mocks.findUniqueOrThrow.mockResolvedValue({ id: "raw-existing", processingStatus: "parsed" })
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ id: "raw-existing", duplicate: true, processingStatus: "parsed" })
    expect(mocks.createMany.mock.calls[0][0].skipDuplicates).toBe(true)
  })
  it("returns 503 without writes if the integration has not been configured", async () => {
    vi.stubEnv("LS_SENDER_DOMAINS", "")
    expect((await POST(request())).status).toBe(503)
    expect(mocks.createMany).not.toHaveBeenCalled()
  })
  it("rejects oversized bodies before storage", async () => {
    expect((await POST(request(undefined, undefined, undefined, { "content-length": String(LS_MAX_REQUEST_BYTES + 1) }))).status).toBe(413)
    expect(mocks.createMany).not.toHaveBeenCalled()
  })
  it.each([
    "{invalid",
    JSON.stringify({ ...envelope, receivedAt: "invalid" }),
    JSON.stringify({ ...envelope, messageId: "not-a-gmail-id" }),
    JSON.stringify({ ...envelope, rawBody: "" }),
    JSON.stringify({ ...envelope, rawBody: "contains\u0000null" }),
    JSON.stringify({ ...envelope, unexpected: "field" }),
  ])("rejects malformed signed payloads without writes", async (body) => {
    expect((await POST(request(body))).status).toBe(400)
    expect(mocks.createMany).not.toHaveBeenCalled()
  })
  it("requires JSON transport", async () => {
    expect((await POST(request(undefined, undefined, undefined, { "content-type": "text/plain" }))).status).toBe(415)
    expect(mocks.createMany).not.toHaveBeenCalled()
  })
  it("returns a retryable failure without exposing Prisma errors or email bodies", async () => {
    mocks.createMany.mockRejectedValueOnce(new Error("raw email and secret must never be logged: " + rawBody))
    const response = await POST(request())
    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain(rawBody)
    expect(console.error).toHaveBeenCalledWith("[leaguesafe] capture_failed")
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("script")
  })
})
