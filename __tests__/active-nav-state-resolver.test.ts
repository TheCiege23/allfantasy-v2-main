import { describe, expect, it } from "vitest"
import {
  SHELL_NAV_ITEMS,
  PRODUCT_SWITCHER_ITEMS,
  getActiveNavHref,
  isNavItemActive,
} from "@/lib/shell"

describe("active nav state resolver", () => {
  // aafa6bf40 (Phase 7H shell rebrand) moved the "AF Legacy" nav entry from /af-legacy to
  // /war-room in NavLinkResolver; the label is what the shell promises, the href followed it.
  it("includes AF Legacy in shell nav and product switcher", () => {
    for (const items of [SHELL_NAV_ITEMS, PRODUCT_SWITCHER_ITEMS]) {
      expect(items.find((item) => item.label === "AF Legacy")?.href).toBe("/war-room")
    }
  })

  it("treats legacy routes as active for af-legacy item", () => {
    expect(isNavItemActive("/af-legacy", "/af-legacy")).toBe(true)
    expect(isNavItemActive("/af-legacy?tab=chat".split("?")[0], "/af-legacy")).toBe(true)
    expect(isNavItemActive("/legacy/import", "/af-legacy")).toBe(true)
  })

  it("resolves active href for tools and legacy prefixes", () => {
    expect(getActiveNavHref("/tools/waiver-wire")).toBe("/tools-hub")
    expect(getActiveNavHref("/war-room")).toBe("/war-room")
  })
})
