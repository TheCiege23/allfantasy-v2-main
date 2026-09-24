// @vitest-environment node
/**
 * /vpn-blocked echoes `from` into its "try again" link, so the link must never
 * leave the site. The page is rendered for real, not its helper, because the
 * helper being right says nothing about whether the page uses it.
 */

import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

import VpnBlockedPage from "@/app/vpn-blocked/page"

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
