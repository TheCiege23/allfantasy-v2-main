import { describe, expect, it } from "vitest"
import {
  getLegacyProviderPrimaryAction,
  isImportStatusActive,
  shouldShowRetryImport,
} from "@/lib/legacy-import-settings"

describe("import status query service", () => {
  it("marks running and queued as active", () => {
    expect(isImportStatusActive("running")).toBe(true)
    expect(isImportStatusActive("queued")).toBe(true)
    expect(isImportStatusActive("completed")).toBe(false)
  })

  it("detects retry statuses", () => {
    expect(shouldShowRetryImport({ linked: true, available: true, importStatus: "failed" })).toBe(true)
    expect(shouldShowRetryImport({ linked: true, available: true, importStatus: "error" })).toBe(true)
    expect(shouldShowRetryImport({ linked: true, available: true, importStatus: "completed" })).toBe(false)
  })

  it("resolves primary actions for sleeper states", () => {
    expect(
      getLegacyProviderPrimaryAction({
        providerId: "sleeper",
        status: { linked: false, available: true, importStatus: null },
      })
    ).toEqual({ label: "Connect first", href: "/settings/connect/sleeper" })

    expect(
      getLegacyProviderPrimaryAction({
        providerId: "sleeper",
        status: { linked: true, available: true, importStatus: "failed" },
      })
    ).toEqual({ label: "Retry import", href: "/af-legacy?retry=1&provider=sleeper" })

    expect(
      getLegacyProviderPrimaryAction({
        providerId: "sleeper",
        status: { linked: true, available: true, importStatus: "completed" },
      })
    ).toEqual({ label: "Re-import / refresh", href: "/af-legacy?refresh=1&provider=sleeper" })
  })
})
