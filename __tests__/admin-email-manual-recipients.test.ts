/**
 * The "manual recipient list" audience — a handful of specific email addresses
 * an operator types in, rather than one of the rule-based segments.
 *
 * The properties under test are the ones that make this safe to add next to a
 * feature that reaches real inboxes: manual entry gets the SAME opt-out and
 * undeliverable-domain filtering as every rule-based audience, a malformed
 * entry is dropped and counted rather than silently vanishing, a known
 * AppUser's send is attributed by userId the same as any other audience, and
 * a send with zero recipients after filtering is refused rather than
 * "succeeding" at reaching nobody.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const mocks = vi.hoisted(() => ({
  appUserFindMany: vi.fn(),
  appUserCount: vi.fn(),
  emailPreferenceFindMany: vi.fn(),
  emailPreferenceCount: vi.fn(),
  notificationOutboxCount: vi.fn(),
  notificationOutboxCreate: vi.fn(),
  notificationOutboxFindFirst: vi.fn(),
  resendEmailEventFindMany: vi.fn(),
  sendMarketingEmail: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    appUser: { findMany: mocks.appUserFindMany, count: mocks.appUserCount },
    emailPreference: { findMany: mocks.emailPreferenceFindMany, count: mocks.emailPreferenceCount },
    notificationOutbox: {
      count: mocks.notificationOutboxCount,
      create: mocks.notificationOutboxCreate,
      findFirst: mocks.notificationOutboxFindFirst,
    },
    resendEmailEvent: { findMany: mocks.resendEmailEventFindMany },
  },
}))

vi.mock("@/lib/email/marketing-email", () => ({
  sendMarketingEmail: mocks.sendMarketingEmail,
}))

describe("parseManualRecipientInput / isPlausibleEmail — pure, shared with the client", () => {
  it("splits on comma, semicolon, newline, and whitespace, and lowercases", async () => {
    const { parseManualRecipientInput } = await import("@/lib/admin-dashboard/parseManualRecipients")
    expect(parseManualRecipientInput("Jane@Example.com, sam@example.com;\npat@example.com pat2@example.com")).toEqual([
      "jane@example.com",
      "sam@example.com",
      "pat@example.com",
      "pat2@example.com",
    ])
  })

  it("drops blank entries from a messy paste", async () => {
    const { parseManualRecipientInput } = await import("@/lib/admin-dashboard/parseManualRecipients")
    expect(parseManualRecipientInput("  , ,\n\n a@b.com \n ")).toEqual(["a@b.com"])
  })

  it("accepts a real shape and rejects an obvious non-email", async () => {
    const { isPlausibleEmail } = await import("@/lib/admin-dashboard/parseManualRecipients")
    expect(isPlausibleEmail("a@b.com")).toBe(true)
    expect(isPlausibleEmail("Jane Doe")).toBe(false)
    expect(isPlausibleEmail("missing-at-sign.com")).toBe(false)
    expect(isPlausibleEmail("no-domain@")).toBe(false)
  })
})

describe("previewEmailAudience('manual') — the same safety chain as every other audience", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.appUserFindMany.mockResolvedValue([])
    mocks.emailPreferenceFindMany.mockResolvedValue([])
  })

  it("dedupes, drops invalid entries, and counts them separately from opt-outs", async () => {
    mocks.emailPreferenceFindMany.mockResolvedValue([])
    const { previewEmailAudience } = await import("@/lib/admin-dashboard/AdminEmailCenterService")

    const { preview, recipients } = await previewEmailAudience("manual", 500, [
      "a@user.test.dev",
      "A@User.Test.Dev", // duplicate of the above, case-insensitive
      "not-an-email",
      "",
    ])

    expect(recipients.map((r) => r.email)).toEqual(["a@user.test.dev"])
    expect(preview.recipientCount).toBe(1)
    expect(preview.invalidEntries).toBe(1)
    expect(preview.excludedOptOuts).toBe(0)
  })

  it("excludes an opted-out address the same way a rule-based audience would", async () => {
    mocks.emailPreferenceFindMany.mockResolvedValue([{ email: "optedout@user.test.dev" }])
    const { previewEmailAudience } = await import("@/lib/admin-dashboard/AdminEmailCenterService")

    const { preview, recipients } = await previewEmailAudience("manual", 500, [
      "optedout@user.test.dev",
      "clean@user.test.dev",
    ])

    expect(recipients.map((r) => r.email)).toEqual(["clean@user.test.dev"])
    expect(preview.excludedOptOuts).toBe(1)
  })

  /*
   * ⚠ `example.com`/`.org`/`.net` ARE ALL RFC 2606 RESERVED — every one of
   * them is undeliverable by definition (see lib/email/undeliverableDomains.ts),
   * which is why the "should survive" fixtures elsewhere in this file use
   * `test.dev` instead: a real-shaped, non-reserved domain, the same
   * convention already used by commissioner-invite-route.test.ts and others in
   * this repo. Using a reserved domain for a fixture that is supposed to be
   * DELIVERABLE was the first draft's own bug, caught by every one of those
   * cases returning an empty list instead of throwing — worth recording
   * because it looked exactly like a real defect in the code under test until
   * read against this file.
   */
  it("excludes a reserved/undeliverable domain without a DB round trip for it", async () => {
    const { previewEmailAudience } = await import("@/lib/admin-dashboard/AdminEmailCenterService")

    const { preview, recipients } = await previewEmailAudience("manual", 500, [
      "test@example.com", // RFC 2606 reserved — undeliverable by definition
      "real@user.test.dev",
    ])

    expect(recipients.map((r) => r.email)).toEqual(["real@user.test.dev"])
    expect(preview.recipientCount).toBe(1)
  })

  it("attaches userId for an address that matches an existing AppUser, and leaves it null otherwise", async () => {
    mocks.appUserFindMany.mockResolvedValue([{ id: "user-123", email: "known@user.test.dev", username: "known_user" }])
    const { previewEmailAudience } = await import("@/lib/admin-dashboard/AdminEmailCenterService")

    const { recipients } = await previewEmailAudience("manual", 500, ["known@user.test.dev", "unknown@user.test.dev"])

    const known = recipients.find((r) => r.email === "known@user.test.dev")
    const unknown = recipients.find((r) => r.email === "unknown@user.test.dev")
    expect(known).toMatchObject({ userId: "user-123", username: "known_user" })
    expect(unknown).toMatchObject({ userId: null, username: null })
  })

  /*
   * 🛑 THE CAP THAT KEEPS THIS FROM BECOMING A SECOND BULK-SEND PATH. Manual
   * entry exists for "a handful of people" — MAX_MANUAL_RECIPIENTS (50) is
   * enforced even when the caller (the route) allows a larger raw payload
   * through its own schema limit.
   */
  it("caps at MAX_MANUAL_RECIPIENTS even when more valid addresses were entered", async () => {
    const { previewEmailAudience } = await import("@/lib/admin-dashboard/AdminEmailCenterService")
    const many = Array.from({ length: 80 }, (_, i) => `person${i}@user.test.dev`)

    const { preview, recipients } = await previewEmailAudience("manual", 500, many)

    expect(recipients.length).toBe(50)
    expect(preview.cappedAt).toBe(50)
  })

  it("returns an honest zero, not an error, for an empty list", async () => {
    const { previewEmailAudience } = await import("@/lib/admin-dashboard/AdminEmailCenterService")
    const { preview, recipients } = await previewEmailAudience("manual", 500, [])
    expect(recipients).toEqual([])
    expect(preview.recipientCount).toBe(0)
  })
})

