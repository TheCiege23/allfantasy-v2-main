// @vitest-environment node
import { readFileSync } from "node:fs"
import { createHmac } from "node:crypto"
import { runInNewContext } from "node:vm"
import { describe, expect, it, vi } from "vitest"
import { verifyLeagueSafeSignature } from "@/lib/leaguesafe/inbound-security"

const script = readFileSync("scripts/leaguesafe/Code.gs", "utf8")
const raw = "From: sender@notices.example\r\nSubject: Synthetic 🧪\r\n\r\nUninterpreted MIME body."
const secret = "synthetic-apps-script-secret-with-32-plus-bytes"

function runtime() {
  const processed = new Set<string>()
  const ids = ["19abc"]
  const triggers: { getHandlerFunction: () => string }[] = []
  const properties: Record<string, string> = {
    LS_INBOUND_URL: "https://example.invalid/api/integrations/leaguesafe/inbound",
    LS_INBOUND_SECRET: secret, LS_SENDER_DOMAINS: "notices.example",
  }
  const receipt = { ok: true, stored: true, id: "raw-1", processingStatus: "captured" }
  const response = {
    getResponseCode: vi.fn(() => 202),
    getContentText: vi.fn(() => JSON.stringify(receipt)),
  }
  const fetch = vi.fn(() => response)
  const modify = vi.fn((_: unknown, __: string, id: string) => { processed.add(id) })
  const releaseLock = vi.fn()
  const get = vi.fn(() => ({
    raw: Buffer.from(raw).toString("base64url"), internalDate: "1794650400000",
  }))
  const profile = vi.fn(() => ({ emailAddress: "allfantasysportsapp@gmail.com" }))
  const context = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key: string) => properties[key] }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock }) },
    Gmail: { Users: {
      getProfile: profile,
      Labels: { list: () => ({ labels: [{ id: "label-1", name: "af-processed" }] }), create: vi.fn() },
      Messages: {
        list: vi.fn(() => ({ messages: ids.filter((id) => !processed.has(id)).map((id) => ({ id, threadId: "shared-thread" })) })),
        get, modify,
      },
    } },
    Utilities: {
      Charset: { UTF_8: "UTF-8" },
      newBlob: (value: string | number[]) => {
        const buffer = typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value)
        return { getBytes: () => [...buffer], getDataAsString: () => buffer.toString("utf8") }
      },
      base64DecodeWebSafe: (value: string) => [...Buffer.from(value, "base64url")],
      computeHmacSha256Signature: (value: string, key: string) =>
        [...createHmac("sha256", key).update(value).digest()].map((byte) => byte > 127 ? byte - 256 : byte),
    },
    UrlFetchApp: { fetch },
    ScriptApp: {
      getProjectTriggers: () => triggers,
      newTrigger: (name: string) => ({
        timeBased: () => ({ everyMinutes: (interval: number) => ({
          create: () => { expect(interval).toBe(5); triggers.push({ getHandlerFunction: () => name }) },
        }) }),
      }),
    },
    console: { error: vi.fn() },
    captureLeagueSafeEmails: undefined as unknown as () => void,
    installLeagueSafeTrigger: undefined as unknown as () => void,
  }
  runInNewContext(script, context)
  return { context, processed, ids, properties, receipt, response, fetch, modify, releaseLock, get, profile, triggers }
}

describe("actual Apps Script transport executed with mocked Google services", () => {
  it("sends the raw MIME and Gmail internalDate with an HMAC the server verifies", () => {
    const run = runtime()
    run.context.captureLeagueSafeEmails()
    expect(run.fetch).toHaveBeenCalledOnce()
    const [url, options] = run.fetch.mock.calls[0] as unknown as [string, {
      payload: string; headers: Record<string, string>; followRedirects: boolean
    }]
    expect(url).toBe(run.properties.LS_INBOUND_URL)
    expect(options.followRedirects).toBe(false)
    expect(JSON.parse(options.payload)).toEqual({
      messageId: "19abc", receivedAt: new Date(1794650400000).toISOString(), rawBody: raw,
    })
    expect(verifyLeagueSafeSignature(
      Buffer.from(options.payload), options.headers["X-LS-Timestamp"], options.headers["X-LS-Signature"], secret,
    )).toBe(true)
    expect(run.modify).toHaveBeenCalledWith({ addLabelIds: ["label-1"] }, "me", "19abc")
    expect(run.releaseLock).toHaveBeenCalled()
  })
  it.each([401, 403, 413, 500, 302])("does not label emails after HTTP %s and retries later", (code) => {
    const run = runtime()
    run.response.getResponseCode.mockReturnValue(code)
    expect(() => run.context.captureLeagueSafeEmails()).toThrow("failed message")
    expect(run.modify).not.toHaveBeenCalled()
    expect(run.releaseLock).toHaveBeenCalled()
    run.response.getResponseCode.mockReturnValue(202)
    run.context.captureLeagueSafeEmails()
    expect(run.processed.has("19abc")).toBe(true)
  })
  it("requires an explicit storage receipt, even on HTTP 200", () => {
    const run = runtime()
    run.response.getResponseCode.mockReturnValue(200)
    run.response.getContentText.mockReturnValue('{"ok":true}')
    expect(() => run.context.captureLeagueSafeEmails()).toThrow()
    expect(run.modify).not.toHaveBeenCalled()
  })
  it("labels a stored DKIM rejection as processed for admin review", () => {
    const run = runtime()
    run.receipt.processingStatus = "rejected"
    run.context.captureLeagueSafeEmails()
    expect(run.modify).toHaveBeenCalledOnce()
  })
  it("captures a later message in an already processed conversation", () => {
    const run = runtime()
    run.context.captureLeagueSafeEmails()
    run.ids.push("19def")
    run.context.captureLeagueSafeEmails()
    expect(run.modify.mock.calls.map((call) => call[2])).toEqual(["19abc", "19def"])
  })
  it("safely retries a successful capture after Gmail labeling fails", () => {
    const run = runtime()
    run.modify.mockImplementationOnce(() => { throw new Error("Gmail unavailable") })
    expect(() => run.context.captureLeagueSafeEmails()).toThrow()
    expect(run.processed.size).toBe(0)
    run.response.getResponseCode.mockReturnValue(200)
    run.context.captureLeagueSafeEmails()
    expect(run.fetch).toHaveBeenCalledTimes(2)
    expect(run.processed.has("19abc")).toBe(true)
  })
  it("refuses installation or capture from the wrong inbox", () => {
    const run = runtime()
    run.profile.mockReturnValue({ emailAddress: "wrong@example.invalid" })
    expect(() => run.context.captureLeagueSafeEmails()).toThrow("Wrong Gmail account")
    expect(run.fetch).not.toHaveBeenCalled()
    expect(run.get).not.toHaveBeenCalled()
  })
  it("creates exactly one five-minute trigger", () => {
    const run = runtime()
    run.context.installLeagueSafeTrigger()
    run.context.installLeagueSafeTrigger()
    expect(run.triggers).toHaveLength(1)
  })
})
