import { beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"
import { POST } from "@/app/api/brackets/world-cup/[challengeId]/chat/route"

const requireUserMock = vi.hoisted(() => vi.fn())
const memberAccessMock = vi.hoisted(() => vi.fn())
const isConfiguredMock = vi.hoisted(() => vi.fn())
const uploadMock = vi.hoisted(() => vi.fn())

vi.mock("@/app/api/brackets/world-cup/_utils", () => ({
  requireWorldCupApiUser: requireUserMock,
  assertWorldCupChallengeMemberOrManager: memberAccessMock,
  worldCupChallengeParamsSchema: z.object({ challengeId: z.string().min(1) }),
}))

vi.mock("@/lib/world-cup/worldCupChatImageUpload", () => ({
  WORLD_CUP_CHAT_IMAGE_MAX_BYTES: 5 * 1024 * 1024,
  isCloudinaryConfigured: isConfiguredMock,
  isWorldCupChatImageType: (mimeType: string) => ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(mimeType),
  uploadWorldCupChatImageToCloudinary: uploadMock,
}))

function imageRequest(file: Blob) {
  const formData = new FormData()
  formData.set("action", "upload_image")
  formData.set("file", file, "goal.png")
  return {
    url: "http://localhost/api/brackets/world-cup/c1/chat?action=upload_image",
    headers: new Headers({ "content-type": "multipart/form-data" }),
    formData: async () => formData,
  } as Request
}

describe("World Cup chat image upload route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireUserMock.mockResolvedValue({ ok: true, user: { id: "user-1", email: "u1@example.com" } })
    memberAccessMock.mockResolvedValue({ ok: true })
    isConfiguredMock.mockReturnValue(true)
    uploadMock.mockResolvedValue({
      assetId: "asset-1",
      publicId: "allfantasy/world-cup/c1/chat/image",
      secureUrl: "https://res.cloudinary.com/demo/image/upload/v1/image.png",
      width: 320,
      height: 200,
      format: "png",
      bytes: 1234,
      provider: "cloudinary",
    })
  })

  it("blocks non-members from uploading images", async () => {
    memberAccessMock.mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Forbidden" }, { status: 403 }),
    })

    const res = await POST(imageRequest(new File(["ok"], "goal.png", { type: "image/png" })), { params: { challengeId: "c1" } })

    expect(res.status).toBe(403)
    expect(uploadMock).not.toHaveBeenCalled()
  })

  it("uploads valid member images with Cloudinary metadata only", async () => {

    const res = await POST(imageRequest(new Blob(["ok"], { type: "image/png" })), { params: { challengeId: "c1" } })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(uploadMock).toHaveBeenCalledWith(expect.objectContaining({
      challengeId: "c1",
      userId: "user-1",
    }))
    expect(json.image).toMatchObject({
      provider: "cloudinary",
      secureUrl: "https://res.cloudinary.com/demo/image/upload/v1/image.png",
    })
    expect(JSON.stringify(json)).not.toMatch(/api_secret|signature|token/i)
  })

  it("rejects invalid image MIME types", async () => {

    const res = await POST(imageRequest(new Blob(["nope"], { type: "text/plain" })), { params: { challengeId: "c1" } })

    expect(res.status).toBe(400)
    expect(uploadMock).not.toHaveBeenCalled()
  })

  it("rejects oversized images", async () => {
    const file = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.png", { type: "image/png" })

    const res = await POST(imageRequest(file), { params: { challengeId: "c1" } })

    expect(res.status).toBe(400)
    expect(uploadMock).not.toHaveBeenCalled()
  })

  it("returns setup requirements when Cloudinary is not configured", async () => {
    isConfiguredMock.mockReturnValue(false)

    const res = await POST(imageRequest(new File(["ok"], "goal.png", { type: "image/png" })), { params: { challengeId: "c1" } })
    const json = await res.json()

    expect(res.status).toBe(501)
    expect(json.requiredEnv).toEqual(["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"])
    expect(JSON.stringify(json)).not.toMatch(/signature|token/i)
  })
})
