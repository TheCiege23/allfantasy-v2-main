import { afterEach, describe, expect, it, vi } from "vitest"
import {
  canSendComposerMessage,
  getAttachmentPreviewLabel,
  getGifProviderName,
  getGiphySearchUrl,
  isGifSearchConfigured,
  isValidGifOrImageUrl,
  resolveMediaViewerUrl,
  searchGifs,
} from "@/lib/rich-message"

/** Every env name the provider chain consults, so each case starts from nothing. */
const GIF_ENV_KEYS = [
  "VITE_KLIPY_API_KEY",
  "KLIPY_API_KEY",
  "TENOR_API_KEY",
  "NEXT_PUBLIC_TENOR_API_KEY",
  "GIPHY_API_KEY",
  "GIPHY_SDK_KEY",
  "NEXT_PUBLIC_GIPHY_API_KEY",
] as const

function withGifEnv(values: Partial<Record<(typeof GIF_ENV_KEYS)[number], string>>) {
  for (const key of GIF_ENV_KEYS) vi.stubEnv(key, values[key] ?? "")
}

describe("rich message services", () => {
  it("computes send state with attachment-aware logic", () => {
    expect(canSendComposerMessage("", null, false)).toBe(false)
    expect(canSendComposerMessage("hello", null, false)).toBe(true)
    expect(
      canSendComposerMessage("", { type: "gif", url: "https://media.example/g.gif" }, false),
    ).toBe(true)
    expect(
      canSendComposerMessage("hello", { type: "gif", url: "https://media.example/g.gif" }, true),
    ).toBe(false)
  })

  it("returns labels for attachment preview types", () => {
    expect(getAttachmentPreviewLabel(null)).toBe("")
    expect(getAttachmentPreviewLabel({ type: "gif", url: "https://gif.example/1.gif" })).toBe("GIF")
    expect(
      getAttachmentPreviewLabel({
        type: "file",
        file: { name: "board.pdf", type: "application/pdf" } as File,
        url: "/uploads/chat/board.pdf",
      }),
    ).toBe("board.pdf")
  })

  it("validates gif urls and resolves safe viewer urls", () => {
    expect(isValidGifOrImageUrl("https://media.example/gif")).toBe(true)
    expect(isValidGifOrImageUrl("javascript:alert(1)")).toBe(false)
    expect(resolveMediaViewerUrl("javascript:alert(1)")).toBeNull()
  })

  it("returns no search results without configured provider", async () => {
    const results = await searchGifs("touchdown", 6)
    expect(Array.isArray(results)).toBe(true)
  })

  describe("GIF provider selection", () => {
    afterEach(() => {
      vi.unstubAllEnvs()
    })

    it("picks the first provider that has a key, in priority order", () => {
      withGifEnv({ KLIPY_API_KEY: "k", NEXT_PUBLIC_TENOR_API_KEY: "t", GIPHY_API_KEY: "g" })
      expect(getGifProviderName()).toBe("klipy")

      withGifEnv({ NEXT_PUBLIC_TENOR_API_KEY: "t", GIPHY_API_KEY: "g" })
      expect(getGifProviderName()).toBe("tenor")

      withGifEnv({ GIPHY_API_KEY: "g" })
      expect(getGifProviderName()).toBe("giphy")

      withGifEnv({})
      expect(getGifProviderName()).toBeNull()
      expect(isGifSearchConfigured()).toBe(false)
    })

    /*
     * 🛑 A KEY THAT IS PRESENT BUT EMPTY MUST NOT SHADOW THE NEXT ONE. The getters
     * used `A ?? B ?? ""`, and `??` only falls through on null/undefined — `KEY=`
     * in a .env file is the string "", which is not nullish, so it won. Blanking
     * a key you no longer want is exactly how that gets written, and the symptom
     * is a provider that is configured, correct, and silently never consulted.
     */
    it("treats a present-but-empty key as absent, not as a value", () => {
      withGifEnv({ KLIPY_API_KEY: "", NEXT_PUBLIC_TENOR_API_KEY: "", GIPHY_API_KEY: "g" })
      expect(getGifProviderName()).toBe("giphy")

      // Whitespace is the same trap wearing a disguise: a trailing space in a
      // .env line reads as "set" and builds a malformed request URL.
      withGifEnv({ KLIPY_API_KEY: "   ", GIPHY_API_KEY: "g" })
      expect(getGifProviderName()).toBe("giphy")
    })

    /*
     * GIPHY_SDK_KEY is the key developers.giphy.com issues for SDK-type apps. It
     * works against GET /v1/gifs/search — verified live (200 + results, against a
     * malformed-key control that returned 401) — so it is accepted here as an
     * alternative to GIPHY_API_KEY rather than being dead config.
     */
    it("accepts GIPHY_SDK_KEY, after the API key and before the client-inlined one", () => {
      withGifEnv({ GIPHY_SDK_KEY: "sdk" })
      expect(getGifProviderName()).toBe("giphy")
      expect(isGifSearchConfigured()).toBe(true)

      // Server-side keys outrank the NEXT_PUBLIC_ one, which ships in client bundles.
      withGifEnv({ GIPHY_SDK_KEY: "sdk", NEXT_PUBLIC_GIPHY_API_KEY: "pub" })
      expect(getGiphySearchUrl("x", 1)).toContain("api_key=sdk")

      // ...and the plain API key still outranks the SDK key.
      withGifEnv({ GIPHY_API_KEY: "api", GIPHY_SDK_KEY: "sdk" })
      expect(getGiphySearchUrl("x", 1)).toContain("api_key=api")
    })
  })
})
