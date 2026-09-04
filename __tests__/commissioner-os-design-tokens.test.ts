import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import postcss from "postcss"
import {
  severityTokens,
  statusTokens,
  benchmarkTokens,
  cssVar,
  type SeverityTier,
} from "@/lib/commissioner-ui/tokens/colors"
import {
  spacingScale,
  radiusScale,
  elevationScale,
  motionScale,
  iconSizeScale,
  controlHeightScale,
  badgeHeightScale,
  containerWidthScale,
  zIndexScale,
  opacityScale,
} from "@/lib/commissioner-ui/tokens/spacing"
import { breakpoints, mediaQuery } from "@/lib/commissioner-ui/tokens/breakpoints"

const globalsCssPath = join(process.cwd(), "app/globals.css")
const globalsCss = readFileSync(globalsCssPath, "utf-8")

describe("commissioner-os design tokens — module shape", () => {
  it("defines all five severity tiers with text/bg/border", () => {
    const tiers: SeverityTier[] = ["critical", "elevated", "standard", "advisory", "positive"]
    for (const tier of tiers) {
      const entry = severityTokens[tier]
      expect(entry).toBeDefined()
      expect(entry.text).toMatch(/^--severity-/)
      expect(entry.bg).toMatch(/^--severity-/)
      expect(entry.border).toMatch(/^--severity-/)
    }
  })

  it("defines status roles distinct from severity tiers", () => {
    expect(Object.keys(statusTokens).sort()).toEqual(["disabled", "information", "opportunity"])
  })

  it("keeps benchmark comparison tokens distinctly named from severity/status tokens", () => {
    const benchmarkNames = Object.values(benchmarkTokens)
    const severityNames = Object.values(severityTokens).flatMap((t) => [t.text, t.bg, t.border])
    const statusNames = Object.values(statusTokens).flatMap((t) => [t.text, t.bg, t.border])
    for (const name of benchmarkNames) {
      expect(severityNames).not.toContain(name)
      expect(statusNames).not.toContain(name)
    }
  })

  it("cssVar wraps a token name in a var() reference", () => {
    expect(cssVar(severityTokens.critical.text)).toBe("var(--severity-critical-text)")
  })

  it("defines a closed base-4 spacing scale", () => {
    expect(
      Object.keys(spacingScale)
        .map(Number)
        .sort((a, b) => a - b)
    ).toEqual([4, 8, 12, 16, 24, 32, 48, 64, 96])
  })

  it("defines exactly three radius steps", () => {
    expect(Object.keys(radiusScale).sort()).toEqual(["generous", "standard", "subtle"])
  })

  it("defines exactly two elevation levels", () => {
    expect(Object.keys(elevationScale).sort()).toEqual(["0", "1"])
  })

  it("defines breakpoints matching the Design Language System", () => {
    expect(breakpoints).toEqual({ tablet: 640, desktop: 1024, largeDesktop: 1440 })
  })

  it("mediaQuery produces valid min/max-width conditions", () => {
    expect(mediaQuery("tablet")).toBe("(min-width: 640px)")
    expect(mediaQuery("tablet", "down")).toBe("(max-width: 639px)")
  })
})

describe("commissioner-os design tokens — app/globals.css", () => {
  it("parses without syntax errors", () => {
    expect(() => postcss.parse(globalsCss)).not.toThrow()
  })

  it("declares every token name referenced by the TypeScript module", () => {
    const allTokenNames = [
      ...Object.values(severityTokens).flatMap((t) => [t.text, t.bg, t.border]),
      ...Object.values(statusTokens).flatMap((t) => [t.text, t.bg, t.border]),
      ...Object.values(benchmarkTokens),
      ...Object.values(spacingScale).map((s) => s.token),
      ...Object.values(radiusScale).map((s) => s.token),
      ...Object.values(elevationScale),
      ...Object.values(motionScale).map((s) => s.token),
      ...Object.values(iconSizeScale).map((s) => s.token),
      ...Object.values(controlHeightScale).map((s) => s.token),
      ...Object.values(badgeHeightScale).map((s) => s.token),
      ...Object.values(containerWidthScale).map((s) => s.token),
      ...Object.values(zIndexScale).map((s) => s.token),
      ...Object.values(opacityScale).map((s) => s.token),
    ]
    for (const name of allTokenNames) {
      expect(globalsCss).toContain(`${name}:`)
    }
  })

  it("aliases every new severity/status color token onto an existing variable or 'transparent' — never a new hex/rgb literal", () => {
    const root = postcss.parse(globalsCss)
    const newTokenDecls: string[] = []
    root.walkRules(":root", (rule) => {
      rule.walkDecls((decl) => {
        if (
          decl.prop.startsWith("--severity-") ||
          decl.prop.startsWith("--status-") ||
          decl.prop.startsWith("--benchmark-")
        ) {
          newTokenDecls.push(decl.value)
        }
      })
    })
    expect(newTokenDecls.length).toBeGreaterThan(0)
    for (const value of newTokenDecls) {
      const isTransparent = value === "transparent"
      const referencesExistingVariable = /var\(--/.test(value)
      const introducesLiteralColor = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(value)
      expect(isTransparent || referencesExistingVariable).toBe(true)
      expect(introducesLiteralColor).toBe(false)
    }
  })

  it("overrides --elevation-1 for dark and legacy modes rather than redeclaring the whole token set", () => {
    const root = postcss.parse(globalsCss)
    let hasOverride = false
    root.walkRules((rule) => {
      if (rule.selector.includes('[data-mode="dark"]') && rule.selector.includes('[data-mode="legacy"]')) {
        rule.walkDecls("--elevation-1", () => {
          hasOverride = true
        })
      }
    })
    expect(hasOverride).toBe(true)
  })

  it("keeps the new z-index scale below the two pre-existing hardcoded values in this file", () => {
    const maxNewZIndex = Math.max(...Object.values(zIndexScale).map((z) => z.value))
    expect(maxNewZIndex).toBeLessThan(90)
  })
})
