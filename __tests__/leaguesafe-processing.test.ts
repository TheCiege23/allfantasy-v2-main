// @vitest-environment node
import { readFileSync } from "node:fs"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { LS_PARSER_VERSION } from "@/lib/leaguesafe/notification-parser"

const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), updateMany: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: { leagueSafeRawEmail: mocks } }))
import { processLeagueSafeNotification } from "@/lib/leaguesafe/process-notification"

const source = () => ({
  id: "raw-sample", messageId: "aabbcc", receivedAt: new Date("2026-01-02T00:00:00Z"),
  rawBody: readFileSync("__tests__/fixtures/leaguesafe/payment-received.eml", "utf8"),
  processingStatus: "captured", rejectionReason: null, parserVersion: null, parseAttemptedAt: null,
})
beforeEach(() => {
  vi.clearAllMocks()
  mocks.findUnique.mockResolvedValue(source())
  mocks.updateMany.mockResolvedValue({ count: 1 })
})

describe("explicit Phase 2 processing", () => {
  it("writes only parse metadata, preserving raw authentication, assignment, members and ledger", async () => {
    expect(await processLeagueSafeNotification("raw-sample", ["leaguesafe.com"])).toBe("parsed")
    expect(mocks.updateMany).toHaveBeenCalledOnce()
    const { where, data } = mocks.updateMany.mock.calls[0][0]
    expect(Object.keys(data).sort()).toEqual(["processingStatus", "parserVersion", "parseAttemptedAt", "parseError", "parsedPayload", "parseDedupeKey"].sort())
    expect(data.parsedPayload.details.amountCents).toBe(1250)
    expect(where).toEqual({ id: "raw-sample", processingStatus: "captured", rejectionReason: null, parserVersion: null, parseAttemptedAt: null })
  })
  it.each(["parsed", "unparseable"])("makes reprocessing the same version a no-op after %s", async (processingStatus) => {
    mocks.findUnique.mockResolvedValue({ ...source(), processingStatus, parserVersion: LS_PARSER_VERSION, parseAttemptedAt: new Date() })
    expect(await processLeagueSafeNotification("raw-sample", ["leaguesafe.com"])).toBe("unchanged")
    expect(mocks.updateMany).not.toHaveBeenCalled()
  })
  it("allows a new parser version to resolve a previous review alert", async () => {
    mocks.findUnique.mockResolvedValue({ ...source(), processingStatus: "unparseable", parserVersion: "older-parser", parseAttemptedAt: new Date() })
    expect(await processLeagueSafeNotification("raw-sample", ["leaguesafe.com"])).toBe("parsed")
    expect(mocks.updateMany.mock.calls[0][0].data.parseError).toBeNull()
  })
  it("never promotes a rejected record, even with passing preserved headers", async () => {
    mocks.findUnique.mockResolvedValue({ ...source(), processingStatus: "rejected" })
    expect(await processLeagueSafeNotification("raw-sample", ["leaguesafe.com"])).toBe("rejected")
    expect(mocks.updateMany).not.toHaveBeenCalled()
  })
  it("stores unsupported formats as one durable review row and logs only a static reason and source id", async () => {
    mocks.findUnique.mockResolvedValue({ ...source(), rawBody: source().rawBody.replace("Subject:", "Subject: Unsupported ") })
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      expect(await processLeagueSafeNotification("raw-sample", ["leaguesafe.com"])).toBe("unparseable")
      expect(mocks.updateMany.mock.calls[0][0].data).toMatchObject({ processingStatus: "unparseable", parseError: "unknown_or_invalid_template", parseDedupeKey: null })
      expect(warning).toHaveBeenCalledWith("[leaguesafe] parse_review_required", { id: "raw-sample", reason: "unknown_or_invalid_template" })
    } finally { warning.mockRestore() }
  })
  it("rechecks the newest authentication block without trusting a later PASS", async () => {
    const row = source()
    row.rawBody = "Authentication-Results: mx.google.com; dkim=fail header.d=leaguesafe.com\n" + row.rawBody
    mocks.findUnique.mockResolvedValue(row)
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      expect(await processLeagueSafeNotification("raw-sample", ["leaguesafe.com"])).toBe("unparseable")
      expect(mocks.updateMany.mock.calls[0][0].data.parseError).toBe("authentication_policy_failed")
    } finally { warning.mockRestore() }
  })
  it("reports simultaneous-change conflicts without emitting a second alert", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 })
    expect(await processLeagueSafeNotification("raw-sample", ["leaguesafe.com"])).toBe("conflict")
  })
  it("handles deleted selections without creating records", async () => {
    mocks.findUnique.mockResolvedValue(null)
    expect(await processLeagueSafeNotification("missing", ["leaguesafe.com"])).toBe("not_found")
    expect(mocks.updateMany).not.toHaveBeenCalled()
  })
})
