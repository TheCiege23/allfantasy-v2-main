// @vitest-environment node
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  access: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(),
  redirect: vi.fn(() => { throw new Error("REDIRECT") }),
}))
vi.mock("@/lib/adminAuth", () => ({ getAdminAccessState: mocks.access }))
vi.mock("@/lib/prisma", () => ({
  prisma: { leagueSafeRawEmail: { findMany: mocks.findMany, findUnique: mocks.findUnique } },
}))
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
  mocks.findUnique.mockResolvedValue({
    ...row, rfcMessageId: "<fixture@example.invalid>", rejectionReason: null,
    authResults: { dkim: "pass" }, rawBody: '<script>alert("fixture")</script>',
  })
})
describe("admin-only LeagueSafe capture viewer", () => {
  it.each(["unauthenticated", "forbidden"])("blocks %s users before any database read", async (status) => {
    mocks.access.mockResolvedValue({ status })
    await expect(Page({ searchParams: { id: "raw-1" } })).rejects.toThrow("REDIRECT")
    expect(mocks.redirect).toHaveBeenCalledWith("/admin")
    expect(mocks.findMany).not.toHaveBeenCalled()
    expect(mocks.findUnique).not.toHaveBeenCalled()
  })
  it("lists only envelope metadata without loading every raw email body", async () => {
    const html = renderToStaticMarkup(await Page({ searchParams: {} }))
    expect(html).toContain("Synthetic subject")
    expect(mocks.findUnique).not.toHaveBeenCalled()
    expect(mocks.findMany.mock.calls[0][0].select).not.toHaveProperty("rawBody")
  })
  it("renders source content as escaped text, with no executable email HTML", async () => {
    const html = renderToStaticMarkup(await Page({ searchParams: { id: "raw-1" } }))
    expect(html).toContain("&lt;script&gt;")
    expect(html).not.toContain("<script>")
    expect(html).toContain("Delivery authentication")
    expect(html).toContain("fixture@example.invalid")
  })
  it("applies status filters and bounded cursor pagination", async () => {
    mocks.findMany.mockResolvedValue(Array.from({ length: 26 }, (_, index) => ({ ...row, id: "raw-" + index })))
    const html = renderToStaticMarkup(await Page({ searchParams: { status: "rejected", after: "raw-cursor" } }))
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { processingStatus: "rejected" }, cursor: { id: "raw-cursor" }, skip: 1, take: 26,
    }))
    expect(html).toContain("Older emails")
    expect(html).toContain("after=raw-24")
    expect(html).not.toContain("id=raw-25")
  })
  it("shows empty capture state and a missing selection", async () => {
    mocks.findMany.mockResolvedValue([])
    mocks.findUnique.mockResolvedValue(null)
    const html = renderToStaticMarkup(await Page({ searchParams: { id: "missing" } }))
    expect(html).toContain("No emails captured")
    expect(html).toContain("Email not found")
  })
})
