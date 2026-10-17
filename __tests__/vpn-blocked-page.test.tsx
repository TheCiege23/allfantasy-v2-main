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

describe("/vpn-blocked names what it saw", () => {
  const render = async (why?: string) =>
    renderToStaticMarkup(await VpnBlockedPage({ searchParams: why === undefined ? {} : { why } }))

  it("tells a Private Relay user it is the relay, not their VPN", async () => {
    const html = await render("privacy_relay")
    expect(html).toContain("Turn off iCloud Private Relay to use AllFantasy.ai")
    expect(html).toContain("We can see iCloud Private Relay")
  })

  it("tells a VPN user their app may have reconnected", async () => {
    expect(await render("vpn")).toContain("Connect On Demand")
  })

  it("falls back to the general page for anything unrecognised", async () => {
    for (const why of [undefined, "", "constructor", "<script>"]) {
      const html = await render(why)
      expect(html, String(why)).toContain("Turn off your VPN to use AllFantasy.ai")
      expect(html, String(why)).not.toContain("We can see")
    }
  })
})

describe("/vpn-blocked for a Mountain-time Private Relay user on a paid page", () => {
  it("says free features work and only paid ones need the relay off", async () => {
    const html = renderToStaticMarkup(await VpnBlockedPage({ searchParams: { why: "privacy_relay", scope: "paid", from: "/pro" } }))
    expect(html).toContain("Turn off iCloud Private Relay to use paid features")
    expect(html).toContain("Everything free on AllFantasy.ai still works with Private Relay on")
  })

  it("ignores scope=paid for anything but Private Relay", async () => {
    const html = renderToStaticMarkup(await VpnBlockedPage({ searchParams: { why: "vpn", scope: "paid" } }))
    expect(html).toContain("Turn off your VPN to use AllFantasy.ai")
    expect(html).not.toContain("paid features")
  })
})
