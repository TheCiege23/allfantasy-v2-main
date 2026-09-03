import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  getEmailCenterStatus: vi.fn(),
  runAdminEmailAction: vi.fn(),
  logAdminAudit: vi.fn(),
}))

vi.mock("@/lib/adminAuth", () => ({
  requireAdmin: mocks.requireAdmin,
}))

vi.mock("@/lib/admin-dashboard/AdminEmailCenterService", () => ({
  EMAIL_AUDIENCES: [
    { id: "all", label: "All", description: "All users" },
    { id: "manual", label: "Manual recipient list", description: "Specific addresses." },
  ],
  getEmailCenterStatus: mocks.getEmailCenterStatus,
  runAdminEmailAction: mocks.runAdminEmailAction,
}))

vi.mock("@/lib/admin-audit", () => ({
  logAdminAudit: mocks.logAdminAudit,
  resolveAdminAuditActor: (user: { email?: string | null }) => user.email ?? "unknown",
}))

describe("/api/admin/email/broadcast", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it("blocks non-admin users", async () => {
    mocks.requireAdmin.mockResolvedValueOnce({ ok: false, res: new Response("Forbidden", { status: 403 }) })
    const { GET } = await import("@/app/api/admin/email/broadcast/route")

    const response = await GET()

    expect(response.status).toBe(403)
    expect(mocks.getEmailCenterStatus).not.toHaveBeenCalled()
  })

  it("previews an admin broadcast without sending", async () => {
    mocks.requireAdmin.mockResolvedValueOnce({ ok: true, user: { email: "founder@example.com" } })
    mocks.runAdminEmailAction.mockResolvedValueOnce({
      ok: true,
      mode: "preview",
      message: "Preview only.",
      preview: { audience: "all", recipientCount: 2, cappedAt: 500, sample: [], excludedOptOuts: 1 },
      sent: 0,
      failed: 0,
    })
    const { POST } = await import("@/app/api/admin/email/broadcast/route")

    const response = await POST(
      new Request("http://localhost/api/admin/email/broadcast", {
        method: "POST",
        body: JSON.stringify({ mode: "preview", audience: "all", subject: "World Cup launch", body: "World Cup pools are live." }),
      })
    )

    expect(response.status).toBe(200)
    expect(mocks.runAdminEmailAction).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "preview", adminEmail: "founder@example.com" })
    )
  })

  /*
   * ⚠ THIS IS THE ROUTE'S OWN VALIDATION, NOT THE SERVICE'S. `EMAIL_AUDIENCES`
   * builds the zod enum the schema checks `audience` against — adding "manual"
   * to the service without it also reaching this enum would 400 on the exact
   * request the feature exists to accept, regardless of anything the service
   * itself does correctly. The manualEmails array is schema-validated too.
   */
  it("accepts a manual-audience request and passes manualEmails through untouched", async () => {
    mocks.requireAdmin.mockResolvedValueOnce({ ok: true, user: { email: "founder@example.com" } })
    mocks.runAdminEmailAction.mockResolvedValueOnce({
      ok: true,
      mode: "preview",
      message: "Preview only.",
      preview: { audience: "manual", recipientCount: 2, cappedAt: 50, sample: [], excludedOptOuts: 0, invalidEntries: 1 },
      sent: 0,
      failed: 0,
    })
    const { POST } = await import("@/app/api/admin/email/broadcast/route")

    const response = await POST(
      new Request("http://localhost/api/admin/email/broadcast", {
        method: "POST",
        body: JSON.stringify({
          mode: "preview",
          audience: "manual",
          subject: "A note for a few people",
          body: "This only goes to the people I typed in.",
          manualEmails: ["a@user.test.dev", "b@user.test.dev", "not-an-email"],
        }),
      })
    )

    expect(response.status).toBe(200)
    expect(mocks.runAdminEmailAction).toHaveBeenCalledWith(
      expect.objectContaining({
        audience: "manual",
        manualEmails: ["a@user.test.dev", "b@user.test.dev", "not-an-email"],
      })
    )
  })

  /*
   * ⚠ THE AUDIT TRAIL FOR A MANUAL SEND RECORDS A COUNT, NOT THE ADDRESSES.
   * "manual" carries no reproducible meaning on its own the way "audience:
   * paying" does — this is the one thing that makes a later audit review able
   * to say "a manual send of N people happened" without the log becoming a
   * second copy of anyone's email address.
   */
  it("audits a real manual send with the recipient count, not the address list", async () => {
    mocks.requireAdmin.mockResolvedValueOnce({ ok: true, user: { email: "founder@example.com" } })
    mocks.runAdminEmailAction.mockResolvedValueOnce({
      ok: true,
      mode: "send",
      message: "Broadcast sent.",
      preview: { audience: "manual", recipientCount: 2, cappedAt: 50, sample: [], excludedOptOuts: 0 },
      sent: 2,
      failed: 0,
    })
    const { POST } = await import("@/app/api/admin/email/broadcast/route")

    await POST(
      new Request("http://localhost/api/admin/email/broadcast", {
        method: "POST",
        body: JSON.stringify({
          mode: "send",
          audience: "manual",
          subject: "A note for a few people",
          body: "This only goes to the people I typed in.",
          confirm: true,
          manualEmails: ["a@user.test.dev", "b@user.test.dev"],
        }),
      })
    )

    expect(mocks.logAdminAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "admin_email_broadcast_send",
        details: expect.objectContaining({ recipientCount: 2 }),
      })
    )
    const loggedDetails = mocks.logAdminAudit.mock.calls[0][0].details
    expect(JSON.stringify(loggedDetails)).not.toContain("user.test.dev")
  })
})
