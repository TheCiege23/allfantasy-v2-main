// @vitest-environment node
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  access: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn(),
  redirect: vi.fn(() => { throw new Error("REDIRECT") }),
}))
vi.mock("@/lib/adminAuth", () => ({ getAdminAccessState: mocks.access }))
vi.mock("@/lib/prisma", () => ({
  prisma: { leagueSafeRawEmail: { findMany: mocks.findMany, findUnique: mocks.findUnique, count: mocks.count } },
}))
vi.mock("@/app/admin/leaguesafe/raw/actions", () => ({ parseStoredNotification: vi.fn() }))
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }))
vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => React.createElement("a", props, children),
}))
import Page from "@/app/admin/leaguesafe/raw/page"

const row = {
  id: "raw-1", messageId: "19abc", receivedAt: new Date("2026-11-14T10:00:00Z"),
  from: "sender@notices.example", to: "allfantasysportsapp@gmail.com",
  subject: "Synthetic subject", processingStatus: "captured",
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.access.mockResolvedValue({ status: "admin" })
  mocks.findMany.mockResolvedValue([row])
  mocks.count.mockResolvedValue(0)
  mocks.findUnique.mockResolvedValue({
    ...row, rfcMessageId: "<fixture@example.invalid>", rejectionReason: null,
    authResults: { dkim: "pass" }, rawBody: '<script>alert("fixture")</script>',
  })
})
describe("admin-only LeagueSafe capture viewer", () => {
  it.each(["unauthenticated", "forbidden"])("blocks %s users before any database read", async (status) => {
    mocks.access.mockResolvedValue({ status })
    await expect(Page({ searchParams: Promise.resolve({ id: "raw-1" }) })).rejects.toThrow("REDIRECT")
    expect(mocks.redirect).toHaveBeenCalledWith("/admin")
    expect(mocks.findMany).not.toHaveBeenCalled()
    expect(mocks.findUnique).not.toHaveBeenCalled()
    expect(mocks.count).not.toHaveBeenCalled()
  })
  it("lists only envelope metadata without loading every raw email body", async () => {
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }))
    expect(html).toContain("Synthetic subject")
    expect(mocks.findUnique).not.toHaveBeenCalled()
    expect(mocks.findMany.mock.calls[0][0].select).not.toHaveProperty("rawBody")
  })
  it("renders source content as escaped text, with no executable email HTML", async () => {
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ id: "raw-1" }) }))
    expect(html).toContain("&lt;script&gt;")
    expect(html).not.toContain("<script>")
    expect(html).toContain("Delivery authentication")
    expect(html).toContain("fixture@example.invalid")
  })
  it("uses the resolved query status even when the promise has React's status property", async () => {
    const rejected = { ...row, id: "raw-rejected", subject: "Rejected synthetic email", processingStatus: "rejected" }
    mocks.findMany.mockImplementation(async ({ where }) =>
      where.processingStatus === "rejected" ? [rejected] : [row, rejected])
    mocks.findUnique.mockResolvedValue({
      ...rejected, rfcMessageId: "<rejected@example.invalid>",
      rejectionReason: "leaguesafe_dkim_did_not_pass",
      authResults: { dkim: "fail" }, rawBody: "<script>rejected fixture</script>",
    })
    // Next's compatibility promise exposes id/after, but reserves status for React.
    const searchParams = Object.assign(
      Promise.resolve({ status: "rejected", after: "raw-cursor", id: "raw-rejected" }),
      { status: "fulfilled", after: "raw-cursor", id: "raw-rejected" },
    )
    const html = renderToStaticMarkup(await Page({ searchParams }))
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { processingStatus: "rejected" }, cursor: { id: "raw-cursor" }, skip: 1,
    }))
    expect(mocks.findUnique).toHaveBeenCalledWith({ where: { id: "raw-rejected" } })
    expect(html).toContain("Rejected synthetic email")
    expect(html).not.toContain("Synthetic subject")
    expect(html).toContain("leaguesafe_dkim_did_not_pass")
    expect(html).toContain("status=rejected&amp;after=raw-cursor&amp;id=raw-rejected")
    expect(html).toContain("&lt;script&gt;")
    expect(html).not.toContain("<script>")
  })
  it("applies status filters and bounded cursor pagination", async () => {
    mocks.findMany.mockResolvedValue(Array.from({ length: 26 }, (_, index) => ({ ...row, id: "raw-" + index })))
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ status: "rejected", after: "raw-cursor" }) }))
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { processingStatus: "rejected" }, cursor: { id: "raw-cursor" }, skip: 1, take: 26,
    }))
    expect(html).toContain("Older emails")
    expect(html).toContain("after=raw-24")
    expect(html).not.toContain("id=raw-25")
  })
  it.each(["invalid-status", ["rejected"]])("ignores invalid or repeated query values: %s", async (status) => {
    await Page({ searchParams: Promise.resolve({ status, after: ["raw-cursor"], id: ["raw-1"] }) })
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }))
    expect(mocks.findMany.mock.calls[0][0]).not.toHaveProperty("cursor")
    expect(mocks.findUnique).not.toHaveBeenCalled()
  })
  it("shows empty capture state and a missing selection", async () => {
    mocks.findMany.mockResolvedValue([])
    mocks.findUnique.mockResolvedValue(null)
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ id: "missing" }) }))
    expect(html).toContain("No emails captured")
    expect(html).toContain("Email not found")
  })
  it("surfaces a durable admin review alert even when the current filter hides unparseable messages", async () => {
    mocks.count.mockResolvedValue(2)
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ status: "captured" }) }))
    expect(html).toContain('role="alert"')
    expect(html).toContain("2 email(s) need parser review")
    expect(html).toContain("status=unparseable")
  })
  it("escapes parsed payloads and offers manual parsing only for accepted records", async () => {
    const accepted = { ...row, rawBody: "MIME", authResults: {}, parsedPayload: { league: "<script>bad</script>" } }
    mocks.findUnique.mockResolvedValue(accepted)
    let html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ id: row.id }) }))
    expect(html).toContain("Parse stored notification")
    expect(html).toContain("&lt;script&gt;")
    expect(html).not.toContain("<script>")
    mocks.findUnique.mockResolvedValue({ ...accepted, processingStatus: "rejected", rejectionReason: "leaguesafe_dkim_did_not_pass" })
    html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ id: row.id }) }))
    expect(html).not.toContain("Parse stored notification")
  })
})
