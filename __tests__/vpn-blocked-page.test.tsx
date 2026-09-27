// @vitest-environment node
/**
 * /vpn-blocked echoes `from` into its "try again" link, so the link must never
 * leave the site. The page is rendered for real, not its helper, because the
 * helper being right says nothing about whether the page uses it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

const ua = vi.hoisted(() => ({ value: "" }))
vi.mock("next/headers", () => ({ headers: () => new Headers({ "user-agent": ua.value }) }))

import VpnBlockedPage from "@/app/vpn-blocked/page"
import { relayHelpVariant } from "@/lib/geo/privacyRelayHelp"

beforeEach(() => {
  ua.value = ""
})

async function retryHref(from: string | undefined): Promise<string> {
  const html = renderToStaticMarkup(await VpnBlockedPage({ searchParams: from === undefined ? {} : { from } }))
  const match = html.match(/<a href="([^"]*)"[^>]*>I turned it off/)
  if (!match) throw new Error("retry link not rendered")
  return match[1].replace(/&amp;/g, "&")
}

describe("/vpn-blocked", () => {
  it("sends the visitor back where they were going", async () => {
    expect(await retryHref("/core?tab=trades")).toBe("/core?tab=trades")
  })

  it("falls back to the homepage with no `from`", async () => {
    expect(await retryHref(undefined)).toBe("/")
  })

  for (const hostile of ["//evil.example/x", "https://evil.example", "/\\evil.example", "javascript:alert(1)", "evil.example"]) {
    it(`never links off-site for from=${hostile}`, async () => {
      expect(await retryHref(hostile)).toBe("/")
    })
  }

  it("does not loop back to itself", async () => {
    expect(await retryHref("/vpn-blocked?from=%2Fcore")).toBe("/")
  })

  it("keeps the billing portal reachable — cancelling must not need the VPN off", async () => {
    const html = renderToStaticMarkup(await VpnBlockedPage({ searchParams: {} }))
    expect(html).toContain('href="/api/subscription/billing-portal"')
  })

  it("tells Safari users how to turn off iCloud Private Relay for this site", async () => {
    const html = renderToStaticMarkup(await VpnBlockedPage({ searchParams: {} }))
    expect(html).toContain("Show IP Address")
  })
})

/*
 * Owner report 2026-09-25: "I have turned off my VPN but the VPN page won't stop." Safari's iCloud
 * Private Relay was on. When the gate says why=relay, the page names Private Relay and leads with
 * the steps for the visitor's own browser.
 */
const UA = {
  // The owner's own phone, from the request log of that report.
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.1 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.7339.101 Mobile/15E148 Safari/604.1",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15",
  macChrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  windowsChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
}

async function render(searchParams: { from?: string; why?: string }): Promise<string> {
  return renderToStaticMarkup(await VpnBlockedPage({ searchParams }))
}

function variantOf(html: string): string | null {
  return html.match(/data-testid="relay-steps" data-variant="([^"]+)"/)?.[1] ?? null
}

describe("/vpn-blocked when the cause is a privacy relay", () => {
  it("🛑 names iCloud Private Relay on an iPhone, first, with the Show IP Address steps", async () => {
    ua.value = UA.iphoneSafari
    const html = await render({ why: "relay", from: "/core" })
    expect(html).toContain("Turn off iCloud Private Relay to use AllFantasy.ai")
    expect(html).toContain("Your VPN may already be off")
    expect(variantOf(html)).toBe("ios-safari")
    expect(html.indexOf('data-testid="relay-steps"')).toBeLessThan(html.indexOf("VPN app:"))
    expect(html).toContain("Show IP Address")
    expect(html).toContain("Settings → your name → iCloud → Private Relay")
    expect(await retryHref("/core")).toBe("/core")
  })

  it("gives Mac Safari the Mac steps (and iPads, which send a Mac user agent)", async () => {
    ua.value = UA.macSafari
    const html = await render({ why: "relay" })
    expect(variantOf(html)).toBe("mac-safari")
    expect(html).toContain("Reload and Show IP Address")
    expect(html).toContain("Turn off iCloud Private Relay")
  })

  it("points Chrome — which Private Relay does not cover — at Cloudflare WARP instead", async () => {
    for (const agent of [UA.iphoneChrome, UA.macChrome, UA.windowsChrome]) {
      ua.value = agent
      const html = await render({ why: "relay" })
      expect(variantOf(html), agent).toBe("other")
      expect(html).toContain("Cloudflare WARP")
      expect(html).toContain("Turn off your VPN to use AllFantasy.ai")
    }
  })

  it("shows the general page when the gate did not say relay, whatever the device", async () => {
    ua.value = UA.iphoneSafari
    for (const why of [undefined, "vpn", "RELAY", "relay<script>"]) {
      const html = await render(why === undefined ? {} : { why })
      expect(variantOf(html), String(why)).toBeNull()
      expect(html).toContain("Turn off your VPN to use AllFantasy.ai")
      expect(html).toContain("How to fix it")
    }
  })

  it("keeps every other way out on the page under the relay steps", async () => {
    ua.value = UA.iphoneSafari
    const html = await render({ why: "relay" })
    expect(html).toContain("Other things that hide your location")
    expect(html).toContain("Tor Browser:")
    expect(html).toContain('href="/api/subscription/billing-portal"')
  })
})

describe("relayHelpVariant", () => {
  it("reads iPhone Safari, Mac Safari and everything else apart", () => {
    expect(relayHelpVariant(UA.iphoneSafari)).toBe("ios-safari")
    expect(relayHelpVariant(UA.iphoneChrome)).toBe("other")
    expect(relayHelpVariant(UA.macSafari)).toBe("mac-safari")
    expect(relayHelpVariant(UA.macChrome)).toBe("other")
    expect(relayHelpVariant(UA.windowsChrome)).toBe("other")
    expect(relayHelpVariant("")).toBe("other")
    expect(relayHelpVariant(null)).toBe("other")
  })
})
