import { describe, expect, it, vi } from "vitest"

const uploadThing = vi.hoisted(() => ({ uploadFiles: vi.fn() }))
vi.mock("uploadthing/server", () => ({
  UTApi: class { uploadFiles = uploadThing.uploadFiles },
  UTFile: class { constructor(_parts: unknown[], _name: string, _options: unknown) {} },
}))
import {
  ALLOWED_PROFILE_IMAGE_TYPES,
  parseAvatarDataUrl,
  persistProfileImageBytes,
} from "@/lib/avatar/ProfileImageUploadStorageService"

describe("ProfileImageUploadStorageService", () => {
  it("parses a valid base64 avatar data URL", () => {
    const tinyPngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMBAJqLx2sAAAAASUVORK5CYII="
    const parsed = parseAvatarDataUrl(`data:image/png;base64,${tinyPngBase64}`)

    expect(parsed).not.toBeNull()
    expect(parsed?.mimeType).toBe("image/png")
    expect(parsed?.bytes.byteLength).toBeGreaterThan(0)
    expect(parsed?.extension).toBe("png")
  })

  it("rejects unsupported mime types and malformed payloads", () => {
    expect(
      parseAvatarDataUrl("data:image/svg+xml;base64,PHN2Zy8+")
    ).toBeNull()
    expect(parseAvatarDataUrl("not-a-data-url")).toBeNull()
  })

  it("keeps the upload allow-list aligned with app requirements", () => {
    expect(ALLOWED_PROFILE_IMAGE_TYPES).toEqual([
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
    ])
  })

  it("uploads through UploadThing when Blob storage is absent", async () => {
    const priorBlob = process.env.BLOB_READ_WRITE_TOKEN
    const priorFallback = process.env.BLOB1_READ_WRITE_TOKEN
    const priorUploadThing = process.env.UPLOADTHING_TOKEN
    try {
      delete process.env.BLOB_READ_WRITE_TOKEN
      delete process.env.BLOB1_READ_WRITE_TOKEN
      process.env.UPLOADTHING_TOKEN = "configured-token"
      uploadThing.uploadFiles.mockResolvedValue({ data: { url: "https://ufs.sh/f/avatar.png" }, error: null })

      const result = await persistProfileImageBytes({
        bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png", originalFilename: "avatar.png",
      })

      expect(result.url).toBe("https://ufs.sh/f/avatar.png")
      expect(uploadThing.uploadFiles).toHaveBeenCalledOnce()
    } finally {
      if (priorBlob === undefined) delete process.env.BLOB_READ_WRITE_TOKEN
      else process.env.BLOB_READ_WRITE_TOKEN = priorBlob
      if (priorFallback === undefined) delete process.env.BLOB1_READ_WRITE_TOKEN
      else process.env.BLOB1_READ_WRITE_TOKEN = priorFallback
      if (priorUploadThing === undefined) delete process.env.UPLOADTHING_TOKEN
      else process.env.UPLOADTHING_TOKEN = priorUploadThing
    }
  })
})