describe("runAdminEmailAction — manual audience through the real send path", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env.RESEND_API_KEY = "test-key"
    process.env.RESEND_FROM = "updates@allfantasy.ai"
    mocks.appUserFindMany.mockResolvedValue([])
    mocks.appUserCount.mockResolvedValue(0)
    mocks.emailPreferenceFindMany.mockResolvedValue([])
    mocks.emailPreferenceCount.mockResolvedValue(0)
    mocks.notificationOutboxCount.mockResolvedValue(0)
    mocks.notificationOutboxFindFirst.mockResolvedValue(null)
    mocks.resendEmailEventFindMany.mockResolvedValue([])
    mocks.sendMarketingEmail.mockResolvedValue({ ok: true, id: "resend-id-1" })
  })

  /*
   * ⚠ THE FAILURE MODE THIS GUARDS: A ZERO-RECIPIENT "SUCCESS". Before this
   * guard existed (added alongside manual entry, but it protects every
   * audience), a send whose recipient list filtered down to nobody still
   * reported "Broadcast sent," burned a rate-limit slot, and left a 24h
   * duplicate-guard entry behind for a send that reached no one.
   */
  it("refuses a send when every manual entry is invalid or opted out, and sends nothing", async () => {
    mocks.emailPreferenceFindMany.mockResolvedValue([{ email: "optedout@user.test.dev" }])
    const { runAdminEmailAction } = await import("@/lib/admin-dashboard/AdminEmailCenterService")

    const result = await runAdminEmailAction({
      mode: "send",
      audience: "manual",
      subject: "Product update",
      body: "Here is what changed this week.",
      confirm: true,
      manualEmails: ["optedout@user.test.dev", "not-an-email"],
    })

    expect(result.ok).toBe(false)
    expect(result.sent).toBe(0)
    expect(result.message).toMatch(/no recipients/i)
    expect(mocks.sendMarketingEmail).not.toHaveBeenCalled()
    expect(mocks.notificationOutboxCreate).not.toHaveBeenCalled()
  })

  it("sends to a small manual list and logs each with the right userId attribution", async () => {
    mocks.appUserFindMany.mockResolvedValue([{ id: "user-9", email: "known@user.test.dev", username: "known_user" }])
    const { runAdminEmailAction } = await import("@/lib/admin-dashboard/AdminEmailCenterService")

    const result = await runAdminEmailAction({
      mode: "send",
      audience: "manual",
      subject: "Product update",
      body: "Here is what changed this week.",
      confirm: true,
      manualEmails: ["known@user.test.dev", "guest@user.test.dev"],
    })

    expect(result.ok).toBe(true)
    expect(result.sent).toBe(2)
    expect(mocks.sendMarketingEmail).toHaveBeenCalledTimes(2)
    expect(mocks.notificationOutboxCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: "user-9" }) })
    )
    expect(mocks.notificationOutboxCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: null }) })
    )
  })

  it("a manual preview never calls sendMarketingEmail", async () => {
    const { runAdminEmailAction } = await import("@/lib/admin-dashboard/AdminEmailCenterService")

    const result = await runAdminEmailAction({
      mode: "preview",
      audience: "manual",
      subject: "Product update",
      body: "Here is what changed this week.",
      manualEmails: ["a@user.test.dev", "b@user.test.dev"],
    })

    expect(result.preview.recipientCount).toBe(2)
    expect(mocks.sendMarketingEmail).not.toHaveBeenCalled()
    expect(mocks.notificationOutboxCreate).not.toHaveBeenCalled()
  })
})
