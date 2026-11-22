// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ access: vi.fn(), config: vi.fn(), process: vi.fn(), revalidate: vi.fn(),
  redirect: vi.fn((url: string) => { throw new Error("REDIRECT:" + url) }) }))
vi.mock("@/lib/adminAuth", () => ({ getAdminAccessState: mocks.access }))
vi.mock("@/lib/leaguesafe/inbound-security", () => ({ getLeagueSafeInboundConfig: mocks.config }))
vi.mock("@/lib/leaguesafe/process-notification", () => ({ processLeagueSafeNotification: mocks.process }))
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }))
import { parseStoredNotification } from "@/app/admin/leaguesafe/raw/actions"
const form = (id = "raw-1") => { const value = new FormData(); value.set("id", id); return value }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.access.mockResolvedValue({ status: "admin" })
  mocks.config.mockReturnValue({ domains: ["leaguesafe.com"] })
  mocks.process.mockResolvedValue("parsed")
})
describe("admin-only explicit parsing action", () => {
  it.each(["forbidden", "unauthenticated"])("rejects %s before config or database processing", async status => {
    mocks.access.mockResolvedValue({ status })
    await expect(parseStoredNotification(form())).rejects.toThrow("REDIRECT:/admin")
    expect(mocks.config).not.toHaveBeenCalled()
    expect(mocks.process).not.toHaveBeenCalled()
  })
  it("uses only the stored id; ignores submitted raw content and force flags", async () => {
    const data = form(); data.set("rawBody", "malicious"); data.set("force", "true")
    await expect(parseStoredNotification(data)).rejects.toThrow("parse=parsed")
    expect(mocks.process).toHaveBeenCalledExactlyOnceWith("raw-1", ["leaguesafe.com"])
    expect(mocks.revalidate).toHaveBeenCalledWith("/admin/leaguesafe/raw")
  })
  it("does not process invalid ids or missing configuration", async () => {
    await expect(parseStoredNotification(form("../../private"))).rejects.toThrow("parse=invalid")
    expect(mocks.process).not.toHaveBeenCalled()
    mocks.config.mockReturnValue(null)
    await expect(parseStoredNotification(form())).rejects.toThrow("parse=unavailable")
    expect(mocks.process).not.toHaveBeenCalled()
  })
  it("returns only a static unavailable message on database errors", async () => {
    mocks.process.mockRejectedValue(new Error("private MIME"))
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      await expect(parseStoredNotification(form())).rejects.toThrow("parse=unavailable")
      expect(log).toHaveBeenCalledExactlyOnceWith("[leaguesafe] manual_parse_failed")
    } finally { log.mockRestore() }
  })
})
